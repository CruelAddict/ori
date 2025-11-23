import { Show } from "solid-js";
import { WelcomePage } from "@pages/welcome/welcome-page";
import { ConnectionViewPage } from "@pages/connection-view/connection-view";
import type { ConnectionRoute } from "./types";
import { useRouteNavigation } from "./router";

export function RouteOutlet() {
    const navigation = useRouteNavigation();
    const current = navigation.current;

    const activeConnectionRoute = () => {
        const route = current();
        return route.type === "connection" ? route : null;
    };

    return (
        <Show when={activeConnectionRoute()} keyed fallback={<WelcomePage />}>
            {(route: ConnectionRoute) => (
                <ConnectionViewPage configurationName={route.configurationName} onBack={navigation.pop} />
            )}
        </Show>
    );
}
