/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ConstraintNodeAttributes = {
    connection: string;
    table: string;
    constraintName: string;
    constraintType: string;
    columns?: Array<string>;
    referencedTable?: string;
    referencedDatabase?: string;
    referencedSchema?: string;
    referencedColumns?: Array<string>;
    onUpdate?: string;
    onDelete?: string;
    match?: string;
    indexName?: string;
    checkClause?: string;
};

