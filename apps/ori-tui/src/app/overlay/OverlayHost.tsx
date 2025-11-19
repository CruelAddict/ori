import { For, Show } from "solid-js";
import { useOverlayManager } from "@app/providers/overlay";

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
                        return <Render close={() => overlays.dismiss(entry.id)} />;
                    }}
                </For>
            </box>
        </Show>
    );
}
