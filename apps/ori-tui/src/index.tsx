import { render } from "@opentui/solid";
import { Match, Switch, createMemo } from "solid-js";
import { ConnectionViewPage } from "@src/pages/connection-view/connection-view";
import { createLogger } from "@src/lib/logger";
import { parseArgs } from "@src/utils/args";
import { LoggerProvider } from "@src/providers/logger";
import { ClientProvider } from "@src/providers/client";
import { ConnectionEntityProvider } from "@src/entities/connection/providers/connection-entity-provider";
import { NavigationProvider, OverlayHost, useNavigation, type ConnectionPage } from "@src/providers/navigation";
import { QueryJobsProvider } from "@src/entities/query-job/providers/query-jobs-provider";
import { KeymapProvider, KeyScope } from "@src/core/services/key-scopes";
import { ConfigurationViewPage } from "@src/pages/configuration-view/configuration-view";
import { ConfigurationEntityProvider } from "@src/entities/configuration/providers/configuration-entity-provider";

function App() {
    const navigation = useNavigation();

    const currentPage = navigation.current;
    const connectionPage = createMemo(() => {
        const page = currentPage();
        return page.type === "connection" ? page : null;
    });

    const handleConnectionBack = () => {
        navigation.pop();
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
