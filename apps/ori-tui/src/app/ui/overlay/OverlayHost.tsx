import { useOverlayManager } from "@app/providers/overlay";
import { useTheme } from "@app/providers/theme";
import { withAlpha } from "@shared/lib/color/with-alpha";
import { KeyScope } from "@src/core/services/key-scopes";
import { createMemo, For, Show } from "solid-js";

export function OverlayHost() {
    const overlays = useOverlayManager();
    const { theme } = useTheme();
    const entries = () => overlays.overlays();
    const hasOverlays = () => entries().length > 0;
    const scrimColor = createMemo(() => withAlpha(theme().background, 0.68));

    return (
        <Show when={hasOverlays()}>
            <box
                top={0}
                left={0}
                right={0}
                bottom={0}
                position="absolute"
                zIndex={9_999}
                backgroundColor={scrimColor()}
            />
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
                            <KeyScope
                                id={`overlay-${entry.id}`}
                                bindings={[]}
                                layer={entry.zIndex}
                            >
                                <Render close={() => overlays.dismiss(entry.id)} />
                            </KeyScope>
                        );
                    }}
                </For>
            </box>
        </Show>
    );
}
