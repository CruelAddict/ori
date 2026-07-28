import { ResourceViewPage } from "@ui/pages/resource-view/resource-view"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { createMemo, For } from "solid-js"
import { useRouteNavigation } from "./router"
import { type ResourceRoute, type RouteLocation, resourceRoute } from "./types"

export function RouteOutlet() {
  const navigation = useRouteNavigation()
  const stack = navigation.stack
  const current = navigation.current

  const resources = createMemo(() => stack().filter(isResourceRoute))
  const activeResourceName = createMemo(() => {
    const route = current()
    if (route.type === "resource") {
      return route.resourceName
    }
    return null
  })
  const previousResourceName = createMemo(() => {
    const currentName = activeResourceName()
    if (!currentName) {
      return null
    }
    const list = resources()
    const index = list.findIndex((route) => route.resourceName === currentName)
    if (index <= 0) {
      return null
    }
    return list[index - 1]?.resourceName ?? null
  })

  const goToPreviousResource = () => {
    const name = previousResourceName()
    if (!name) {
      return
    }
    navigation.push(resourceRoute(name))
  }

  const hotkeys: KeyBinding[] = [
    {
      pattern: "shift+tab",
      handler: goToPreviousResource,
      preventDefault: true,
      description: "Switch to previous resource",
      commandPaletteSection: "Navigation",
      enabled: () => previousResourceName() !== null,
    },
  ]

  return (
    <KeyScope bindings={hotkeys}>
      <box
        flexGrow={1}
        position="relative"
      >
        <For each={resources()}>
          {(route) => {
            const isActive = () => activeResourceName() === route.resourceName
            return (
              <box
                flexGrow={1}
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                visible={isActive()}
              >
                <ResourceViewPage
                  resourceName={route.resourceName}
                  isActive={isActive()}
                />
              </box>
            )
          }}
        </For>
      </box>
    </KeyScope>
  )
}

function isResourceRoute(route: RouteLocation): route is ResourceRoute {
  return route.type === "resource"
}
