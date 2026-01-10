import { useTheme } from "@app/providers/theme"
import { ConnectionViewPage } from "@pages/connection-view/connection-view"
import { WelcomePage } from "@pages/welcome/welcome-page"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import { createMemo, For } from "solid-js"
import { useRouteNavigation } from "./router"
import { type ConnectionRoute, connectionRoute, type RouteLocation } from "./types"

export function RouteOutlet() {
  const navigation = useRouteNavigation()
  const stack = navigation.stack
  const current = navigation.current

  const connections = createMemo(() => stack().filter(isConnectionRoute))
  const activeConnectionName = createMemo(() => {
    const route = current()
    if (route.type === "connection") {
      return route.configurationName
    }
    return null
  })
  const showWelcome = createMemo(() => activeConnectionName() === null)
  const previousConnectionName = createMemo(() => {
    const currentName = activeConnectionName()
    if (!currentName) {
      return null
    }
    const list = connections()
    const index = list.findIndex((route) => route.configurationName === currentName)
    if (index <= 0) {
      return null
    }
    return list[index - 1]?.configurationName ?? null
  })

  const goToPreviousConnection = () => {
    const name = previousConnectionName()
    if (!name) {
      return
    }
    navigation.push(connectionRoute(name))
  }

  const hotkeys: KeyBinding[] = [
    {
      pattern: "shift+tab",
      handler: goToPreviousConnection,
      preventDefault: true,
      description: "Switch to previous connection",
      commandPaletteSection: "Navigation",
      enabled: () => previousConnectionName() !== null,
    },
  ]

  return (
    <KeyScope bindings={hotkeys}>
      <box
        flexGrow={1}
        position="relative"
      >
        <box
          flexGrow={1}
          visible={showWelcome()}
        >
          <WelcomePage />
        </box>
        <For each={connections()}>
          {(route) => {
            const isActive = () => activeConnectionName() === route.configurationName
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
                <ConnectionViewPage
                  configurationName={route.configurationName}
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

function isConnectionRoute(route: RouteLocation): route is ConnectionRoute {
  return route.type === "connection"
}
