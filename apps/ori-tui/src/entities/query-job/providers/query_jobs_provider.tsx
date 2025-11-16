import type { JSX } from "solid-js";
import { QueryJobsApiProvider } from "@src/entities/query-job/api/api";
import { QueryJobsStoreProvider } from "@src/entities/query-job/model/query_jobs_store";

export interface QueryJobsProviderProps {
    children: JSX.Element;
}

export function QueryJobsProvider(props: QueryJobsProviderProps) {
    return (
        <QueryJobsApiProvider>
            <QueryJobsStoreProvider>{props.children}</QueryJobsStoreProvider>
        </QueryJobsApiProvider>
    );
}

export { useQueryJobs, useQueryJob, type QueryJob } from "@src/entities/query-job/model/query_jobs_store";
