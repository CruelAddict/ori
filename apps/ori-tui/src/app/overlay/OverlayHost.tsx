import { For } from "solid-js";
import { useOverlayManager } from "@app/providers/overlay";

export function OverlayHost() {
    const overlays = useOverlayManager();
    return (
        <For each={overlays.overlays()}>
            {(entry) => {
                const Render = entry.render;
                return <Render close={() => overlays.dismiss(entry.id)} />;
            }}
        </For>
    );
}
