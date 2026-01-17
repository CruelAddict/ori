/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PasswordConfig } from './PasswordConfig';
import type { TlsConfig } from './TlsConfig';
export type Configuration = {
    name: string;
    type: string;
    host?: string | null;
    port?: number | null;
    database: string;
    username?: string | null;
    password?: PasswordConfig;
    tls?: TlsConfig;
};

