import { QueryJobsApiProvider } from "@src/entities/query-job/api/api";
import { QueryJobsStoreProvider } from "@src/entities/query-job/model/query-jobs-store";
import type { JSX } from "solid-js";

export type QueryJobsProviderProps = {
  children: JSX.Element;
};

export function QueryJobsProvider(props: QueryJobsProviderProps) {
  return (
    <QueryJobsApiProvider>
      <QueryJobsStoreProvider>{props.children}</QueryJobsStoreProvider>
    </QueryJobsApiProvider>
  );
}

export { type QueryJob, useQueryJob, useQueryJobs } from "@src/entities/query-job/model/query-jobs-store";
