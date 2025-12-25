import { ConnectionViewPage } from "@pages/connection-view/connection-view";
import { WelcomePage } from "@pages/welcome/welcome-page";
import { createMemo, For } from "solid-js";
import { useRouteNavigation } from "./router";
import type { ConnectionRoute, RouteLocation } from "./types";

export function RouteOutlet() {
  const navigation = useRouteNavigation();
  const stack = navigation.stack;
  const current = navigation.current;

  const connections = createMemo(() => stack().filter(isConnectionRoute));
  const activeConnectionName = createMemo(() => {
    const route = current();
    if (route.type === "connection") {
      return route.configurationName;
    }
    return null;
  });
  const showWelcome = createMemo(() => activeConnectionName() === null);

  return (
    <box
      flexGrow={1}
      position="relative"
    >
      <box
        flexGrow={1}
        visible={showWelcome()}
      >
        <WelcomePage />
      </box>
      <For each={connections()}>
        {(route) => {
          const isActive = () => activeConnectionName() === route.configurationName;
          return (
            <box
              flexGrow={1}
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              visible={isActive()}
            >
              <ConnectionViewPage
                configurationName={route.configurationName}
                isActive={isActive()}
              />
            </box>
          );
        }}
      </For>
    </box>
  );
}

function isConnectionRoute(route: RouteLocation): route is ConnectionRoute {
  return route.type === "connection";
}
