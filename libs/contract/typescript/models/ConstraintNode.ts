/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ConstraintNodeAttributes } from './ConstraintNodeAttributes';
import type { NodeBase } from './NodeBase';
export type ConstraintNode = (NodeBase & {
    type: ConstraintNode.type;
    attributes: ConstraintNodeAttributes;
});
export namespace ConstraintNode {
    export enum type {
        CONSTRAINT = 'constraint',
    }
}

