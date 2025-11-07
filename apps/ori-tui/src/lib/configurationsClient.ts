import OriSDK from "ori-sdk";
import type { Configuration } from "@src/lib/configuration";

export interface ConfigurationsClient {
    list(): Promise<Configuration[]>;
}

export type ClientMode = "sdk" | "stub";

interface ClientOptions {
    host: string;
    port: number;
}

class SdkConfigurationsClient implements ConfigurationsClient {
    private readonly options: ClientOptions;

    constructor(options: ClientOptions) {
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

export interface CreateClientOptions extends ClientOptions {
    mode: ClientMode;
}

export function createConfigurationsClient(options: CreateClientOptions): ConfigurationsClient {
    if (options.mode === "stub") {
        return new StubConfigurationsClient();
    }

    return new SdkConfigurationsClient(options);
}
