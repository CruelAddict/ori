/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ColumnNodeAttributes } from './ColumnNodeAttributes';
import type { NodeBase } from './NodeBase';
export type ColumnNode = (NodeBase & {
    type: ColumnNode.type;
    attributes: ColumnNodeAttributes;
});
export namespace ColumnNode {
    export enum type {
        COLUMN = 'column',
    }
}

