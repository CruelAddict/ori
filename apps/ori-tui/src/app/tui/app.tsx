import { render, useRenderer } from "@opentui/solid"
import { ClientProvider } from "@ui/providers/client"
import { EventStreamProvider } from "@ui/providers/events"
import { LoggerProvider, useLogger } from "@ui/providers/logger"
import { NavigationProvider } from "@ui/providers/navigation"
import { NotificationsProvider } from "@ui/providers/notifications"
import { OverlayProvider, useOverlayManager } from "@ui/providers/overlay"
import { ResourceProvider } from "@ui/providers/resource"
import { ThemeProvider, useTheme } from "@ui/providers/theme"
import { RouteOutlet } from "@ui/routes/RouteOutlet"
import { useRouteNavigation } from "@ui/routes/router"
import { KeymapProvider, KeyScope, SYSTEM_LAYER } from "@ui/services/key-scopes"
import { CommandPaletteOverlay } from "@ui/widgets/overlay/CommandPaletteOverlay"
import { OverlayHost } from "@ui/widgets/overlay/OverlayHost"
import type { OverlayManager } from "@ui/widgets/overlay/overlay-store"
import { ResourcePickerOverlay } from "@ui/widgets/overlay/ResourcePickerOverlay"
import { ThemePickerOverlay } from "@ui/widgets/overlay/ThemePickerOverlay"
import { copyTextToClipboard, getSelectionOverrideText } from "@utils/clipboard"
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

function openResourcePicker(overlays: OverlayManager) {
  overlays.show({ id: "resource-picker", render: ResourcePickerOverlay })
}

function App() {
  const { theme } = useTheme()
  const palette = theme
  const overlays = useOverlayManager()
  const navigation = useRouteNavigation()
  const renderer = useRenderer()
  const logger = useLogger()

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
    openResourcePicker(overlays)
  })

  const handleMouseUp = async () => {
    const overrideText = getSelectionOverrideText()
    const selectionText = renderer.getSelection?.()?.getSelectedText?.()
    const text = overrideText ?? selectionText
    if (!text || text.length === 0) {
      return
    }
    try {
      await copyTextToClipboard(text, { renderer, logger })
    } catch (err) {
      logger.error({ err }, "copy-on-select: failed to copy selection")
    } finally {
      try {
        renderer.clearSelection?.()
      } catch (err) {
        logger.warn({ err }, "copy-on-select: failed to clear selection")
      }
    }
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: root captures mouse selection for clipboard */
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={palette().get("app_background")}
      onMouseUp={handleMouseUp}
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
            <NotificationsProvider>
              <ResourceProvider>
                <NavigationProvider>
                  <OverlayProvider>
                    <KeymapProvider>
                      <ThemeProvider defaultTheme={options.theme}>
                        <App />
                      </ThemeProvider>
                    </KeymapProvider>
                  </OverlayProvider>
                </NavigationProvider>
              </ResourceProvider>
            </NotificationsProvider>
          </EventStreamProvider>
        </ClientProvider>
      </LoggerProvider>
    ),
    { exitOnCtrlC: true },
  )
}
