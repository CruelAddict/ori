import { type KeyEvent, type MouseEvent, type TextareaRenderable } from "@opentui/core";
import { type Accessor, For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { debounce } from "@solid-primitives/scheduled";
import { createStore } from "solid-js/store";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";

const BUFFER_SCOPE_ID = "connection-view.buffer";
const DEBOUNCE_MS = 200;

export type BufferPalette = {
    editorText: string;
    primary: string;
};

export type BufferApi = {
    acceptExternal: (text: string, version?: string) => void;
    flush: () => void;
    focus: () => void;
};

export type BufferProps = {
    initialText: string;
    isFocused: Accessor<boolean>;
    palette: BufferPalette;
    onPush?: (text: string, version: string) => void;
    onUnfocus?: () => void;
    registerApi?: (api: BufferApi) => void;
};

type CursorContext = {
    index: number;
    node: TextareaRenderable;
    cursorCol: number;
    cursorRow: number;
    text: string;
};

type Line = {
    id: string;
    text: string;
};

type BufferState = {
    lines: Line[];
};

let lineIdCounter = 0;
const nextLineId = () => `line-${lineIdCounter++}`;

function makeLine(text: string): Line {
    return { id: nextLineId(), text };
}

function makeLinesFromText(text: string): Line[] {
    const parts = text.split("\n");
    const safeParts = parts.length > 0 ? parts : [""];
    return safeParts.map((part) => makeLine(part));
}


function hashText(text: string): string {
    const prime = 16777619;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, prime);
    }
    return `ext:${(hash >>> 0).toString(16)}`;
}

