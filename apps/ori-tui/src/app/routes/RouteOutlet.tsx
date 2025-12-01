import { ConnectionViewPage } from "@pages/connection-view/connection-view";
import { WelcomePage } from "@pages/welcome/welcome-page";
import { createMemo, Show } from "solid-js";
import { useRouteNavigation } from "./router";

export function RouteOutlet() {
    const navigation = useRouteNavigation();
    const current = navigation.current;

    const activeConnectionName = createMemo(() => {
        const route = current();
        return route.type === "connection" ? route.configurationName : null;
    });

    return (
        <Show
            when={activeConnectionName()}
            keyed
            fallback={<WelcomePage />}
        >
            {(configurationName: string) => <ConnectionViewPage configurationName={configurationName} />}
        </Show>
    );
}
