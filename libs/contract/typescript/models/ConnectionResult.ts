/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ConnectionResult = {
    result: ConnectionResult.result;
    userMessage?: string | null;
};
export namespace ConnectionResult {
    export enum result {
        SUCCESS = 'success',
        FAIL = 'fail',
        CONNECTING = 'connecting',
    }
}

