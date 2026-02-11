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

export class RestOriClient implements OriClient {
  private readonly apiConfig: OpenAPIConfig
  private readonly httpClient: AxiosInstance
  private readonly logger: Logger
  private readonly socketPath?: string
  private readonly host: string
  private readonly port: number

  constructor(options: CreateClientOptions) {
    this.logger = options.logger
    this.socketPath = options.socketPath
    this.host = options.host ?? "localhost"
    this.port = options.port ?? 8080
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
    return payload.nodes
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
    if (this.socketPath) {
      ;(client.defaults as typeof client.defaults & { socketPath?: string }).socketPath = this.socketPath
    }
    return client
  }

  private buildBaseURL(): string {
    if (this.socketPath) {
      return "http://unix"
    }
    return `http://${this.host}:${this.port}`
  }

  private async send<T>(options: ApiRequestOptions): Promise<T> {
    const result = await contractRequest<T | ErrorPayload>(this.apiConfig, options, this.httpClient)
    return this.unwrap<T>(result)
  }

  private unwrap<T>(result: T | ErrorPayload): T {
    if (typeof result === "object" && result !== null && "code" in result) {
      throw new Error(result.message ?? "request failed")
    }
    return result
  }
}
