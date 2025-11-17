export type RouteLocation = ConfigurationRoute | ConnectionRoute;

export interface ConfigurationRoute {
    type: "configuration-list";
}

export interface ConnectionRoute {
    type: "connection";
    configurationName: string;
}

export const ROOT_ROUTE: ConfigurationRoute = { type: "configuration-list" };

export const connectionRoute = (configurationName: string): ConnectionRoute => ({
    type: "connection",
    configurationName,
});
