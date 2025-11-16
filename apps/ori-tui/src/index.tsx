import { render } from "@opentui/solid";
import { Match, Switch, createMemo } from "solid-js";
import { ConnectionViewPage } from "@src/pages/connection_view/connection_view";
import { createLogger } from "@src/lib/logger";
import { parseArgs } from "@src/utils/args";
import { useFocusNavigation } from "@src/hooks/useFocusNavigation";
import { LoggerProvider } from "@src/providers/logger";
import { ClientProvider } from "@src/providers/client";
import { useConnectionState } from "@src/entities/connection/model/connection_state";
import { ConnectionEntityProvider } from "@src/entities/connection/providers/connection_entity_provider";
import { NavigationProvider, OverlayHost, useNavigation, type ConnectionPage } from "@src/providers/navigation";
import { QueryJobsProvider } from "@src/entities/query-job/providers/query_jobs_provider";
import { KeymapProvider, KeyScope } from "@src/core/services/keyScopes";
import { ConfigurationViewPage } from "@src/pages/configuration_view/configuration_view";
import { ConfigurationEntityProvider } from "@src/entities/configuration/providers/configuration_entity_provider";

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
                        <ConnectionViewPage
                            configurationName={page().configurationName}
                            onBack={handleConnectionBack}
                        />
                    )}
                </Match>
                <Match when={true}>
                    <ConfigurationViewPage />
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
                    <ConfigurationEntityProvider>
                        <ConnectionEntityProvider>
                            <QueryJobsProvider>
                                <NavigationProvider>
                                    <KeymapProvider>
                                        <App />
                                    </KeymapProvider>
                                </NavigationProvider>
                            </QueryJobsProvider>
                        </ConnectionEntityProvider>
                    </ConfigurationEntityProvider>
                </ClientProvider>
            </LoggerProvider>
        ),
        { exitOnCtrlC: false }
    );
}

if (import.meta.main) {
    main();
}
