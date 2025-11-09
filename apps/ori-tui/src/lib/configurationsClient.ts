import http from "node:http";
import type { Logger } from "pino";
import type { Configuration } from "@src/lib/configuration";
import { createSSEStream } from "@src/lib/sseClient";
import { decodeServerEvent, type ServerEvent } from "@src/lib/events";

export type ClientMode = "sdk" | "stub";

export interface ConnectResult {
    result: "success" | "fail" | "connecting";
    userMessage?: string;
}

export interface NodeEdge {
    items: string[];
    truncated: boolean;
}

export interface Node {
    id: string;
    type: string;
    name: string;
    attributes: Record<string, any>;
    edges: Record<string, NodeEdge>;
}

export interface OriClient {
    listConfigurations(): Promise<Configuration[]>;
    connect(configurationName: string): Promise<ConnectResult>;
    getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]>;
    openEventStream(onEvent: (event: ServerEvent) => void): () => void;
}

export interface CreateClientOptions {
    mode: ClientMode;
    host?: string;
    port?: number;
    socketPath?: string;
    logger: Logger;
}

interface HttpClientOptions {
    host: string;
    port: number;
    logger: Logger;
}

interface UnixClientOptions {
    socketPath: string;
    logger: Logger;
}

interface JsonRpcTransportOptions {
    host?: string;
    port?: number;
    socketPath?: string;
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
];

class JsonRpcClient {
    constructor(private readonly transport: JsonRpcTransportOptions) {}

    async request(method: string, params: Record<string, any> = {}): Promise<any> {
        const payload = JSON.stringify({ jsonrpc: "2.0", method, params, id: Date.now() });
        return new Promise((resolve, reject) => {
            const headers = {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            };

            const requestOptions: http.RequestOptions = {
                method: "POST",
                path: "/rpc",
                headers,
            };

            if (this.transport.socketPath) {
                requestOptions.socketPath = this.transport.socketPath;
            } else {
                requestOptions.host = this.transport.host ?? "localhost";
                requestOptions.port = this.transport.port ?? 8080;
            }

            const req = http.request(requestOptions, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on("end", () => {
                    const body = Buffer.concat(chunks).toString("utf-8");
                    if (res.statusCode && res.statusCode >= 300) {
                        reject(new Error(`RPC HTTP ${res.statusCode}: ${body || res.statusMessage || "unknown error"}`));
                        return;
                    }

                    try {
                        const parsed = body ? JSON.parse(body) : {};
                        if (parsed.error) {
                            reject(new Error(parsed.error?.message ?? "RPC error"));
                            return;
                        }
                        resolve(parsed.result);
                    } catch (err) {
                        reject(err);
                    }
                });
                res.on("error", reject);
            });

            req.on("error", reject);
            req.write(payload);
            req.end();
        });
    }
}

class HttpOriClient implements OriClient {
    private readonly rpc: JsonRpcClient;

    constructor(private readonly options: HttpClientOptions) {
        this.rpc = new JsonRpcClient({ host: options.host, port: options.port });
    }

    async listConfigurations(): Promise<Configuration[]> {
        const result = await this.rpc.request("listConfigurations");
        return extractConfigurations(result);
    }

    async connect(configurationName: string): Promise<ConnectResult> {
        const result = await this.rpc.request("connect", { configurationName });
        return extractConnectResult(result);
    }

    async getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]> {
        const params: Record<string, any> = { configurationName };
        if (nodeIDs && nodeIDs.length > 0) {
            params.nodeIDs = nodeIDs;
        }
        const result = await this.rpc.request("getNodes", params);
        return extractNodes(result);
    }

    openEventStream(onEvent: (event: ServerEvent) => void): () => void {
        return createSSEStream(
            {
                host: this.options.host,
                port: this.options.port,
                path: "/events",
                logger: this.options.logger,
            },
            (message) => {
                try {
                    const event = decodeServerEvent(message);
                    if (event) {
                        onEvent(event);
                    }
                } catch (err) {
                    this.options.logger.error({ err }, "failed to decode SSE payload");
                }
            }
        );
    }
}

