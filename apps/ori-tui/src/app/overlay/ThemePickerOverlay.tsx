import { For, Show, createSignal } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { KeyScope } from "@src/core/services/key-scopes";
import type { OverlayComponentProps } from "@app/overlay/overlay-store";
import { useTheme } from "@app/providers/theme";

export function ThemePickerOverlay(props: OverlayComponentProps) {
    const { theme, availableThemes, selectedTheme, setTheme } = useTheme();
    const palette = theme;
    const themes = availableThemes;
    const initialIndex = Math.max(
        themes.findIndex((option) => option.name === selectedTheme()),
        0
    );
    const [cursor, setCursor] = createSignal(initialIndex);

    const move = (delta: number) => {
        const next = (cursor() + delta + themes.length) % themes.length;
        setCursor(next);
        setTheme(themes[next].name);
    };

    const choose = () => {
        const entry = themes[cursor()];
        if (!entry) return;
        setTheme(entry.name);
        props.close();
    };

    const bindings = [
        { pattern: "escape", handler: props.close, preventDefault: true },
        { pattern: "up", handler: () => move(-1), preventDefault: true },
        { pattern: "k", handler: () => move(-1), preventDefault: true },
        { pattern: "down", handler: () => move(1), preventDefault: true },
        { pattern: "j", handler: () => move(1), preventDefault: true },
        { pattern: "return", handler: choose, preventDefault: true },
    ];

    return (
        <KeyScope id="theme-picker" bindings={bindings}>
            <box
                marginTop={2}
                marginLeft={4}
                width={40}
                borderColor={palette().borderActive}
                backgroundColor={palette().backgroundPanel}
                padding={1}
                flexDirection="column"
            >
                <text fg={palette().text} attributes={TextAttributes.BOLD}>
                    Select Theme
                </text>
                <box height={1} />
                <For each={themes}>
                    {(entry, index) => {
                        const isCursor = () => index() === cursor();
                        const isActive = () => entry.name === selectedTheme();
                        return (
                            <box
                                flexDirection="row"
                                backgroundColor={isCursor() ? palette().primary : undefined}
                            >
                                <text
                                    fg={isCursor() ? palette().background : palette().text}
                                    attributes={isActive() ? TextAttributes.BOLD : TextAttributes.NONE}
                                >
                                    {isCursor() ? " → " : "   "}
                                    {entry.label}
                                </text>
                            </box>
                        );
                    }}
                </For>
                <box height={1} />
            </box>
        </KeyScope>
    );
}
