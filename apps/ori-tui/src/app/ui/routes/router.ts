import { useNavigation } from "@app/providers/navigation"
import type { Accessor } from "solid-js"
import type { RouteLocation } from "./types"

export type RouteNavigationActions = {
  pop(): void
  reset(pages?: RouteLocation[]): void
  push(page: RouteLocation): void
  replace(page: RouteLocation): void
}

export interface RouteNavigation extends RouteNavigationActions {
  stack: Accessor<RouteLocation[]>
  current: Accessor<RouteLocation>
  depth: Accessor<number>
}

export function useRouteNavigation(): RouteNavigation {
  const navigation = useNavigation()

  const push = (page: RouteLocation) => {
    navigation.push(page)
  }

  const replace = (page: RouteLocation) => {
    navigation.replace(page)
  }

  const reset = (pages?: RouteLocation[]) => {
    navigation.reset(pages)
  }

  return {
    stack: navigation.stack,
    current: navigation.current,
    depth: navigation.depth,
    push,
    pop: navigation.pop,
    replace,
    reset,
  }
}

export function useCurrentRoute(): Accessor<RouteLocation> {
  return useRouteNavigation().current
}
