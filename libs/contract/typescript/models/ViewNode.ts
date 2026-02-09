/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NodeBase } from './NodeBase';
import type { ViewNodeAttributes } from './ViewNodeAttributes';
export type ViewNode = (NodeBase & {
    type: ViewNode.type;
    attributes: ViewNodeAttributes;
});
export namespace ViewNode {
    export enum type {
        VIEW = 'view',
    }
}

