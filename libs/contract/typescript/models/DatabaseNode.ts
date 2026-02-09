/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DatabaseNodeAttributes } from './DatabaseNodeAttributes';
import type { NodeBase } from './NodeBase';
export type DatabaseNode = (NodeBase & {
    type: DatabaseNode.type;
    attributes: DatabaseNodeAttributes;
});
export namespace DatabaseNode {
    export enum type {
        DATABASE = 'database',
    }
}

