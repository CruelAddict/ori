import { ClientProvider } from "@app/providers/client"
import { EventStreamProvider } from "@app/providers/events"
import { LoggerProvider, useLogger } from "@app/providers/logger"
import { NavigationProvider } from "@app/providers/navigation"
import { NotificationsProvider } from "@app/providers/notifications"
import { OverlayProvider, useOverlayManager } from "@app/providers/overlay"
import { ThemeProvider, useTheme } from "@app/providers/theme"
import { RouteOutlet } from "@app/routes/RouteOutlet"
import { useRouteNavigation } from "@app/routes/router"
import { render, useRenderer } from "@opentui/solid"
import { copyTextToClipboard, getSelectionOverrideText } from "@shared/lib/clipboard"
import type { LogLevel } from "@shared/lib/logger"
import { KeymapProvider, KeyScope, SYSTEM_LAYER } from "@src/core/services/key-scopes"
import { QueryProvider } from "@src/entities/query/providers/query-provider"
import { ResourceEntityProvider } from "@src/entities/resource/providers/resource-entity-provider"
import { ResourceIntrospectionProvider } from "@src/entities/resource-introspection/providers/resource-introspection-provider"
import { CommandPaletteOverlay } from "@widgets/overlay/CommandPaletteOverlay"
import { OverlayHost } from "@widgets/overlay/OverlayHost"
import type { OverlayManager } from "@widgets/overlay/overlay-store"
import { ResourcePickerOverlay } from "@widgets/overlay/ResourcePickerOverlay"
import { ThemePickerOverlay } from "@widgets/overlay/ThemePickerOverlay"
import type { Logger } from "pino"
import { createEffect, createSignal } from "solid-js"

const AUTO_OPEN_WELCOME_PICKER = process.env.ORI_AUTO_OPEN_PICKER !== "0"

type RendererHandle = ReturnType<typeof render>

type StartTuiOptions = {
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

export function startTui(options: StartTuiOptions): RendererHandle {
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
              <ResourceEntityProvider>
                <ResourceIntrospectionProvider>
                  <QueryProvider>
                    <NavigationProvider>
                      <OverlayProvider>
                        <KeymapProvider>
                          <ThemeProvider defaultTheme={options.theme}>
                            <App />
                          </ThemeProvider>
                        </KeymapProvider>
                      </OverlayProvider>
                    </NavigationProvider>
                  </QueryProvider>
                </ResourceIntrospectionProvider>
              </ResourceEntityProvider>
            </NotificationsProvider>
          </EventStreamProvider>
        </ClientProvider>
      </LoggerProvider>
    ),
    { exitOnCtrlC: true },
  )
}
