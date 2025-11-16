import type { JSX } from "solid-js";
import { QueryJobsServiceProvider } from "@src/entities/query-job/api/query_jobs_service";
import { QueryJobsStoreProvider } from "@src/entities/query-job/model/query_jobs_store";

export interface QueryJobsProviderProps {
    children: JSX.Element;
}

export function QueryJobsProvider(props: QueryJobsProviderProps) {
    return (
        <QueryJobsServiceProvider>
            <QueryJobsStoreProvider>{props.children}</QueryJobsStoreProvider>
        </QueryJobsServiceProvider>
    );
}

export { useQueryJobs, useQueryJob, type QueryJob } from "@src/entities/query-job/model/query_jobs_store";
