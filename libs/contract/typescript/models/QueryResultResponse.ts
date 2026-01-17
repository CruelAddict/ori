/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { QueryResultColumn } from './QueryResultColumn';
export type QueryResultResponse = {
    columns: Array<QueryResultColumn>;
    rows: Array<Array<any>>;
    rowCount: number;
    truncated: boolean;
    rowsAffected?: number | null;
};

