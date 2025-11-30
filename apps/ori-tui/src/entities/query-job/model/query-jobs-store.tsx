import { useLogger } from "@app/providers/logger";
import type { QueryResultView } from "@shared/lib/configurations-client";
import type { QueryJobCompletedEvent } from "@shared/lib/events";
import { useQueryJobsApi } from "@src/entities/query-job/api/api";
import type { Accessor, JSX } from "solid-js";
import { createContext, onCleanup, useContext } from "solid-js";
import { createStore } from "solid-js/store";

export type QueryJob = {
    jobId: string;
    configurationName: string;
    query: string;
    status: "running" | "success" | "failed" | "canceled";
    result?: QueryResultView;
    error?: string;
    message?: string;
    durationMs?: number;
};

type QueryJobsStoreState = {
    jobsByConfiguration: Record<string, QueryJob | undefined>;
    queryTextByConfiguration: Record<string, string>;
};

type QueryJobsActions = {
    setQueryText(configurationName: string, text: string): void;
    executeQuery(configurationName: string, query: string): Promise<void>;
    clearQuery(configurationName: string): void;
};

export interface QueryJobsContextValue extends QueryJobsActions {
    getJob: (configurationName: string) => QueryJob | undefined;
    getQueryText: (configurationName: string) => string;
}

const QueryJobsContext = createContext<QueryJobsContextValue>();

export type QueryJobsStoreProviderProps = {
    children: JSX.Element;
};

export function QueryJobsStoreProvider(props: QueryJobsStoreProviderProps) {
    const api = useQueryJobsApi();
    const logger = useLogger();

    const [state, setState] = createStore<QueryJobsStoreState>({
        jobsByConfiguration: {},
        queryTextByConfiguration: {},
    });

    const setQueryText = (configurationName: string, text: string) => {
        setState("queryTextByConfiguration", configurationName, text);
    };

    const clearQuery = (configurationName: string) => {
        setState("queryTextByConfiguration", configurationName, "");
        setState("jobsByConfiguration", configurationName, undefined);
    };

    const executeQuery = async (configurationName: string, query: string) => {
        try {
            const execResult = await api.executeQuery(configurationName, query);
            setState("jobsByConfiguration", configurationName, {
                jobId: execResult.jobId,
                configurationName,
                query,
                status: execResult.status === "running" ? "running" : "failed",
                error: execResult.message,
            });

            if (execResult.status === "failed") {
                logger.error(
                    { jobId: execResult.jobId, message: execResult.message },
                    "query execution failed immediately",
                );
            }
        } catch (err) {
            setState("jobsByConfiguration", configurationName, {
                jobId: "",
                configurationName,
                query,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const handleQueryJobCompleted = async (event: QueryJobCompletedEvent) => {
        const { jobId, configurationName, status, error, message, stored, durationMs } = event.payload;
        logger.debug({ jobId, configurationName, status, stored }, "query-jobs-store: received job completed event");
        const currentJob = state.jobsByConfiguration[configurationName];
        if (!currentJob || currentJob.jobId !== jobId) {
            logger.debug(
                { jobId, configurationName, currentJobId: currentJob?.jobId },
                "query-jobs-store: ignoring event - job mismatch or no current job",
            );
            return;
        }

        if (status === "success" && stored) {
            try {
                const result = await api.fetchQueryResult(jobId);
                setState("jobsByConfiguration", configurationName, {
                    ...currentJob,
                    status: "success",
                    result,
                    durationMs,
                });
            } catch (err) {
                setState("jobsByConfiguration", configurationName, {
                    ...currentJob,
                    status: "failed",
                    error: err instanceof Error ? err.message : String(err),
                    durationMs,
                });
            }
            return;
        }

        const nextStatus = resolveCompletedStatus(status);
        setState("jobsByConfiguration", configurationName, {
            ...currentJob,
            status: nextStatus,
            error: error || message,
            durationMs,
        });
    };

    const unsubscribe = api.onJobCompleted(handleQueryJobCompleted);
    onCleanup(() => unsubscribe());

    const getJob = (configurationName: string) => state.jobsByConfiguration[configurationName];
    const getQueryText = (configurationName: string) => state.queryTextByConfiguration[configurationName] ?? "";

    const value: QueryJobsContextValue = {
        getJob,
        getQueryText,
        setQueryText,
        executeQuery,
        clearQuery,
    };

    return <QueryJobsContext.Provider value={value}>{props.children}</QueryJobsContext.Provider>;
}

function resolveCompletedStatus(status: string): QueryJob["status"] {
    if (status === "success") {
        return "success";
    }
    if (status === "canceled") {
        return "canceled";
    }
    return "failed";
}

export function useQueryJobs(): QueryJobsContextValue {
    const ctx = useContext(QueryJobsContext);
    if (!ctx) {
        throw new Error("QueryJobsStoreProvider is missing in component tree");
    }
    return ctx;
}

export function useQueryJob(configurationName: Accessor<string | null>) {
    const ctx = useQueryJobs();
    return () => {
        const name = configurationName();
        if (!name) return undefined;
        return ctx.getJob(name);
    };
}
