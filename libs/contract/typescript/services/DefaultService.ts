/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConfigurationsResponse } from '../models/ConfigurationsResponse';
import type { ConnectionRequest } from '../models/ConnectionRequest';
import type { ConnectionResult } from '../models/ConnectionResult';
import type { ErrorPayload } from '../models/ErrorPayload';
import type { NodesResponse } from '../models/NodesResponse';
import type { QueryExecRequest } from '../models/QueryExecRequest';
import type { QueryExecResponse } from '../models/QueryExecResponse';
import type { QueryResultResponse } from '../models/QueryResultResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DefaultService {
    /**
     * Health probe
     * @returns string Backend is ready to accept requests
     * @returns ErrorPayload Generic error payload
     * @throws ApiError
     */
    public static getHealth(): CancelablePromise<string | ErrorPayload> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
        });
    }
    /**
     * List saved connection configurations
     * @returns ConfigurationsResponse Collection of saved configurations
     * @returns ErrorPayload Generic error payload
     * @throws ApiError
     */
    public static listConfigurations(): CancelablePromise<ConfigurationsResponse | ErrorPayload> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/configurations',
        });
    }
    /**
     * Start (or refresh) a connection session for a configuration
     * @returns ErrorPayload Generic error payload
     * @returns ConnectionResult Connection attempt accepted
     * @throws ApiError
     */
    public static startConnection({
        requestBody,
    }: {
        requestBody: ConnectionRequest,
    }): CancelablePromise<ErrorPayload | ConnectionResult> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/connections',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                404: `Configuration not found`,
                409: `Connection is already in progress and cannot be restarted yet`,
            },
        });
    }
    /**
     * Fetch schema nodes for a configuration
     * @returns NodesResponse Matching schema nodes
     * @returns ErrorPayload Generic error payload
     * @throws ApiError
     */
    public static getNodes({
        configurationName,
        nodeId,
    }: {
        /**
         * Name of the configuration to inspect
         */
        configurationName: string,
        /**
         * Optional repeated parameter limiting the nodes returned
         */
        nodeId?: Array<string>,
    }): CancelablePromise<NodesResponse | ErrorPayload> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/configurations/{configurationName}/nodes',
            path: {
                'configurationName': configurationName,
            },
            query: {
                'nodeId': nodeId,
            },
            errors: {
                404: `Configuration not found`,
            },
        });
    }
    /**
     * Execute a SQL query asynchronously
     * @returns ErrorPayload Generic error payload
     * @returns QueryExecResponse Query accepted and job created
     * @throws ApiError
     */
    public static execQuery({
        requestBody,
    }: {
        requestBody: QueryExecRequest,
    }): CancelablePromise<ErrorPayload | QueryExecResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/queries',
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                404: `Configuration not found or no active connection`,
            },
        });
    }
    /**
     * Retrieve a previously stored query result view
     * @returns QueryResultResponse Result view for the job
     * @returns ErrorPayload Generic error payload
     * @throws ApiError
     */
    public static getQueryResult({
        jobId,
        limit,
        offset,
    }: {
        jobId: string,
        limit?: number,
        offset?: number,
    }): CancelablePromise<QueryResultResponse | ErrorPayload> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/queries/{jobId}/result',
            path: {
                'jobId': jobId,
            },
            query: {
                'limit': limit,
                'offset': offset,
            },
            errors: {
                404: `Job not found`,
            },
        });
    }
    /**
     * Subscribe to server-sent events for connection and query notifications
     * @returns string Stream of events in SSE format
     * @returns ErrorPayload Generic error payload
     * @throws ApiError
     */
    public static streamEvents(): CancelablePromise<string | ErrorPayload> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/events',
        });
    }
}
