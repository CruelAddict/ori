import { render } from "@opentui/solid";
import { Match, Switch, createEffect, createMemo } from "solid-js";
import { ConfigurationSelector } from "@src/components/ConfigurationSelector";
import { ConnectionView } from "@src/components/ConnectionView";
import { createLogger } from "@src/lib/logger";
import { parseArgs } from "@src/utils/args";
import { LoggerProvider } from "@src/providers/logger";
import { ClientProvider } from "@src/providers/client";
import { ConfigurationsProvider } from "@src/providers/configurations";
import { ConnectionStateProvider, useConnectionState } from "@src/providers/connectionState";
import { NavigationProvider, OverlayHost, useNavigation, type ConnectionPage } from "@src/providers/navigation";
import { KeymapProvider, useScopedKeymap } from "@src/providers/keymap";

function App() {
    const connectionState = useConnectionState();
    const navigation = useNavigation();

    const currentPage = navigation.current;
    const connectionPage = createMemo(() => {
        const page = currentPage();
        return page.type === "connection" ? page : null;
    });

    createEffect(() => {
        const focusName = connectionState.focusedConfigurationName();
        const pages = navigation.stack();
        const depth = pages.length;
        const top = pages[depth - 1];

        if (focusName) {
            if (depth === 1) {
                navigation.push({ type: "connection", configurationName: focusName });
                return;
            }
            if (depth === 2) {
                if (top?.type === "connection") {
                    if (top.configurationName !== focusName) {
                        navigation.replace({ type: "connection", configurationName: focusName });
                    }
                } else {
                    navigation.push({ type: "connection", configurationName: focusName });
                }
            }
            return;
        }

        if (depth === 2 && top?.type === "connection") {
            navigation.pop();
        }
    });

    const handleConnectionBack = () => {
        navigation.pop();
        connectionState.focus(null);
    };

    return (
        <>
            <GlobalHotkeys />
            <Switch>
                <Match when={connectionPage()}>
                    {(page: () => ConnectionPage) => (
                        <ConnectionView
                            configurationName={page().configurationName}
                            onBack={handleConnectionBack}
                        />
                    )}
                </Match>
                <Match when={true}>
                    <ConfigurationSelector />
                </Match>
            </Switch>
            <OverlayHost />
        </>
    );
}

function GlobalHotkeys() {
    useScopedKeymap("global", [
        {
            pattern: "ctrl+c",
            handler: () => {
                process.exit(0);
            },
            preventDefault: true,
        },
    ]);
    return null;
}



export function main() {
    const args = process.argv.slice(2);
    const { serverAddress, socketPath, mode, logLevel } = parseArgs(args);

    const [host, portStr] = serverAddress.split(":");
    const port = parseInt(portStr ?? "", 10) || 8080;

    const logger = createLogger("ori-tui", logLevel);
    logger.info({ host, port, mode, socketPath }, "tui started");

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
                    <ConfigurationsProvider>
                        <ConnectionStateProvider>
                            <NavigationProvider>
                                <KeymapProvider>
                                    <App />
                                </KeymapProvider>
                            </NavigationProvider>
                        </ConnectionStateProvider>
                    </ConfigurationsProvider>
                </ClientProvider>
            </LoggerProvider>
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
