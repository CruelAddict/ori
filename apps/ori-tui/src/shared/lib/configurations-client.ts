import type { Configuration } from "@shared/lib/configuration"
import { decodeServerEvent, type ServerEvent } from "@shared/lib/events"
import { createSSEStream, type SSEMessage } from "@shared/lib/sse-client"
import axios, { type AxiosInstance } from "axios"
import {
  type ConfigurationsResponse,
  type ConnectionResult as ContractConnectionResult,
  type Node as ContractNode,
  type NodeEdge as ContractNodeEdge,
  type ErrorPayload,
  type NodesResponse,
  OpenAPI,
  type OpenAPIConfig,
  type QueryExecRequest,
  type QueryExecResponse,
  type QueryResultResponse,
} from "contract"
import type { ApiRequestOptions } from "contract/core/ApiRequestOptions"
import { request as contractRequest } from "contract/core/request"
import type { Logger } from "pino"

export type ClientMode = "sdk" | "stub"

export type ConnectResult = {
  result: "success" | "fail" | "connecting"
  userMessage?: string
}

export type NodeEdge = {
  items: string[]
  truncated: boolean
}

export type Node = {
  id: string
  type: string
  name: string
  attributes: Record<string, unknown>
  edges: Record<string, NodeEdge>
}

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
  openEventStream(onEvent: (event: ServerEvent) => void): () => void
}

export type CreateClientOptions = {
  mode: ClientMode
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
    }
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

class StubOriClient implements OriClient {
  async listConfigurations(): Promise<Configuration[]> {
    return STUB_CONFIGURATIONS
  }

  async connect(): Promise<ConnectResult> {
    return { result: "success" }
  }

  async getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]> {
    const graph = ensureStubGraph(configurationName)
    if (!nodeIDs || nodeIDs.length === 0) {
      const root = graph.get(rootNodeId(configurationName))
      return root ? [root] : []
    }
    const nodes: Node[] = []
    for (const id of nodeIDs) {
      const node = graph.get(id)
      if (node) {
        nodes.push(node)
      }
    }
    return nodes
  }

  async queryExec(
    _configurationName: string,
    jobId: string,
    _query: string,
    _params?: Record<string, unknown>,
  ): Promise<QueryExecResult> {
    return {
      jobId,
      status: "running",
    }
  }

  async queryGetResult(): Promise<QueryResultView> {
    return {
      columns: [
        { name: "id", type: "integer" },
        { name: "name", type: "text" },
      ],
      rows: [
        [1, "Sample Row 1"],
        [2, "Sample Row 2"],
      ],
      rowCount: 2,
      truncated: false,
    }
  }

  openEventStream(): () => void {
    return () => undefined
  }
}

const STUB_CONFIGURATIONS: Configuration[] = [
  {
    name: "Local Demo",
    type: "sqlite",
    host: "127.0.0.1",
    port: 0,
    database: "demo.db",
    username: "demo",
  },
  {
    name: "Analytics Warehouse",
    type: "postgres",
    host: "warehouse.local",
    port: 5432,
    database: "analytics",
    username: "analyst",
  },
]

export function createOriClient(options: CreateClientOptions): OriClient {
  if (options.mode === "stub") {
    return new StubOriClient()
  }

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

function mapNode(node: ContractNode): Node {
  const edges: Record<string, NodeEdge> = {}
  if (node.edges) {
    const contractEdges = Object.entries(node.edges) as Array<[string, ContractNodeEdge]>
    for (const [kind, edge] of contractEdges) {
      edges[kind] = {
        items: edge.items ?? [],
        truncated: edge.truncated ?? false,
      }
    }
  }
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    attributes: node.attributes ?? {},
    edges,
  }
}

function rootNodeId(configurationName: string): string {
  return `${slugify(configurationName)}-database`
}

const stubGraphs = new Map<string, Map<string, Node>>()

function ensureStubGraph(configurationName: string): Map<string, Node> {
  const existing = stubGraphs.get(configurationName)
  if (existing) {
    return existing
  }

  const graph = buildStubGraph(configurationName)
  stubGraphs.set(configurationName, graph)
  return graph
}

function buildStubGraph(configurationName: string): Map<string, Node> {
  const connectionSlug = slugify(configurationName)
  const databaseId = `${connectionSlug}-database`
  const tableId = `${connectionSlug}-table`
  const columnId = `${connectionSlug}-column`
  const databaseName = `${connectionSlug}_db`

  const databaseNode: Node = {
    id: databaseId,
    type: "database",
    name: databaseName,
    attributes: {
      connection: configurationName,
      database: databaseName,
    },
    edges: {
      tables: { items: [tableId], truncated: false },
    },
  }

  const tableNode: Node = {
    id: tableId,
    type: "table",
    name: "public.sample",
    attributes: {
      connection: configurationName,
      database: databaseName,
      table: "sample",
    },
    edges: {
      columns: { items: [columnId], truncated: false },
    },
  }

  const columnNode: Node = {
    id: columnId,
    type: "column",
    name: "id",
    attributes: {
      dataType: "integer",
      notNull: true,
      primaryKeyPosition: 1,
    },
    edges: {},
  }

  return new Map<string, Node>([
    [databaseNode.id, databaseNode],
    [tableNode.id, tableNode],
    [columnNode.id, columnNode],
  ])
}

function slugify(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "connection"
}
