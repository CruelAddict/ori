export type RouteLocation = WelcomeRoute | ConnectionRoute;

export interface WelcomeRoute {
    type: "welcome";
}

export interface ConnectionRoute {
    type: "connection";
    configurationName: string;
}

export const ROOT_ROUTE: WelcomeRoute = { type: "welcome" };

export const connectionRoute = (configurationName: string): ConnectionRoute => ({
    type: "connection",
    configurationName,
});
