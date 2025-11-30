import type { SSEMessage } from "@shared/lib/sse-client";

export type ConnectionState = "connecting" | "connected" | "failed";

export type ConnectionStatePayload = {
    configurationName: string;
    state: ConnectionState;
    message?: string;
    error?: string;
};

export type ConnectionStateEvent = {
    type: "connection.state";
    payload: ConnectionStatePayload;
    id?: string;
};

export type QueryJobCompletedPayload = {
    jobId: string;
    configurationName: string;
    status: string;
    finishedAt: string;
    durationMs: number;
    error?: string;
    message?: string;
    stored: boolean;
};

export type QueryJobCompletedEvent = {
    type: "query.job.completed";
    payload: QueryJobCompletedPayload;
    id?: string;
};

export type ServerEvent = ConnectionStateEvent | QueryJobCompletedEvent;

export const CONNECTION_STATE_EVENT = "connection.state" as const;
export const QUERY_JOB_COMPLETED_EVENT = "query.job.completed" as const;

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

    if (message.event === QUERY_JOB_COMPLETED_EVENT) {
        const payload = JSON.parse(message.data) as QueryJobCompletedPayload;
        return {
            type: QUERY_JOB_COMPLETED_EVENT,
            payload,
            id: message.id,
        };
    }

    return null;
}
