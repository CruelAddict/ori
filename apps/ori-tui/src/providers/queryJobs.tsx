import type { JSX } from "solid-js";
import { QueryJobsServiceProvider } from "@src/core/services/queryJobs";
import {
    QueryJobsStoreProvider,
    type QueryJobsContextValue,
    useQueryJobs as useQueryJobsStore,
    useQueryJob as useQueryJobStore,
    type QueryJob,
} from "@src/core/stores/queryJobsStore";

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

export const useQueryJobs = useQueryJobsStore;
export const useQueryJob = useQueryJobStore;
export type { QueryJobsContextValue, QueryJob };