export function Buffer(props: BufferProps) {
    const [state, setState] = createStore<BufferState>({ lines: makeLinesFromText(props.initialText) });
    const [focusedRow, setFocusedRow] = createSignal(0);
    const [navColumn, setNavColumn] = createSignal(0);
    const [lastVersion, setLastVersion] = createSignal(hashText(props.initialText));
    const [localCounter, setLocalCounter] = createSignal(0);
    const textareaRefs: Array<TextareaRenderable | undefined> = [];
    let suppressContentChange = false;
    let pendingExternalText: string | undefined;
    let pushScheduled = false;

    const focusLine = (index: number, column: number) => {
        const node = textareaRefs[index];
        if (!node) {
            return;
        }
        if (!props.isFocused()) {
            return;
        }
        node.focus();
        const targetCol = Math.min(column, node.plainText.length);
        node.editBuffer.setCursorToLineCol(0, targetCol);
        setFocusedRow(index);
    };

    const clampFocus = (lines: Line[]) => {
        const targetRow = Math.min(focusedRow(), Math.max(0, lines.length - 1));
        const targetCol = Math.min(navColumn(), lines[targetRow]?.text.length ?? 0);
        setFocusedRow(targetRow);
        setNavColumn(targetCol);
        queueMicrotask(() => focusLine(targetRow, targetCol));
    };

    const getLineText = (index: number): string => {
        const node = textareaRefs[index];
        if (node) {
            return node.plainText;
        }
        return state.lines[index]?.text ?? "";
    };

    const emitPush = () => {
        const lines = state.lines.map((_, i) => getLineText(i));
        const text = lines.join("\n");
        const nextCount = localCounter() + 1;
        const version = `local:${nextCount}`;
        setLocalCounter(nextCount);
        setLastVersion(version);
        props.onPush?.(text, version);
    };

    const debouncedPush = debounce(() => {
        pushScheduled = false;
        emitPush();
    }, DEBOUNCE_MS);

    onCleanup(() => {
        pushScheduled = false;
        debouncedPush.clear();
    });

    const syncTextareasFromLines = (lines: Line[]) => {
        suppressContentChange = true;
        textareaRefs.length = lines.length;
        lines.forEach((line, idx) => {
            const node = textareaRefs[idx];
            if (!node) {
                return;
            }
            if (node.plainText !== line.text) {
                node.setText(line.text, { history: false });
            }
        });
        suppressContentChange = false;
    };

    const acceptExternal = (text: string, version?: string) => {
        const token = version ?? hashText(text);
        if (token === lastVersion()) {
            return;
        }
        const nextLines = makeLinesFromText(text);
        setState("lines", nextLines);
        setLastVersion(token);
        clampFocus(nextLines);
        syncTextareasFromLines(nextLines);
    };

    const flush = () => {
        if (!pushScheduled) {
            return;
        }
        pushScheduled = false;
        debouncedPush.clear();
        emitPush();
    };

    const schedulePush = () => {
        pushScheduled = true;
        debouncedPush();
    };

    const focus = () => {
        focusLine(focusedRow(), navColumn());
    };

    onMount(() => {
        const api: BufferApi = { acceptExternal, flush, focus };
        props.registerApi?.(api);
        if (pendingExternalText !== undefined) {
            acceptExternal(pendingExternalText);
            pendingExternalText = undefined;
        }
    });

    const getCursorContext = (): CursorContext | undefined => {
        const index = focusedRow();
        const node = textareaRefs[index];
        if (!node) {
            return undefined;
        }
        const cursor = node.logicalCursor;
        const text = getLineText(index);
        return { index, node, cursorCol: cursor.col, cursorRow: cursor.row, text };
    };

    const handleMouseDown = (index: number, event: MouseEvent) => {
        event.target?.focus();
        setFocusedRow(index);
    };

    const handleContentChange = (index: number) => {
        const node = textareaRefs[index];
        if (!node || suppressContentChange) {
            return;
        }
        const text = node.plainText;
        if (!text.includes("\n")) {
            schedulePush();
            return;
        }
        const pieces = text.split("\n");
        const head = pieces[0] ?? "";
        const tail = pieces.slice(1);
        const targetIndex = index + tail.length;
        setState("lines", (prev) => {
            const next = [...prev];
            const current = next[index];
            if (!current) {
                return prev;
            }
            const headLine: Line = { ...current, text: head };
            const tailLines = tail.map((segment) => makeLine(segment));
            next.splice(index, 1, headLine, ...tailLines);
            return next;
        });
        setFocusedRow(targetIndex);
        setNavColumn(tail[tail.length - 1]?.length ?? head.length);
        schedulePush();
        queueMicrotask(() => focusLine(targetIndex, navColumn()));
    };

    const handleEnter = (event: KeyEvent, index: number) => {
        event.preventDefault();
        const node = textareaRefs[index];
        if (!node) {
            return;
        }
        const cursor = node.logicalCursor;
        const value = getLineText(index);
        const before = value.slice(0, cursor.col);
        const after = value.slice(cursor.col);
        const nextIndex = index + 1;
        setState("lines", (prev) => {
            const next = [...prev];
            const current = next[index];
            if (!current) {
                return prev;
            }
            const headLine: Line = { ...current, text: before };
            const tailLine = makeLine(after);
            next.splice(index, 1, headLine, tailLine);
            return next;
        });
        setFocusedRow(nextIndex);
        setNavColumn(0);
        schedulePush();
        queueMicrotask(() => focusLine(nextIndex, 0));
    };

    const handleBackwardMerge = (event: KeyEvent, index: number) => {
        const prevIndex = index - 1;
        if (prevIndex < 0) {
            return;
        }
        const currentText = getLineText(index);
        const prevText = getLineText(prevIndex);
        setState("lines", (prev) => {
            const next = [...prev];
            const prevLine = next[prevIndex];
            if (!prevLine) {
                return prev;
            }
            const mergedLine: Line = { ...prevLine, text: prevText + currentText };
            next.splice(prevIndex, 2, mergedLine);
            return next;
        });
        const newCol = prevText.length;
        setFocusedRow(prevIndex);
        setNavColumn(newCol);
        schedulePush();
        event.preventDefault();
        queueMicrotask(() => focusLine(prevIndex, newCol));
    };

    const handleForwardMerge = (event: KeyEvent, index: number) => {
        const nextIndex = index + 1;
        const nextLine = state.lines[nextIndex];
        if (nextLine === undefined) {
            return;
        }
        const currentText = getLineText(index);
        const nextText = getLineText(nextIndex);
        setState("lines", (prev) => {
            const next = [...prev];
            const currentLine = next[index];
            if (!currentLine) {
                return prev;
            }
            const mergedLine: Line = { ...currentLine, text: currentText + nextText };
            next.splice(index, 2, mergedLine);
            return next;
        });
        const newCol = currentText.length;
        setFocusedRow(index);
        setNavColumn(newCol);
        schedulePush();
        event.preventDefault();
        queueMicrotask(() => focusLine(index, newCol));
    };

    const handleVerticalMove = (event: KeyEvent, index: number, delta: -1 | 1) => {
        const targetIndex = index + delta;
        const targetLine = state.lines[targetIndex];
        if (targetLine === undefined) {
            return;
        }
        event.preventDefault();
        const targetCol = Math.min(navColumn(), getLineText(targetIndex).length);
        setFocusedRow(targetIndex);
        queueMicrotask(() => focusLine(targetIndex, targetCol));
    };

    const handleHorizontalJump = (event: KeyEvent, index: number, toPrevious: boolean) => {
        if (toPrevious) {
            const targetIndex = index - 1;
            if (targetIndex < 0) {
                return;
            }
            event.preventDefault();
            const targetText = getLineText(targetIndex);
            const targetCol = targetText.length;
            setNavColumn(targetCol);
            setFocusedRow(targetIndex);
            queueMicrotask(() => focusLine(targetIndex, targetCol));
            return;
        }
        const targetIndex = index + 1;
        const targetText = state.lines[targetIndex];
        if (targetText === undefined) {
            return;
        }
        event.preventDefault();
        setNavColumn(0);
        setFocusedRow(targetIndex);
        queueMicrotask(() => focusLine(targetIndex, 0));
    };

    const handleReturnKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        handleEnter(event, ctx.index);
    };

    const handleUpKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        setNavColumn(ctx.cursorCol);
        handleVerticalMove(event, ctx.index, -1);
    };

    const handleDownKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        setNavColumn(ctx.cursorCol);
        handleVerticalMove(event, ctx.index, 1);
    };

    const handleLeftKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        setNavColumn(ctx.cursorCol);
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        if (atStart) {
            handleHorizontalJump(event, ctx.index, true);
        }
    };

    const handleRightKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        setNavColumn(ctx.cursorCol);
        const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
        if (atEnd) {
            handleHorizontalJump(event, ctx.index, false);
        }
    };

    const handleBackwardDeleteKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        setNavColumn(ctx.cursorCol);
        if (atStart) {
            handleBackwardMerge(event, ctx.index);
        }
    };

    const handleForwardDeleteKey = (event: KeyEvent) => {
        const ctx = getCursorContext();
        if (!ctx) {
            return;
        }
        const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
        setNavColumn(ctx.cursorCol);
        if (atEnd) {
            handleForwardMerge(event, ctx.index);
        }
    };

    const bindings: KeyBinding[] = [
         {
             pattern: "escape",
             handler: () => {
                 flush();
                 props.onUnfocus?.();
             },
             preventDefault: true,
         },
         {
             pattern: "return",
             handler: (event: KeyEvent) => handleReturnKey(event),
         },
         {
             pattern: "up",
             handler: (event: KeyEvent) => handleUpKey(event),
         },
         {
             pattern: "down",
             handler: (event: KeyEvent) => handleDownKey(event),
         },
         {
             pattern: "left",
             handler: (event: KeyEvent) => handleLeftKey(event),
         },
         {
             pattern: "right",
             handler: (event: KeyEvent) => handleRightKey(event),
         },
         {
             pattern: "backspace",
             handler: (event: KeyEvent) => handleBackwardDeleteKey(event),
         },
         {
             pattern: "delete",
             handler: (event: KeyEvent) => handleForwardDeleteKey(event),
         },
         {
             pattern: "ctrl+h",
             handler: (event: KeyEvent) => handleBackwardDeleteKey(event),
         },
         {
             pattern: "ctrl+w",
             handler: (event: KeyEvent) => handleBackwardDeleteKey(event),
         },
         {
             pattern: "ctrl+d",
             handler: (event: KeyEvent) => handleForwardDeleteKey(event),
         },
     ];
 
     createEffect(() => {
         syncTextareasFromLines(state.lines);
     });
 
     createEffect(() => {
         const isFocused = props.isFocused();
         const target = textareaRefs[focusedRow()];
         if (!isFocused) {
             target?.blur();
             return;
         }
         if (target) {
             focusLine(focusedRow(), navColumn());
         }
     });


    return (
        <KeyScope
            id={BUFFER_SCOPE_ID}
            bindings={bindings}
            enabled={props.isFocused}
        >
            <scrollbox scrollbarOptions={{ visible: false }}>
                <box flexDirection="column">
                    <For each={state.lines}>
                        {(line, indexAccessor) => {
                            const index = indexAccessor();
                            return (
                                <textarea
                                    ref={(renderable: TextareaRenderable | undefined) => {
                                        textareaRefs[index] = renderable;
                                    }}
                                    placeholder={`Type to begin... (Enter inserts line, Ctrl+X then Enter executes)`}
                                    textColor={props.palette.editorText}
                                    focusedTextColor={props.palette.editorText}
                                    cursorColor={props.palette.primary}
                                    selectable={true}
                                    keyBindings={[]}
                                    onMouseDown={(event: MouseEvent) => {
                                        handleMouseDown(index, event);
                                    }}
                                    onContentChange={() => handleContentChange(index)}
                                    initialValue={line.text}
                                />
                            );
                        }}
                    </For>
                    <Show when={state.lines.length === 0}>
                        <text fg={props.palette.editorText}> </text>
                    </Show>
                </box>
            </scrollbox>
        </KeyScope>
    );
}
