import { ConnectionViewPage } from "@pages/connection-view/connection-view";
import { WelcomePage } from "@pages/welcome/welcome-page";
import { Show } from "solid-js";
import { useRouteNavigation } from "./router";
import type { ConnectionRoute } from "./types";

export function RouteOutlet() {
    const navigation = useRouteNavigation();
    const current = navigation.current;

    const activeConnectionRoute = () => {
        const route = current();
        return route.type === "connection" ? route : null;
    };

    return (
        <Show
            when={activeConnectionRoute()}
            keyed
            fallback={<WelcomePage />}
        >
            {(route: ConnectionRoute) => (
                <ConnectionViewPage
                    configurationName={route.configurationName}
                    onBack={navigation.pop}
                />
            )}
        </Show>
    );
}
