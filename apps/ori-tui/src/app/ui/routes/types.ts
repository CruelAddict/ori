export type RouteLocation = WelcomeRoute | ConnectionRoute

export type WelcomeRoute = {
  type: "welcome"
}

export type ConnectionRoute = {
  type: "connection"
  configurationName: string
}

export const ROOT_ROUTE: WelcomeRoute = { type: "welcome" }

export const connectionRoute = (configurationName: string): ConnectionRoute => ({
  type: "connection",
  configurationName,
})
