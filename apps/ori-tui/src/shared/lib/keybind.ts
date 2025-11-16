import type { KeyEvent } from "@opentui/core";

export interface ParsedKeybind {
    name?: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
}

export type KeyboardEventLike = Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift"> & {
    alt?: boolean;
    option?: boolean;
    preventDefault?: () => void;
};

const normalize = (value?: string) => value?.toLowerCase().trim();

const KEY_ALIASES: Record<string, string> = {
    enter: "return",
};

const parsePattern = (pattern: string) => {
    const tokens = pattern
        .split("+")
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);

    const requirements = {
        ctrl: false,
        meta: false,
        shift: false,
        alt: false,
    };

    let keyName: string | undefined;

    for (const token of tokens) {
        switch (token) {
            case "ctrl":
            case "control":
                requirements.ctrl = true;
                break;
            case "meta":
            case "cmd":
            case "command":
                requirements.meta = true;
                break;
            case "shift":
                requirements.shift = true;
                break;
            case "alt":
            case "option":
                requirements.alt = true;
                break;
            default:
                keyName = KEY_ALIASES[token] ?? token;
                break;
        }
    }

    return { requirements, keyName };
};

const hasUnexpectedModifiers = (requirements: ParsedKeybind, event: ParsedKeybind) => {
    if (!requirements.ctrl && event.ctrl) return true;
    if (!requirements.meta && event.meta) return true;
    if (!requirements.shift && event.shift) return true;
    if (!requirements.alt && event.alt) return true;
    return false;
};

export const Keybind = {
    match(pattern: string, event: ParsedKeybind) {
        if (!pattern) return false;
        const { requirements, keyName } = parsePattern(pattern);

        if (requirements.ctrl && !event.ctrl) return false;
        if (requirements.meta && !event.meta) return false;
        if (requirements.shift && !event.shift) return false;
        if (requirements.alt && !event.alt) return false;
        if (hasUnexpectedModifiers(requirements, event)) return false;

        if (keyName && normalize(event.name) !== keyName) {
            return false;
        }

        return true;
    },
};

export function useKeybind() {
    const parse = (evt: KeyboardEventLike): ParsedKeybind => ({
        name: normalize(evt.name),
        ctrl: Boolean(evt.ctrl),
        meta: Boolean(evt.meta),
        shift: Boolean(evt.shift),
        alt: Boolean(evt.alt ?? evt.option),
    });

    return { parse };
}
