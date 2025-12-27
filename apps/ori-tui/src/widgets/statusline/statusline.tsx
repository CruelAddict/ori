import { For, type JSXElement, Show } from "solid-js";
import { useStatusline } from "./statusline-context";

export { StatuslineProvider } from "./statusline-context";

function elementsWithDelimiter(elements: JSXElement[], delimiter: string) {
  return (
    <For each={elements}>
      {(item, index) => (
        <>
          <Show when={index() > 0}>
            <text>{delimiter}</text>
          </Show>
          {item}
        </>
      )}
    </For>
  );
}

export function Statusline() {
  const statusline = useStatusline();
  const state = statusline.state;

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      minHeight={1}
      maxHeight={1}
      marginTop={1}
      marginBottom={1}
      paddingLeft={3}
      paddingRight={3}
    >
      <box flexDirection="row">{elementsWithDelimiter(state().left, "  ")}</box>
      <box flexDirection="row">{elementsWithDelimiter(state().right.reverse(), "  ")}</box>
    </box>
  );
}
