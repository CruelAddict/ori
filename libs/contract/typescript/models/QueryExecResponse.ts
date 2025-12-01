/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type QueryExecResponse = {
    jobId: string;
    status: QueryExecResponse.status;
    message?: string | null;
};
export namespace QueryExecResponse {
    export enum status {
        RUNNING = 'running',
        FAILED = 'failed',
    }
}

