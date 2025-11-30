import http from "node:http";
import https from "node:https";
import type { Logger } from "pino";

export type SSEMessage = {
    event?: string;
    data: string;
    id?: string;
};

export type SSEClientOptions = {
    host?: string;
    port?: number;
    path?: string;
    protocol?: "http" | "https";
    socketPath?: string;
    headers?: Record<string, string>;
    retry?: {
        initialDelayMs?: number;
        maxDelayMs?: number;
    };
    logger?: Logger;
};

export type SSEDisposer = () => void;

const DEFAULT_PATH = "/events";
const DEFAULT_INITIAL_DELAY = 1_000;
const DEFAULT_MAX_DELAY = 15_000;

export function createSSEStream(options: SSEClientOptions, onMessage: (msg: SSEMessage) => void): SSEDisposer {
    const logger = options.logger;
    let closed = false;
    let currentRequest: http.ClientRequest | null = null;
    let retryDelay = options.retry?.initialDelayMs ?? DEFAULT_INITIAL_DELAY;
    const maxDelay = options.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY;

    const scheduleReconnect = () => {
        if (closed) return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, maxDelay);
        setTimeout(() => {
            if (!closed) {
                connect();
            }
        }, delay);
    };

    const connect = () => {
        if (closed) {
            return;
        }
        if (currentRequest) {
            currentRequest.removeAllListeners();
            currentRequest.destroy();
            currentRequest = null;
        }

        const path = options.path ?? DEFAULT_PATH;
        const headers = {
            Accept: "text/event-stream",
            Connection: "keep-alive",
            "Cache-Control": "no-cache",
            ...(options.headers ?? {}),
        };

        const requestOptions: http.RequestOptions = {
            method: "GET",
            headers,
        };

        if (options.socketPath) {
            requestOptions.socketPath = options.socketPath;
            requestOptions.path = path;
        } else {
            requestOptions.host = options.host ?? "localhost";
            requestOptions.port = options.port ?? 8080;
            requestOptions.path = path;
        }

        const transport = options.protocol === "https" ? https : http;
        let buffer = "";

        const processBuffer = () => {
            let delimiterIndex = buffer.indexOf("\n\n");
            while (delimiterIndex !== -1) {
                const rawEvent = buffer.slice(0, delimiterIndex);
                buffer = buffer.slice(delimiterIndex + 2);
                dispatchEvent(rawEvent);
                delimiterIndex = buffer.indexOf("\n\n");
            }
        };

        const dispatchEvent = (raw: string) => {
            const cleaned = raw.replace(/\r/g, "");
            const lines = cleaned.split("\n");
            const dataLines: string[] = [];
            const message: SSEMessage = { data: "" };

            for (const line of lines) {
                if (!line) {
                    continue;
                }
                if (line.startsWith(":")) {
                    // Comment line (heartbeat/connected)
                    logger?.debug({ comment: line.slice(1).trim() }, "sse: received comment");
                    continue;
                }
                if (line.startsWith("data:")) {
                    dataLines.push(line.slice(5).trimStart());
                    continue;
                }
                if (line.startsWith("event:")) {
                    message.event = line.slice(6).trimStart();
                    continue;
                }
                if (line.startsWith("id:")) {
                    message.id = line.slice(3).trimStart();
                }
            }

            if (dataLines.length === 0) {
                return;
            }
            message.data = dataLines.join("\n");
            logger?.debug({ event: message.event, dataLength: message.data.length }, "sse: dispatching message");
            onMessage(message);
        };

        logger?.debug("sse: connecting...");
        const req = transport.request(requestOptions, (res) => {
            if (res.statusCode && res.statusCode >= 300) {
                logger?.warn({ statusCode: res.statusCode }, "sse endpoint returned non-200 status");
                res.resume();
                res.on("end", scheduleReconnect);
                return;
            }

            logger?.debug({ statusCode: res.statusCode }, "sse: connected successfully");
            retryDelay = options.retry?.initialDelayMs ?? DEFAULT_INITIAL_DELAY;
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
                buffer += chunk;
                processBuffer();
            });
            res.on("end", () => {
                logger?.debug("sse: connection ended, scheduling reconnect");
                scheduleReconnect();
            });
            res.on("error", (err) => {
                logger?.error({ err }, "sse stream error");
                scheduleReconnect();
            });
        });

        req.on("error", (err) => {
            logger?.error({ err }, "sse request error");
            scheduleReconnect();
        });

        req.end();
        currentRequest = req;
    };

    connect();

    return () => {
        closed = true;
        if (currentRequest) {
            currentRequest.destroy();
            currentRequest = null;
        }
    };
}
