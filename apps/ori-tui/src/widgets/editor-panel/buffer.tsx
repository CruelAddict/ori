import { useTheme } from "@app/providers/theme";
import { type KeyEvent, type MouseEvent, type TextareaRenderable } from "@opentui/core";
import { type Accessor, For, Show, createEffect, onCleanup, onMount } from "solid-js";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import { createBufferModel } from "./buffer-model";

const BUFFER_SCOPE_ID = "connection-view.buffer";
const DEBOUNCE_MS = 200;

export type BufferApi = {
    setText: (text: string) => void;
    focus: () => void;
};

export type BufferProps = {
    initialText: string;
    isFocused: Accessor<boolean>;
    onTextChange: (text: string, info: { modified: boolean }) => void;
    onUnfocus?: () => void;
    registerApi?: (api: BufferApi) => void;
};

export function Buffer(props: BufferProps) {
    const { theme } = useTheme();
    const palette = theme();

    const bufferModel = createBufferModel({
        initialText: props.initialText,
        isFocused: props.isFocused,
        onTextChange: props.onTextChange,
        debounceMs: DEBOUNCE_MS,
    });

    const focus = () => {
        bufferModel.focusCurrent();
    };

    const setText = (text: string) => {
        bufferModel.setText(text);
    };

    onMount(() => {
        const api: BufferApi = { setText, focus };
        props.registerApi?.(api);
    });

    onCleanup(() => {
        bufferModel.dispose();
    });

    const handleMouseDown = (index: number, event: MouseEvent) => {
        event.target?.focus();
        bufferModel.setFocusedRow(index);
    };

    const bindings: KeyBinding[] = [
        {
            pattern: "escape",
            handler: () => {
                bufferModel.flush();
                props.onUnfocus?.();
            },
            preventDefault: true,
        },
        {
            pattern: "return",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                event.preventDefault();
                bufferModel.handleEnter(ctx.index);
            },
        },
        {
            pattern: "up",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                event.preventDefault();
                bufferModel.setNavColumn(ctx.cursorCol);
                bufferModel.handleVerticalMove(ctx.index, -1);
            },
        },
        {
            pattern: "down",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                event.preventDefault();
                bufferModel.setNavColumn(ctx.cursorCol);
                bufferModel.handleVerticalMove(ctx.index, 1);
            },
        },
        {
            pattern: "left",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
                if (atStart) {
                    event.preventDefault();
                    bufferModel.handleHorizontalJump(ctx.index, true);
                }
            },
        },
        {
            pattern: "right",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
                if (atEnd) {
                    event.preventDefault();
                    bufferModel.handleHorizontalJump(ctx.index, false);
                }
            },
        },
        {
            pattern: "backspace",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
                if (atStart) {
                    event.preventDefault();
                    bufferModel.handleBackwardMerge(ctx.index);
                }
            },
        },
        {
            pattern: "delete",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
                if (atEnd) {
                    event.preventDefault();
                    bufferModel.handleForwardMerge(ctx.index);
                }
            },
        },
        {
            pattern: "ctrl+h",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
                if (atStart) {
                    event.preventDefault();
                    bufferModel.handleBackwardMerge(ctx.index);
                }
            },
        },
        {
            pattern: "ctrl+w",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
                if (atStart) {
                    event.preventDefault();
                    bufferModel.handleBackwardMerge(ctx.index);
                }
            },
        },
        {
            pattern: "ctrl+d",
            handler: (event: KeyEvent) => {
                const ctx = bufferModel.getCursorContext();
                if (!ctx) {
                    return;
                }
                bufferModel.setNavColumn(ctx.cursorCol);
                const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
                if (atEnd) {
                    event.preventDefault();
                    bufferModel.handleForwardMerge(ctx.index);
                }
            },
        },
    ];

    createEffect(() => {
        bufferModel.handleFocusChange(props.isFocused());
    });

    return (
        <KeyScope id={BUFFER_SCOPE_ID} bindings={bindings} enabled={props.isFocused}>
            <scrollbox scrollbarOptions={{ visible: false }}>
                <box flexDirection="column">
                    <For each={bufferModel.lines()}>
                        {(line, indexAccessor) => {
                            const index = indexAccessor();
                            return (
                                <textarea
                                    ref={(renderable: TextareaRenderable | undefined) => {
                                        bufferModel.setLineRef(line.id, renderable);
                                    }}
                                    placeholder={`Type to begin... (Enter inserts line, Ctrl+X then Enter executes)`}
                                    textColor={palette.editorText}
                                    focusedTextColor={palette.editorText}
                                    cursorColor={palette.primary}
                                    selectable={true}
                                    keyBindings={[]}
                                    onMouseDown={(event: MouseEvent) => {
                                        handleMouseDown(index, event);
                                    }}
                                    onContentChange={() => bufferModel.handleTextAreaChange(index)}
                                    initialValue={line.text}
                                />
                            );
                        }}
                    </For>
                    <Show when={bufferModel.lines().length === 0}>
                        <text fg={palette.editorText}> </text>
                    </Show>
                </box>
            </scrollbox>
        </KeyScope>
    );
}
