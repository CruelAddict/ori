/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NodeBase } from './NodeBase';
import type { TriggerNodeAttributes } from './TriggerNodeAttributes';
export type TriggerNode = (NodeBase & {
    type: TriggerNode.type;
    attributes: TriggerNodeAttributes;
});
export namespace TriggerNode {
    export enum type {
        TRIGGER = 'trigger',
    }
}

