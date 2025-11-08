import OriSDK from "ori-sdk";
import type { Configuration } from "@src/lib/configuration";
import http from "node:http";

export interface ConfigurationsClient {
    list(): Promise<Configuration[]>;
}

export type ClientMode = "sdk" | "stub";

interface TcpClientOptions {
    host: string;
    port: number;
}

class SdkConfigurationsClient implements ConfigurationsClient {
    private readonly options: TcpClientOptions;

    constructor(options: TcpClientOptions) {
        this.options = options;
    }

    async list(): Promise<Configuration[]> {
        const client = new OriSDK({
            transport: {
                type: "http",
                host: this.options.host,
                port: this.options.port,
                path: "/rpc",
            },
        });

        const result = await client.listConfigurations();
        return result.configurations ?? result.connections ?? [];
    }
}

class UnixSocketConfigurationsClient implements ConfigurationsClient {
    private readonly socketPath: string;

    constructor(socketPath: string) {
        this.socketPath = socketPath;
    }

    private async jsonRpc<T = any>(method: string, params?: any): Promise<T> {
        const payload = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
        return new Promise<T>((resolve, reject) => {
            const req = http.request(
                {
                    socketPath: this.socketPath,
                    path: "/rpc",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(payload),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (c) => chunks.push(c as Buffer));
                    res.on("end", () => {
                        const body = Buffer.concat(chunks).toString("utf-8");
                        try {
                            const parsed = JSON.parse(body);
                            if (parsed.error) {
                                reject(new Error(parsed.error?.message || "RPC error"));
                                return;
                            }
                            resolve(parsed.result as T);
                        } catch (e) {
                            reject(e);
                        }
                    });
                }
            );
            req.on("error", reject);
            req.write(payload);
            req.end();
        });
    }

    async list(): Promise<Configuration[]> {
        const result = await this.jsonRpc<{ configurations?: Configuration[]; connections?: Configuration[] }>(
            "listConfigurations",
            []
        );
        return result.configurations ?? result.connections ?? [];
    }
}

const STUB_CONFIGURATIONS: Configuration[] = [
    {
        name: "Local Demo",
        type: "postgres",
        host: "127.0.0.1",
        port: 5432,
        database: "demo",
        username: "demo",
    },
    {
        name: "Analytics Warehouse",
        type: "snowflake",
        host: "snowflake.local",
        port: 443,
        database: "analytics",
        username: "analyst",
    },
    {
        name: "Read Replica",
        type: "mysql",
        host: "replica.internal",
        port: 3306,
        database: "replica_db",
        username: "readonly",
    },
];

class StubConfigurationsClient implements ConfigurationsClient {
    async list(): Promise<Configuration[]> {
        return STUB_CONFIGURATIONS;
    }
}

export interface CreateClientOptions {
    mode: ClientMode;
    host?: string;
    port?: number;
    socketPath?: string;
}

export function createConfigurationsClient(options: CreateClientOptions): ConfigurationsClient {
    if (options.mode === "stub") {
        return new StubConfigurationsClient();
    }

    if (options.socketPath) {
        return new UnixSocketConfigurationsClient(options.socketPath);
    }

    return new SdkConfigurationsClient({
        host: options.host || "localhost",
        port: options.port || 8080,
    });
}
