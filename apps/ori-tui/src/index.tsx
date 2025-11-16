import { render } from "@opentui/solid";
import { Match, Switch, createMemo } from "solid-js";
import { ConnectionView } from "@src/ui/screens/ConnectionView";
import { createLogger } from "@src/lib/logger";
import { parseArgs } from "@src/utils/args";
import { useFocusNavigation } from "@src/hooks/useFocusNavigation";
import { LoggerProvider } from "@src/providers/logger";
import { ClientProvider } from "@src/providers/client";
import { ConnectionStateProvider, useConnectionState } from "@src/providers/connectionState";
import { NavigationProvider, OverlayHost, useNavigation, type ConnectionPage } from "@src/providers/navigation";
import { QueryJobsProvider } from "@src/providers/queryJobs";
import { KeymapProvider, KeyScope } from "@src/core/services/keyScopes";
import { ConfigurationListScreen } from "@src/ui/screens/ConfigurationList";
import { ConfigurationsServiceProvider } from "@src/core/services/configurations";
import { ConfigurationListStoreProvider } from "@src/core/stores/configurationListStore";

function App() {
    useFocusNavigation();

    const connectionState = useConnectionState();
    const navigation = useNavigation();

    const currentPage = navigation.current;
    const connectionPage = createMemo(() => {
        const page = currentPage();
        return page.type === "connection" ? page : null;
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
                    <ConfigurationListScreen />
                </Match>
            </Switch>
            <OverlayHost />
        </>
    );
}

function GlobalHotkeys() {
    return (
        <KeyScope
            id="global"
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
    );
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
                    <ConfigurationsServiceProvider>
                        <ConfigurationListStoreProvider>
                            <ConnectionStateProvider>
                                <QueryJobsProvider>
                                    <NavigationProvider>
                                        <KeymapProvider>
                                            <App />
                                        </KeymapProvider>
                                    </NavigationProvider>
                                </QueryJobsProvider>
                            </ConnectionStateProvider>
                        </ConfigurationListStoreProvider>
                    </ConfigurationsServiceProvider>
                </ClientProvider>
            </LoggerProvider>
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
