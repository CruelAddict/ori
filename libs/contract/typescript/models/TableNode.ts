/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NodeBase } from './NodeBase';
import type { TableNodeAttributes } from './TableNodeAttributes';
export type TableNode = (NodeBase & {
    type: TableNode.type;
    attributes: TableNodeAttributes;
});
export namespace TableNode {
    export enum type {
        TABLE = 'table',
    }
}

