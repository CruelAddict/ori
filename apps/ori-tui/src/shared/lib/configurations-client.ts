import type { Configuration } from "@shared/lib/configuration"
import { decodeServerEvent, type ServerEvent } from "@shared/lib/events"
import { createSSEStream, type SSEMessage } from "@shared/lib/sse-client"
import axios, { type AxiosInstance } from "axios"
import {
  ColumnNode,
  type ConfigurationsResponse,
  ConstraintNode,
  type ConnectionResult as ContractConnectionResult,
  DatabaseNode,
  type ErrorPayload,
  IndexNode,
  type Node,
  type NodesResponse,
  OpenAPI,
  type OpenAPIConfig,
  type QueryExecRequest,
  type QueryExecResponse,
  type QueryResultResponse,
  SchemaNode,
  TableNode,
  TriggerNode,
  ViewNode,
} from "contract"
import type { ApiRequestOptions } from "contract/core/ApiRequestOptions"
import { request as contractRequest } from "contract/core/request"
import type { Logger } from "pino"

export type ConnectResult = {
  result: "success" | "fail" | "connecting"
  userMessage?: string
}

export type { Node, NodeEdge } from "contract"

export const NodeType = {
  DATABASE: DatabaseNode.type.DATABASE,
  SCHEMA: SchemaNode.type.SCHEMA,
  TABLE: TableNode.type.TABLE,
  VIEW: ViewNode.type.VIEW,
  COLUMN: ColumnNode.type.COLUMN,
  CONSTRAINT: ConstraintNode.type.CONSTRAINT,
  INDEX: IndexNode.type.INDEX,
  TRIGGER: TriggerNode.type.TRIGGER,
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
  listConfigurations(): Promise<Configuration[]>
  connect(configurationName: string): Promise<ConnectResult>
  getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]>
  queryExec(
    configurationName: string,
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

type HttpClientOptions = {
  host: string
  port: number
  logger: Logger
}

type UnixClientOptions = {
  socketPath: string
  logger: Logger
}

class RestOriClient implements OriClient {
  private readonly apiConfig: OpenAPIConfig
  private readonly httpClient: AxiosInstance

  constructor(private readonly options: HttpClientOptions | UnixClientOptions) {
    this.apiConfig = this.createApiConfig()
    this.httpClient = this.createHttpClient()
  }

  async listConfigurations(): Promise<Configuration[]> {
    const payload = await this.send<ConfigurationsResponse>({
      method: "GET",
      url: "/configurations",
    })
    return payload.connections.map((conn: ConfigurationsResponse["connections"][number]) => ({
      name: conn.name,
      type: conn.type,
      host: conn.host ?? "",
      port: conn.port ?? 0,
      database: conn.database,
      username: conn.username ?? "",
      tls: conn.tls ?? undefined,
    }))
  }

  async connect(configurationName: string): Promise<ConnectResult> {
    const payload = await this.send<ContractConnectionResult>({
      method: "POST",
      url: "/connections",
      body: { configurationName },
      mediaType: "application/json",
    })
    return {
      result: payload.result,
      userMessage: payload.userMessage ?? undefined,
    }
  }

  async getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]> {
    const payload = await this.send<NodesResponse>({
      method: "GET",
      url: "/configurations/{configurationName}/nodes",
      path: { configurationName },
      query: { nodeId: nodeIDs },
    })
    return payload.nodes.map(mapNode)
  }

  async queryExec(
    configurationName: string,
    jobId: string,
    query: string,
    params?: Record<string, unknown>,
  ): Promise<QueryExecResult> {
    const request: QueryExecRequest = { configurationName, jobId, query }
    if (params !== undefined) {
      request.params = params
    }
    const payload = await this.send<QueryExecResponse>({
      method: "POST",
      url: "/queries",
      body: request,
      mediaType: "application/json",
    })
    return {
      jobId: payload.jobId,
      status: payload.status,
      message: payload.message ?? undefined,
    }
  }

  async queryGetResult(jobId: string, limit?: number, offset?: number): Promise<QueryResultView> {
    const payload = await this.send<QueryResultResponse>({
      method: "GET",
      url: "/queries/{jobId}/result",
      path: { jobId },
      query: { limit, offset },
    })
    return {
      columns: payload.columns.map((col: QueryResultResponse["columns"][number]) => ({
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
    await this.send<void>({
      method: "POST",
      url: "/queries/{jobId}/cancel",
      path: { jobId },
    })
  }

  openEventStream(onEvent: (event: ServerEvent) => void): () => void {
    if (isUnixOptions(this.options)) {
      return createSSEStream(
        {
          socketPath: this.options.socketPath,
          path: "/events",
          logger: this.options.logger,
        },
        (message) => this.dispatchEvent(message, onEvent),
      )
    }
    return createSSEStream(
      {
        host: this.options.host,
        port: this.options.port,
        path: "/events",
        logger: this.options.logger,
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
      this.options.logger.error({ err }, "failed to decode SSE payload")
    }
  }

  private createApiConfig(): OpenAPIConfig {
    const baseConfig: OpenAPIConfig = { ...OpenAPI }
    baseConfig.BASE = this.buildBaseURL()
    baseConfig.WITH_CREDENTIALS = false
    return baseConfig
  }

  private createHttpClient(): AxiosInstance {
    const client = axios.create({
      baseURL: this.apiConfig.BASE,
    })
    if (isUnixOptions(this.options)) {
      ;(client.defaults as typeof client.defaults & { socketPath?: string }).socketPath = this.options.socketPath
    }
    return client
  }

  private buildBaseURL(): string {
    if (isUnixOptions(this.options)) {
      return "http://unix"
    }
    return `http://${this.options.host}:${this.options.port}`
  }

  private async send<T>(options: ApiRequestOptions): Promise<T> {
    const result = await contractRequest<T | ErrorPayload>(this.apiConfig, options, this.httpClient)
    return this.unwrap<T>(result)
  }

  private unwrap<T>(result: T | ErrorPayload): T {
    if (isErrorPayload(result)) {
      throw new Error(result.message ?? "request failed")
    }
    return result
  }
}

export function createOriClient(options: CreateClientOptions): OriClient {
  if (options.socketPath) {
    return new RestOriClient({ socketPath: options.socketPath, logger: options.logger })
  }

  const host = options.host ?? "localhost"
  const port = options.port ?? 8080
  return new RestOriClient({ host, port, logger: options.logger })
}

function isUnixOptions(options: HttpClientOptions | UnixClientOptions): options is UnixClientOptions {
  return (options as UnixClientOptions).socketPath !== undefined
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return typeof value === "object" && value !== null && "code" in value
}

function mapNode(node: Node): Node {
  return node
}
