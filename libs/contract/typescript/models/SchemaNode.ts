/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NodeBase } from './NodeBase';
import type { SchemaNodeAttributes } from './SchemaNodeAttributes';
export type SchemaNode = (NodeBase & {
    type: SchemaNode.type;
    attributes: SchemaNodeAttributes;
});
export namespace SchemaNode {
    export enum type {
        SCHEMA = 'schema',
    }
}