class UnixSocketOriClient implements OriClient {
    private readonly rpc: JsonRpcClient;

    constructor(private readonly options: UnixClientOptions) {
        this.rpc = new JsonRpcClient({ socketPath: options.socketPath });
    }

    async listConfigurations(): Promise<Configuration[]> {
        const result = await this.rpc.request("listConfigurations");
        return extractConfigurations(result);
    }

    async connect(configurationName: string): Promise<ConnectResult> {
        const result = await this.rpc.request("connect", { configurationName });
        return extractConnectResult(result);
    }

    async getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]> {
        const params: Record<string, any> = { configurationName };
        if (nodeIDs && nodeIDs.length > 0) {
            params.nodeIDs = nodeIDs;
        }
        const result = await this.rpc.request("getNodes", params);
        return extractNodes(result);
    }

    openEventStream(onEvent: (event: ServerEvent) => void): () => void {
        return createSSEStream(
            {
                socketPath: this.options.socketPath,
                path: "/events",
                logger: this.options.logger,
            },
            (message) => {
                try {
                    const event = decodeServerEvent(message);
                    if (event) {
                        onEvent(event);
                    }
                } catch (err) {
                    this.options.logger.error({ err }, "failed to decode SSE payload");
                }
            }
        );
    }
}

class StubOriClient implements OriClient {
    async listConfigurations(): Promise<Configuration[]> {
        return STUB_CONFIGURATIONS;
    }

    async connect(): Promise<ConnectResult> {
        return { result: "success" };
    }

    async getNodes(configurationName: string, nodeIDs?: string[]): Promise<Node[]> {
        const graph = ensureStubGraph(configurationName);
        if (!nodeIDs || nodeIDs.length === 0) {
            const root = graph.get(rootNodeId(configurationName));
            return root ? [root] : [];
        }
        const nodes: Node[] = [];
        for (const id of nodeIDs) {
            const node = graph.get(id);
            if (node) {
                nodes.push(node);
            }
        }
        return nodes;
    }

    openEventStream(): () => void {
        return () => undefined;
    }
}

export function createOriClient(options: CreateClientOptions): OriClient {
    if (options.mode === "stub") {
        return new StubOriClient();
    }

    if (options.socketPath) {
        return new UnixSocketOriClient({ socketPath: options.socketPath, logger: options.logger });
    }

    const host = options.host ?? "localhost";
    const port = options.port ?? 8080;
    return new HttpOriClient({ host, port, logger: options.logger });
}

function extractConfigurations(result: any): Configuration[] {
    if (Array.isArray(result?.configurations)) {
        return result.configurations;
    }
    if (Array.isArray(result?.connections)) {
        return result.connections;
    }
    return [];
}

function extractConnectResult(result: any): ConnectResult {
    return {
        result: result?.result ?? "fail",
        userMessage: result?.userMessage ?? undefined,
    };
}

function extractNodes(result: any): Node[] {
    return Array.isArray(result?.nodes) ? (result.nodes as Node[]) : [];
}

function rootNodeId(configurationName: string): string {
    return `${slugify(configurationName)}-database`;
}

const stubGraphs = new Map<string, Map<string, Node>>();

function ensureStubGraph(configurationName: string): Map<string, Node> {
    const existing = stubGraphs.get(configurationName);
    if (existing) {
        return existing;
    }

    const graph = buildStubGraph(configurationName);
    stubGraphs.set(configurationName, graph);
    return graph;
}

function buildStubGraph(configurationName: string): Map<string, Node> {
    const connectionSlug = slugify(configurationName);
    const databaseId = `${connectionSlug}-database`;
    const tableId = `${connectionSlug}-table`;
    const columnId = `${connectionSlug}-column`;
    const databaseName = `${connectionSlug}_db`;

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
    };

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
    };

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
    };

    return new Map<string, Node>([
        [databaseNode.id, databaseNode],
        [tableNode.id, tableNode],
        [columnNode.id, columnNode],
    ]);
}

function slugify(input: string): string {
    const normalized = input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || "connection";
}
