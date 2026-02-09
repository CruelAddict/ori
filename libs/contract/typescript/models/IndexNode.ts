/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { IndexNodeAttributes } from './IndexNodeAttributes';
import type { NodeBase } from './NodeBase';
export type IndexNode = (NodeBase & {
    type: IndexNode.type;
    attributes: IndexNodeAttributes;
});
export namespace IndexNode {
    export enum type {
        INDEX = 'index',
    }
}

