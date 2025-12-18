import type { TextareaRenderable } from "@opentui/core";
import { debounce } from "@shared/lib/debounce";
import { type Accessor, createSignal } from "solid-js";
import { createStore } from "solid-js/store";

const DEBOUNCE_DEFAULT_MS = 20;

export type CursorContext = {
    index: number;
    cursorCol: number;
    cursorRow: number;
    text: string;
};

export type Line = {
    id: string;
    text: string;
    rendered: boolean;
};

export type BufferState = {
    lines: Line[];
    contentModified: boolean;
};

export type BufferModelOptions = {
    initialText: string;
    isFocused: Accessor<boolean>;
    onTextChange: (text: string, info: { modified: boolean }) => void;
    debounceMs?: number;
};

let lineIdCounter = 0;
const nextLineId = () => `line-${lineIdCounter++}`;

function makeLine(text: string, rendered: boolean): Line {
    return { id: nextLineId(), text, rendered };
}

function makeLinesFromText(text: string, rendered: boolean): Line[] {
    const parts = text.split("\n");
    const safeParts = parts.length > 0 ? parts : [""];
    return safeParts.map((part) => makeLine(part, rendered));
}

export function createBufferModel(options: BufferModelOptions) {
    const [state, setState] = createStore<BufferState>({
        lines: makeLinesFromText(options.initialText, true),
        contentModified: false,
    });
    const [focusedRow, setFocusedRow] = createSignal(0);
    const [navColumn, setNavColumn] = createSignal(0);

    const lineRefs = new Map<string, TextareaRenderable | undefined>();

    const setLineRef = (lineId: string, ref: TextareaRenderable | undefined) => {
        if (!ref) {
            lineRefs.delete(lineId);
            return;
        }
        lineRefs.set(lineId, ref);
    };

    const getTextArea = (index: number) => {
        const line = state.lines[index];
        if (!line) {
            return undefined;
        }
        return lineRefs.get(line.id);
    };

    const syncRefsWithLines = (lines: Line[]) => {
        const ids = new Set(lines.map((line) => line.id));
        for (const id of lineRefs.keys()) {
            if (!ids.has(id)) {
                lineRefs.delete(id);
            }
        }
    };

    const getLineText = (index: number): string => {
        const line = state.lines[index];
        if (!line) {
            return "";
        }
        return line.text;
    };

    const emitPush = () => {
        const lines = state.lines.map((_, i) => getLineText(i));
        const text = lines.join("\n");
        options.onTextChange(text, { modified: state.contentModified });
    };

    const debouncedPush = debounce(() => {
        emitPush();
    }, options.debounceMs ?? DEBOUNCE_DEFAULT_MS);

    const schedulePush = () => {
        debouncedPush();
    };

    const flush = () => {
        debouncedPush.clear();
        emitPush();
    };

    const focusLine = (index: number, column: number) => {
        const node = getTextArea(index);
        if (!node) {
            return;
        }
        if (!options.isFocused()) {
            return;
        }
        node.focus();
        const targetCol = Math.min(column, node.plainText.length);
        node.editBuffer.setCursorToLineCol(0, targetCol);
        setFocusedRow(index);
    };

    const clampFocus = (lines: Line[] = state.lines) => {
        const targetRow = Math.min(focusedRow(), Math.max(0, lines.length - 1));
        const targetCol = Math.min(navColumn(), lines[targetRow]?.text.length ?? 0);
        setFocusedRow(targetRow);
        setNavColumn(targetCol);
        queueMicrotask(() => focusLine(targetRow, targetCol));
    };

    const setText = (text: string) => {
        const nextLines = makeLinesFromText(text, false);
        setState({ lines: nextLines, contentModified: false });
        syncRefsWithLines(nextLines);
        clampFocus(nextLines);
        schedulePush();
    };

    const focusCurrent = () => {
        focusLine(focusedRow(), navColumn());
    };

    const handleFocusChange = (isFocused: boolean) => {
        const target = getTextArea(focusedRow());
        if (!target) {
            return;
        }
        if (!isFocused) {
            target.blur();
            return;
        }
        focusLine(focusedRow(), navColumn());
    };

    const getCursorContext = (): CursorContext | undefined => {
        const index = focusedRow();
        const node = getTextArea(index);
        if (!node) {
            return undefined;
        }
        const cursor = node.logicalCursor;
        const text = getLineText(index);
        return { index, cursorCol: cursor.col, cursorRow: cursor.row, text };
    };

    const handleTextAreaChange = (index: number) => {
        const node = getTextArea(index);
        const line = state.lines[index];
        if (!node || !line) {
            return;
        }

        const text = node.plainText;

        if (!line.rendered) {
            setState("lines", index, { ...line, text, rendered: true });
            return;
        }

        if (text === line.text) {
            return;
        }

        if (text.includes("\n")) {
            const pieces = text.split("\n");
            const head = pieces[0] ?? "";
            const tail = pieces.slice(1);
            const tailLines = tail.map((segment) => makeLine(segment, false));
            setState("lines", (prev) => {
                const next = [...prev];
                const current = next[index];
                if (!current) {
                    return prev;
                }
                const headLine: Line = { ...current, text: head, rendered: false };
                next.splice(index, 1, headLine, ...tailLines);
                return next;
            });
            syncRefsWithLines(state.lines);
            setState("contentModified", true);
            const targetIndex = index + tail.length;
            const targetCol = tail[tail.length - 1]?.length ?? head.length;
            setFocusedRow(targetIndex);
            setNavColumn(targetCol);
            schedulePush();
            queueMicrotask(() => focusLine(targetIndex, targetCol));
            return;
        }

        setState("lines", index, { ...line, text, rendered: true });
        setState("contentModified", true);
        schedulePush();
    };

    const handleEnter = (index: number) => {
        const node = getTextArea(index);
        if (!node) {
            return;
        }
        const cursor = node.logicalCursor;
        const value = getLineText(index);
        const before = value.slice(0, cursor.col);
        const after = value.slice(cursor.col);
        const nextIndex = index + 1;
        const tailLine = makeLine(after, false);
        setState("lines", (prev) => {
            const next = [...prev];
            const current = next[index];
            if (!current) {
                return prev;
            }
            const headLine: Line = { ...current, text: before, rendered: false };
            next.splice(index, 1, headLine, tailLine);
            return next;
        });
        syncRefsWithLines(state.lines);
        setState("contentModified", true);
        setFocusedRow(nextIndex);
        setNavColumn(0);
        schedulePush();
        queueMicrotask(() => focusLine(nextIndex, 0));
    };

    const handleBackwardMerge = (index: number) => {
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
            const mergedLine: Line = { ...prevLine, text: prevText + currentText, rendered: false };
            next.splice(prevIndex, 2, mergedLine);
            return next;
        });
        syncRefsWithLines(state.lines);
        setState("contentModified", true);
        const newCol = prevText.length;
        setFocusedRow(prevIndex);
        setNavColumn(newCol);
        schedulePush();
        queueMicrotask(() => focusLine(prevIndex, newCol));
    };

    const handleForwardMerge = (index: number) => {
        const nextIndex = index + 1;
        const nextLine = state.lines[nextIndex];
        if (nextLine === undefined) {
            return;
        }
        const currentText = getLineText(index);
        const followingText = getLineText(nextIndex);
        setState("lines", (prev) => {
            const next = [...prev];
            const currentLine = next[index];
            if (!currentLine) {
                return prev;
            }
            const mergedLine: Line = { ...currentLine, text: currentText + followingText, rendered: false };
            next.splice(index, 2, mergedLine);
            return next;
        });
        syncRefsWithLines(state.lines);
        setState("contentModified", true);
        const newCol = currentText.length;
        setFocusedRow(index);
        setNavColumn(newCol);
        schedulePush();
        queueMicrotask(() => focusLine(index, newCol));
    };

    const handleVerticalMove = (index: number, delta: -1 | 1) => {
        const targetIndex = index + delta;
        const targetLine = state.lines[targetIndex];
        if (targetLine === undefined) {
            return;
        }
        const targetCol = Math.min(navColumn(), getLineText(targetIndex).length);
        setFocusedRow(targetIndex);
        setNavColumn(targetCol);
        queueMicrotask(() => focusLine(targetIndex, targetCol));
    };

    const handleHorizontalJump = (index: number, toPrevious: boolean) => {
        if (toPrevious) {
            const targetIndex = index - 1;
            if (targetIndex < 0) {
                return;
            }
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
        setNavColumn(0);
        setFocusedRow(targetIndex);
        queueMicrotask(() => focusLine(targetIndex, 0));
    };

    const dispose = () => {
        debouncedPush.clear();
    };

    return {
        lines: () => state.lines,
        focusedRow,
        navColumn,
        setLineRef,
        setFocusedRow,
        setNavColumn,
        setText,
        focusCurrent,
        handleFocusChange,
        handleTextAreaChange,
        getCursorContext,
        handleEnter,
        handleBackwardMerge,
        handleForwardMerge,
        handleVerticalMove,
        handleHorizontalJump,
        clampFocus,
        flush,
        dispose,
    };
}

export type BufferModel = ReturnType<typeof createBufferModel>;
