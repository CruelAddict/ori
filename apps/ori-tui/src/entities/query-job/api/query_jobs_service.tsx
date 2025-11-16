import type { JSX } from "solid-js";
import { createContext, createEffect, onCleanup, useContext } from "solid-js";
import type { QueryExecResult, QueryResultView } from "@src/lib/configurationsClient";
import { useOriClient } from "@src/providers/client";
import { useLogger } from "@src/providers/logger";
import { QUERY_JOB_COMPLETED_EVENT, type QueryJobCompletedEvent, type ServerEvent } from "@src/lib/events";

export interface QueryJobsService {
    executeQuery(configurationName: string, query: string): Promise<QueryExecResult>;
    fetchQueryResult(jobId: string): Promise<QueryResultView>;
    onJobCompleted(listener: (event: QueryJobCompletedEvent) => void): () => void;
}

const QueryJobsServiceContext = createContext<QueryJobsService>();

export interface QueryJobsServiceProviderProps {
    children: JSX.Element;
}

export function QueryJobsServiceProvider(props: QueryJobsServiceProviderProps) {
    const client = useOriClient();
    const logger = useLogger();
    const listeners = new Set<(event: QueryJobCompletedEvent) => void>();

    const executeQuery = async (configurationName: string, query: string) => {
        try {
            return await client.queryExec(configurationName, query);
        } catch (err) {
            logger.error({ err, configurationName }, "failed to execute query");
            throw err;
        }
    };

    const fetchQueryResult = async (jobId: string) => {
        try {
            return await client.queryGetResult(jobId);
        } catch (err) {
            logger.error({ err, jobId }, "failed to fetch query result");
            throw err;
        }
    };

    const onJobCompleted = (listener: (event: QueryJobCompletedEvent) => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };

    const emit = (event: QueryJobCompletedEvent) => {
        for (const listener of listeners) {
            listener(event);
        }
    };

    const handleServerEvent = (event: ServerEvent) => {
        if (event.type !== QUERY_JOB_COMPLETED_EVENT) {
            return;
        }
        emit(event);
    };

    createEffect(() => {
        const dispose = client.openEventStream(handleServerEvent);
        onCleanup(() => dispose());
    });

    const service: QueryJobsService = {
        executeQuery,
        fetchQueryResult,
        onJobCompleted,
    };

    return (
        <QueryJobsServiceContext.Provider value={service}>
            {props.children}
        </QueryJobsServiceContext.Provider>
    );
}

export function useQueryJobsService(): QueryJobsService {
    const ctx = useContext(QueryJobsServiceContext);
    if (!ctx) {
        throw new Error("QueryJobsServiceProvider is missing in component tree");
    }
    return ctx;
}
