import { createSSEStream, type SSEMessage } from "@adapters/ori/sse-client"
import { decodeServerEvent, type ServerEvent } from "@model/events"
import type { Resource } from "@model/resource"
import {
  cancelQuery,
  connectResource,
  type ErrorPayload,
  execQuery,
  getNodes,
  getQueryResult,
  listResources,
  type Node,
  type QueryExecRequest,
} from "contract"
import { type Client as ContractClient, createClient } from "contract/client"
import type { Logger } from "pino"

type BunRequest = Request & { timeout?: boolean }
type BunRequestInit = RequestInit & { unix?: string }

export type ResourceConnectResult = {
  result: "success" | "fail" | "connecting"
  userMessage?: string
}

export type { Node, NodeEdge } from "contract"

export const NodeType = {
  DATABASE: "database",
  SCHEMA: "schema",
  TABLE: "table",
  VIEW: "view",
  COLUMN: "column",
  CONSTRAINT: "constraint",
  INDEX: "index",
  TRIGGER: "trigger",
} as const

export type QueryExecResult = {
  jobId: string
  status: "running" | "failed"
  message?: string
}

export type QueryColumn = {
  name: string
  type: string
}

export type QueryResultView = {
  columns: QueryColumn[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  rowsAffected?: number | null
}

export type OriClient = {
  listResources(): Promise<Resource[]>
  connect(resourceName: string): Promise<ResourceConnectResult>
  getNodes(resourceName: string, nodeIDs?: string[]): Promise<Node[]>
  queryExec(
    resourceName: string,
    jobId: string,
    query: string,
    params?: Record<string, unknown>,
  ): Promise<QueryExecResult>
  queryGetResult(jobId: string, limit?: number, offset?: number): Promise<QueryResultView>
  queryCancel(jobId: string): Promise<void>
  openEventStream(onEvent: (event: ServerEvent) => void): () => void
}

export type CreateClientOptions = {
  host?: string
  port?: number
  socketPath?: string
  logger: Logger
}

export class RestOriClient implements OriClient {
  private readonly httpClient: ContractClient
  private readonly logger: Logger
  private readonly socketPath?: string
  private readonly host: string
  private readonly port: number

  constructor(options: CreateClientOptions) {
    this.logger = options.logger
    this.socketPath = options.socketPath
    this.host = options.host ?? "localhost"
    this.port = options.port ?? 8080
    this.httpClient = this.createHttpClient()
  }

  async listResources(): Promise<Resource[]> {
    const response = await listResources({
      client: this.httpClient,
      throwOnError: true,
    }).catch(throwNormalizedError)
    const payload = response.data
    return payload.resources.map((conn) => ({
      name: conn.name,
      type: conn.type,
      host: conn.host ?? "",
      port: conn.port ?? 0,
      database: conn.database,
      username: conn.username ?? "",
      tls: conn.tls ?? undefined,
    }))
  }

  async connect(resourceName: string): Promise<ResourceConnectResult> {
    const response = await connectResource({
      body: { resourceName },
      client: this.httpClient,
      throwOnError: true,
    }).catch(throwNormalizedError)
    const payload = response.data
    return {
      result: payload.result,
      userMessage: payload.userMessage ?? undefined,
    }
  }

  async getNodes(resourceName: string, nodeIDs?: string[]): Promise<Node[]> {
    const response = await getNodes({
      client: this.httpClient,
      path: { resourceName },
      query: { nodeId: nodeIDs },
      throwOnError: true,
    }).catch(throwNormalizedError)
    const payload = response.data
    return payload.nodes
  }

  async queryExec(
    resourceName: string,
    jobId: string,
    query: string,
    params?: Record<string, unknown>,
  ): Promise<QueryExecResult> {
    const request: QueryExecRequest = { resourceName, jobId, query }
    if (params !== undefined) {
      request.params = params
    }
    const response = await execQuery({
      body: request,
      client: this.httpClient,
      throwOnError: true,
    }).catch(throwNormalizedError)
    const payload = response.data
    return {
      jobId: payload.jobId,
      status: payload.status,
      message: payload.message ?? undefined,
    }
  }

  async queryGetResult(jobId: string, limit?: number, offset?: number): Promise<QueryResultView> {
    const response = await getQueryResult({
      client: this.httpClient,
      path: { jobId },
      query: { limit, offset },
      throwOnError: true,
    }).catch(throwNormalizedError)
    const payload = response.data
    return {
      columns: payload.columns.map((col) => ({
        name: col.name,
        type: col.type,
      })),
      rows: payload.rows,
      rowCount: payload.rowCount,
      truncated: payload.truncated,
      rowsAffected: payload.rowsAffected ?? undefined,
    }
  }

  async queryCancel(jobId: string): Promise<void> {
    await cancelQuery({
      client: this.httpClient,
      path: { jobId },
      throwOnError: true,
    }).catch(throwNormalizedError)
  }

  openEventStream(onEvent: (event: ServerEvent) => void): () => void {
    if (this.socketPath) {
      return createSSEStream(
        {
          socketPath: this.socketPath,
          path: "/events",
          logger: this.logger,
        },
        (message) => this.dispatchEvent(message, onEvent),
      )
    }
    return createSSEStream(
      {
        host: this.host,
        port: this.port,
        path: "/events",
        logger: this.logger,
      },
      (message) => this.dispatchEvent(message, onEvent),
    )
  }

  private dispatchEvent(message: SSEMessage, onEvent: (event: ServerEvent) => void) {
    try {
      const event = decodeServerEvent(message)
      if (event) {
        onEvent(event)
      }
    } catch (err) {
      this.logger.error({ err }, "failed to decode SSE payload")
    }
  }

  private createHttpClient(): ContractClient {
    return createClient({
      baseUrl: this.buildBaseURL(),
      fetch: createRuntimeFetch(this.socketPath),
    })
  }

  private buildBaseURL(): string {
    if (this.socketPath) {
      return "http://localhost"
    }
    return `http://${this.host}:${this.port}`
  }
}

function createRuntimeFetch(socketPath?: string): typeof fetch {
  const customFetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
    const requestWithTimeout = request as BunRequest
    requestWithTimeout.timeout = false
    if (socketPath) {
      return fetch(request, { unix: socketPath } as BunRequestInit)
    }
    return fetch(request)
  }) as typeof fetch
  return customFetch
}

function throwNormalizedError(err: unknown): never {
  if (err instanceof Error) {
    throw err
  }
  if (isErrorPayload(err)) {
    throw new Error(err.message ?? "request failed")
  }
  throw new Error(String(err))
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return typeof value === "object" && value !== null && "code" in value
}
