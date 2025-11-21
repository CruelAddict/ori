import { TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { For, Show, createEffect, createMemo, onMount } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import { useTheme } from "@app/providers/theme";
import type {
    DialogSelectHint,
    DialogSelectOption,
    DialogSelectViewModel,
    MaybeAccessor,
} from "@widgets/dialog-select/types";

export interface DialogSelectProps<T> {
    title: string;
    viewModel: DialogSelectViewModel<T>;
    description?: string;
    placeholder?: string;
    emptyMessage?: string;
    width?: number;
    maxHeight?: number;
    scopeId?: string;
    hints?: readonly DialogSelectHint[];
    extraKeyBindings?: MaybeAccessor<KeyBinding[]>;
    onSelect?: (option: DialogSelectOption<T>) => void;
    onCancel?: () => void;
    onFilterChange?: (value: string) => void;
}

export function DialogSelect<T>(props: DialogSelectProps<T>) {
    const { theme } = useTheme();
    const palette = theme;
    const vm = props.viewModel;
    const placeholder = props.placeholder ?? "Type to search";
    const emptyMessage = props.emptyMessage ?? "No results found";
    const hints = () => props.hints ?? [];
    const maxHeight = () => props.maxHeight ?? 16;

    let inputRef: InputRenderable | undefined;
    let scrollRef: ScrollBoxRenderable | undefined;

    const grouped = createMemo(() => groupByCategory(vm.filtered()));

    const bindings = createMemo<KeyBinding[]>(() => {
        const base: KeyBinding[] = [
            {
                pattern: "escape",
                preventDefault: true,
                handler: () => props.onCancel?.(),
            },
            {
                pattern: "up",
                preventDefault: true,
                handler: () => vm.actions.move(-1),
            },
            {
                pattern: "ctrl+p",
                preventDefault: true,
                handler: () => vm.actions.move(-1),
            },
            {
                pattern: "down",
                preventDefault: true,
                handler: () => vm.actions.move(1),
            },
            {
                pattern: "ctrl+n",
                preventDefault: true,
                handler: () => vm.actions.move(1),
            },
            {
                pattern: "pageup",
                preventDefault: true,
                handler: () => vm.actions.movePage(-1),
            },
            {
                pattern: "pagedown",
                preventDefault: true,
                handler: () => vm.actions.movePage(1),
            },
            {
                pattern: "return",
                preventDefault: true,
                handler: () => {
                    const option = vm.actions.select();
                    if (option) props.onSelect?.(option);
                },
            },
        ];
        const extras = resolveMaybe(props.extraKeyBindings) ?? [];
        return [...base, ...extras];
    });

    onMount(() => {
        queueMicrotask(() => inputRef?.focus());
    });

    createEffect(() => {
        vm.filter();
        if (!scrollRef) return;
        (scrollRef as any)?.scrollTo?.(0);
    });

    createEffect(() => {
        vm.cursor();
        ensureVisible(scrollRef, vm);
    });

    return (
        <KeyScope id={props.scopeId} bindings={bindings}>
            <box
                flexDirection="column"
                width={props.width ?? 100}
                maxWidth={props.width ?? 100}
                paddingLeft={3}
                paddingRight={3}
                paddingTop={1}
                paddingBottom={1}
                backgroundColor={palette().backgroundPanel}
            >
                <box flexDirection="row" justifyContent="space-between">
                    <text fg={palette().text} attributes={TextAttributes.BOLD} wrapMode="none">
                        {props.title}
                    </text>
                    <text fg={palette().textMuted} paddingTop={1}>esc</text>
                </box>
                <Show when={props.description}>
                    <text fg={palette().textMuted}>{props.description}</text>
                </Show>
                <box paddingBottom={2}>
                    <input
                        ref={(el) => (inputRef = el)}
                        value={vm.filter()}
                        placeholder={placeholder}
                        cursorColor={palette().primary}
                        backgroundColor={palette().backgroundPanel}
                        focusedBackgroundColor={palette().backgroundPanel}
                        onInput={(value) => {
                            vm.actions.setFilter(value);
                            props.onFilterChange?.(value);
                        }}
                    />
                </box>
                <scrollbox
                    ref={(node: ScrollBoxRenderable) => (scrollRef = node)}
                    maxHeight={maxHeight()}
                    scrollbarOptions={{ visible: false }}
                    paddingRight={1}
                >
                    <box flexDirection="column">
                        <Show when={grouped().length > 0} fallback={<EmptyState message={emptyMessage} />}>
                            <For each={grouped()}>
                                {([category, options], groupIndex) => (
                                    <box flexDirection="column">
                                        <Show when={category}>
                                            <box paddingBottom={0} paddingLeft={1} paddingTop={groupIndex() > 0 ? 1 : 0}>
                                                <text fg={palette().accent} attributes={TextAttributes.BOLD}>
                                                    {category}
                                                </text>
                                            </box>
                                        </Show>
                                        <For each={options}>
                                            {(option) => (
                                                <OptionRow
                                                    option={option}
                                                    palette={palette}
                                                    vm={vm}
                                                    onSelect={props.onSelect}
                                                />
                                            )}
                                        </For>
                                    </box>
                                )}
                            </For>
                        </Show>
                    </box>
                </scrollbox>
            </box>
        </KeyScope>
    );
}

type ThemeAccessor = ReturnType<typeof useTheme>["theme"];

function OptionRow<T>(props: {
    option: DialogSelectOption<T>;
    vm: DialogSelectViewModel<T>;
    palette: ThemeAccessor;
    onSelect?: (option: DialogSelectOption<T>) => void;
}) {
    const option = props.option;
    const optionIndex = createMemo(() => props.vm.filtered().indexOf(option));
    const isCursor = createMemo(() => optionIndex() === props.vm.cursor());
    const isActiveOption = createMemo(() => props.vm.isActive(option));

    const handleSelect = () => {
        props.onSelect?.(option);
    };

    const fgColor = () =>
        isCursor() ? props.palette().background : isActiveOption() ? props.palette().primary : props.palette().text;

    return (
        <box
            id={`dialog-option-${optionIndex()}`}
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={isCursor() ? props.palette().primary : undefined}
            onMouseOver={() => {
                const idx = optionIndex();
                if (idx >= 0) props.vm.actions.setCursor(idx);
            }}
            onMouseUp={() => {
                props.vm.actions.setCursor(optionIndex());
                handleSelect();
            }}
            gap={1}
        >
            <text flexGrow={1} fg={fgColor()} attributes={isCursor() ? TextAttributes.BOLD : undefined} wrapMode="none">
                {truncate(option.title, 50)}
                <Show when={option.description}>
                    <span style={{ fg: isCursor() ? props.palette().background : props.palette().textMuted }}>
                        {" "}
                        {truncate(option.description!, 60)}
                    </span>
                </Show>
            </text>
            <Show when={option.badge}>
                <text fg={isCursor() ? props.palette().background : props.palette().textMuted} attributes={TextAttributes.BOLD}>
                    {option.badge}
                </text>
            </Show>
            <Show when={option.footer}>
                <text fg={isCursor() ? props.palette().background : props.palette().textMuted} flexShrink={0}>
                    {option.footer}
                </text>
            </Show>
        </box>
    );
}

function EmptyState(props: { message: string }) {
    const { theme } = useTheme();
    return (
        <box padding={1}>
            <text fg={theme().textMuted}>{props.message}</text>
        </box>
    );
}

function groupByCategory<T>(options: readonly DialogSelectOption<T>[]) {
    const map = new Map<string, DialogSelectOption<T>[]>();
    for (const option of options) {
        const key = option.category ?? "";
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key)!.push(option);
    }
    return Array.from(map.entries());
}

function resolveMaybe<T>(value?: MaybeAccessor<T>): T | undefined {
    if (typeof value === "function") {
        return (value as () => T)();
    }
    return value;
}

function ensureVisible<T>(scroll: ScrollBoxRenderable | undefined, vm: DialogSelectViewModel<T>) {
    if (!scroll) return;
    const current = vm.selected();
    if (!current) return;
    const index = vm.filtered().indexOf(current);
    if (index === -1) return;
    const id = `dialog-option-${index}`;
    
    const target = findChildById(scroll, id);
    if (!target) return;

    const offset = target.y - scroll.y;
    if (offset < 0) {
        scroll.scrollBy(offset);
    } else if (offset >= scroll.height) {
        scroll.scrollBy(offset - scroll.height + 1);
    }
}

function findChildById(node: any, id: string): any {
    if (node.id === id) return node;
    const children = ((node as any)?.getChildren?.() ?? []) as any[];
    for (const child of children) {
        const found = findChildById(child, id);
        if (found) return found;
    }
    return undefined;
}

function truncate(value: string, limit = 64) {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1)}…`;
}
