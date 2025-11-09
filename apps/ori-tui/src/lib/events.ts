import type { SSEMessage } from "@src/lib/sseClient";

export type ConnectionState = "connecting" | "connected" | "failed";

export interface ConnectionStatePayload {
    configurationName: string;
    state: ConnectionState;
    message?: string;
    error?: string;
}

export interface ConnectionStateEvent {
    type: "connection.state";
    payload: ConnectionStatePayload;
    id?: string;
}

export type ServerEvent = ConnectionStateEvent;

export const CONNECTION_STATE_EVENT = "connection.state" as const;

export function decodeServerEvent(message: SSEMessage): ServerEvent | null {
    if (!message.data) {
        return null;
    }

    if (message.event === CONNECTION_STATE_EVENT) {
        const payload = JSON.parse(message.data) as ConnectionStatePayload;
        return {
            type: CONNECTION_STATE_EVENT,
            payload,
            id: message.id,
        };
    }

    return null;
}
