import type { Accessor } from "solid-js";
import type { FuzzySearchKey } from "@shared/lib/fuzzy";

export interface DialogSelectOption<T> {
    id: string;
    title: string;
    value: T;
    description?: string;
    category?: string;
    badge?: string;
    aliases?: string[];
    disabled?: boolean;
}

export type MaybeAccessor<T> = T | Accessor<T>;

export interface UseDialogSelectParams<T> {
    options: MaybeAccessor<readonly DialogSelectOption<T>[]>;
    limit?: number;
    pageSize?: number;
    initialFilter?: string;
    selectedId?: Accessor<string | null | undefined>;
    keys?: FuzzySearchKey<DialogSelectOption<T>>[];
}

export interface DialogSelectActions<T> {
    setFilter: (value: string) => void;
    move: (delta: number) => void;
    movePage: (delta: number) => void;
    setCursor: (index: number) => void;
    select: (index?: number) => DialogSelectOption<T> | undefined;
    reset: () => void;
}

export interface DialogSelectViewModel<T> {
    options: Accessor<readonly DialogSelectOption<T>[]>;
    filtered: Accessor<readonly DialogSelectOption<T>[]>;
    filter: Accessor<string>;
    cursor: Accessor<number>;
    selected: Accessor<DialogSelectOption<T> | undefined>;
    actions: DialogSelectActions<T>;
    isActive: (option: DialogSelectOption<T>) => boolean;
    limit: number;
    pageSize: number;
    keys: readonly FuzzySearchKey<DialogSelectOption<T>>[];
}

export interface DialogSelectHint {
    label: string;
    description: string;
}
