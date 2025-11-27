import { createEffect, createSignal } from "solid-js";
import { render } from "@opentui/solid";
import { createLogger } from "@src/lib/logger";
import { parseArgs } from "@src/utils/args";
import { LoggerProvider } from "@app/providers/logger";
import { ClientProvider } from "@app/providers/client";
import { EventStreamProvider } from "@app/providers/events";
import { ConnectionEntityProvider } from "@src/entities/connection/providers/connection-entity-provider";
import { NavigationProvider } from "@app/providers/navigation";
import { OverlayProvider, useOverlayManager } from "@app/providers/overlay";
import type { OverlayManager } from "@app/overlay/overlay-store";
import { OverlayHost } from "@app/overlay/OverlayHost";
import { ConfigurationPickerOverlay } from "@app/overlay/ConfigurationPickerOverlay";
import { QueryJobsProvider } from "@src/entities/query-job/providers/query-jobs-provider";
import { KeymapProvider, KeyScope, SYSTEM_LAYER } from "@src/core/services/key-scopes";
import { ConfigurationEntityProvider } from "@src/entities/configuration/providers/configuration-entity-provider";
import { RouteOutlet } from "@app/routes/RouteOutlet";
import { useRouteNavigation } from "@app/routes/router";
import { ThemeProvider, useTheme } from "@app/providers/theme";
import { ThemePickerOverlay } from "@app/overlay/ThemePickerOverlay";

const AUTO_OPEN_WELCOME_PICKER = process.env["ORI_AUTO_OPEN_PICKER"] !== "0";

function openConfigurationPicker(overlays: OverlayManager) {
    setTimeout(() => {
        overlays.dismiss("configuration-picker");
        overlays.show({ id: "configuration-picker", render: ConfigurationPickerOverlay });
    }, 0);
}

function App() {
    const { theme } = useTheme();
    const palette = theme;
    const overlays = useOverlayManager();
    const navigation = useRouteNavigation();
    const [welcomePickerOpened, setWelcomePickerOpened] = createSignal(false);

    createEffect(() => {
        const route = navigation.current();
        if (route.type !== "welcome" || !AUTO_OPEN_WELCOME_PICKER) {
            setWelcomePickerOpened(false);
            return;
        }
        if (welcomePickerOpened()) {
            return;
        }
        setWelcomePickerOpened(true);
        openConfigurationPicker(overlays);
    });

    return (
        <box flexDirection="column" flexGrow={1} backgroundColor={palette().background}>
            <GlobalHotkeys />
            <RouteOutlet />
            <OverlayHost />
        </box>
    );
}

function GlobalHotkeys() {
    const overlays = useOverlayManager();

    const openThemePicker = () => {
        setTimeout(() => {
            overlays.dismiss("theme-picker");
            overlays.show({ id: "theme-picker", render: ThemePickerOverlay });
        }, 0);
    };

    const openPickerFromHotkey = () => {
        openConfigurationPicker(overlays);
    };

    return (
        <>
            <KeyScope
                id="global"
                bindings={[
                    {
                        pattern: "t",
                        mode: "leader",
                        handler: openThemePicker,
                        preventDefault: true,
                    },
                    {
                        pattern: "c",
                        mode: "leader",
                        handler: openPickerFromHotkey,
                        preventDefault: true,
                    },
                ]}
            />
            <KeyScope
                id="system-shortcuts"
                layer={SYSTEM_LAYER}
                bindings={[
                    {
                        pattern: "ctrl+c",
                        handler: () => {
                            process.exit(0);
                        },
                        preventDefault: true,
                    },
                ]}
            />
        </>
    );
}


export function main() {
    const args = process.argv.slice(2);
    const { serverAddress, socketPath, mode, logLevel, theme: themeArg } = parseArgs(args);

    const [host, portStr] = serverAddress.split(":");
    const port = parseInt(portStr ?? "", 10) || 8080;

    const logger = createLogger("ori-tui", logLevel);
    logger.info({ host, port, mode, socketPath, theme: themeArg }, "tui started");

    render(
        () => (
            <LoggerProvider logger={logger}>
                <ClientProvider
                    options={{
                        mode,
                        host,
                        port,
                        socketPath,
                    }}
                >
                    <EventStreamProvider>
                        <ConfigurationEntityProvider>
                            <ConnectionEntityProvider>
                                <QueryJobsProvider>
                                    <NavigationProvider>
                                        <OverlayProvider>
                                            <KeymapProvider>
                                                <ThemeProvider defaultTheme={themeArg}>
                                                    <App />
                                                </ThemeProvider>
                                            </KeymapProvider>
                                        </OverlayProvider>
                                    </NavigationProvider>
                                </QueryJobsProvider>
                            </ConnectionEntityProvider>
                        </ConfigurationEntityProvider>
                    </EventStreamProvider>
                </ClientProvider>
            </LoggerProvider>
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
