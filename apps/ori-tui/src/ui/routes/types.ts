export type RouteLocation = WelcomeRoute | ResourceRoute

export type WelcomeRoute = {
  type: "welcome"
}

export type ResourceRoute = {
  type: "resource"
  resourceName: string
}

export const ROOT_ROUTE: WelcomeRoute = { type: "welcome" }

export const resourceRoute = (resourceName: string): ResourceRoute => ({
  type: "resource",
  resourceName,
})
