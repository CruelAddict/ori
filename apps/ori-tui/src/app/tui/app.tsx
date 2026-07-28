import { render, useRenderer } from "@opentui/solid"
import { AppContextProvider } from "@ui/providers/app-context"
import { ClientProvider } from "@ui/providers/client"
import { EventStreamProvider } from "@ui/providers/events"
import { LoggerProvider } from "@ui/providers/logger"
import { NavigationProvider } from "@ui/providers/navigation"
import { OverlayProvider, useOverlayManager } from "@ui/providers/overlay"
import { ResourceProvider } from "@ui/providers/resource"
import { ThemeProvider, useTheme } from "@ui/providers/theme"
import { RouteOutlet } from "@ui/routes/RouteOutlet"
import { useRouteNavigation } from "@ui/routes/router"
import { useSelectionController } from "@ui/selection/selection-controller"
import { SelectionLockProvider } from "@ui/selection/selection-lock"
import { KeymapProvider, KeyScope, SYSTEM_LAYER } from "@ui/services/key-scopes"
import { CommandPaletteOverlay } from "@ui/widgets/overlay/CommandPaletteOverlay"
import { OverlayHost } from "@ui/widgets/overlay/OverlayHost"
import type { OverlayManager } from "@ui/widgets/overlay/overlay-store"
import { ResourcePickerOverlay } from "@ui/widgets/overlay/ResourcePickerOverlay"
import { ThemePickerOverlay } from "@ui/widgets/overlay/ThemePickerOverlay"
import type { LogLevel } from "@utils/logger"
import type { Logger } from "pino"
import { createEffect, createSignal } from "solid-js"

const AUTO_OPEN_WELCOME_PICKER = process.env.ORI_AUTO_OPEN_PICKER !== "0"

type RendererHandle = ReturnType<typeof render>

type StartAppOptions = {
  socketPath?: string
  host?: string
  port?: number
  logLevel: LogLevel
  theme?: string
  logger: Logger
}

function openResourcePicker(overlays: OverlayManager, canCancel = true) {
  overlays.show({
    id: "resource-picker",
    render: (props) => (
      <ResourcePickerOverlay
        {...props}
        canCancel={canCancel}
      />
    ),
  })
}

function App() {
  const { theme } = useTheme()
  const palette = theme
  const overlays = useOverlayManager()
  const navigation = useRouteNavigation()
  const selection = useSelectionController()

  // opentui bug workaround: without it mouse hit grid (for scrollbox scrolling) doesn't respect viewport content clipping
  const [welcomePickerOpened, setWelcomePickerOpened] = createSignal(false)

  createEffect(() => {
    const route = navigation.current()
    if (route.type !== "welcome" || !AUTO_OPEN_WELCOME_PICKER) {
      setWelcomePickerOpened(false)
      return
    }
    if (welcomePickerOpened()) {
      return
    }
    setWelcomePickerOpened(true)
    openResourcePicker(overlays, false)
  })

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: app root observes global OpenTUI selection lifecycle */
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={palette().get("app_background")}
      onMouseMove={selection.rootHandlers.onMouseMove}
      onMouseUp={selection.rootHandlers.onMouseUp}
    >
      <GlobalHotkeys />
      <RouteOutlet />
      <OverlayHost />
    </box>
  )
}

function GlobalHotkeys() {
  const overlays = useOverlayManager()
  const renderer = useRenderer()

  const openThemePicker = () => {
    overlays.show({ id: "theme-picker", render: ThemePickerOverlay })
  }

  const openPickerFromHotkey = () => {
    openResourcePicker(overlays)
  }

  const openCommandPalette = () => {
    overlays.show({ id: "command-palette", render: CommandPaletteOverlay })
  }

  return (
    <>
      <KeyScope
        bindings={[
          {
            pattern: "t",
            mode: "leader",
            description: "Change theme",
            handler: openThemePicker,
            preventDefault: true,
            commandPaletteSection: "System",
          },
          {
            pattern: "c",
            mode: "leader",
            description: "Switch resource",
            handler: openPickerFromHotkey,
            preventDefault: true,
            commandPaletteSection: "Resource",
          },
        ]}
      />
      <KeyScope
        layer={SYSTEM_LAYER}
        bindings={[
          {
            pattern: "ctrl+c",
            handler: () => {
              renderer.destroy()
              process.exit(0)
            },
            preventDefault: true,
          },
          {
            pattern: "ctrl+p",
            handler: openCommandPalette,
            preventDefault: true,
          },
        ]}
      />
    </>
  )
}

export function startApp(options: StartAppOptions): RendererHandle {
  const host = options.host ?? "localhost"
  const port = options.port ?? 8080
  const transport = options.socketPath ? "unix" : "tcp"

  options.logger.info(
    {
      transport,
      host: transport === "tcp" ? host : undefined,
      port: transport === "tcp" ? port : undefined,
      socketPath: options.socketPath,
      theme: options.theme,
    },
    "tui started",
  )

  const clientOptions = options.socketPath ? { socketPath: options.socketPath } : { host, port }

  return render(
    () => (
      <LoggerProvider logger={options.logger}>
        <ClientProvider options={clientOptions}>
          <EventStreamProvider>
            <ResourceProvider>
              <NavigationProvider>
                <AppContextProvider>
                  <OverlayProvider>
                    <KeymapProvider>
                      <ThemeProvider defaultTheme={options.theme}>
                        <SelectionLockProvider>
                          <App />
                        </SelectionLockProvider>
                      </ThemeProvider>
                    </KeymapProvider>
                  </OverlayProvider>
                </AppContextProvider>
              </NavigationProvider>
            </ResourceProvider>
          </EventStreamProvider>
        </ClientProvider>
      </LoggerProvider>
    ),
    { exitOnCtrlC: true },
  )
}
