import { For, Show } from "solid-js";
import { useOverlayManager } from "@app/providers/overlay";
import { KeyScope } from "@src/core/services/key-scopes";

export function OverlayHost() {
    const overlays = useOverlayManager();
    const entries = () => overlays.overlays();
    const hasOverlays = () => entries().length > 0;

    return (
        <Show when={hasOverlays()}>
            <box
                top={0}
                left={0}
                right={0}
                bottom={0}
                position="absolute"
                zIndex={10_000}
                justifyContent="center"
                alignItems="center"
            >
                <For each={entries()}>
                    {(entry) => {
                        const Render = entry.render;
                        return (
                            <KeyScope id={`overlay-${entry.id}`} bindings={[]} layer={entry.zIndex}>
                                <Render close={() => overlays.dismiss(entry.id)} />
                            </KeyScope>
                        );
                    }}
                </For>
            </box>
        </Show>
    );
}
