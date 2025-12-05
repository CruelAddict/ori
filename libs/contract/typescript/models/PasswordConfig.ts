/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type PasswordConfig = {
    /**
     * Password provider type
     */
    type: PasswordConfig.type;
    /**
     * Provider-specific identifier (plain text value, shell command, or keychain account)
     */
    key: string;
};
export namespace PasswordConfig {
    /**
     * Password provider type
     */
    export enum type {
        PLAIN_TEXT = 'plain_text',
        SHELL = 'shell',
        KEYCHAIN = 'keychain',
    }
}

