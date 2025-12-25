import { type FuzzySearchKey, fuzzyFilter } from "@shared/lib/fuzzy";
import type {
  DialogSelectActions,
  DialogSelectOption,
  DialogSelectViewModel,
  UseDialogSelectParams,
} from "@widgets/dialog-select/types";
import { createEffect, createMemo, createSignal } from "solid-js";

const DEFAULT_KEYS: readonly FuzzySearchKey<DialogSelectOption<unknown>>[] = [
  (option) => option.title,
  (option) => option.description ?? "",
  (option) => option.category ?? "",
  (option) => option.aliases?.join(" ") ?? "",
];

export function useDialogSelect<T>(params: UseDialogSelectParams<T>): DialogSelectViewModel<T> {
  const limit = params.limit ?? 50;
  const pageSize = params.pageSize ?? 10;
  const keys = (params.keys ?? DEFAULT_KEYS) as FuzzySearchKey<DialogSelectOption<T>>[];

  const [filter, setFilterValue] = createSignal(params.initialFilter ?? "");
  const [cursor, setCursorIndex] = createSignal(0);

  const options = createMemo(() => params.options());

  const filtered = createMemo(() => {
    const list = options().filter((option) => option.disabled !== true);
    return fuzzyFilter(filter(), list, { limit, keys });
  });

  const selected = createMemo(() => filtered()[cursor()] ?? undefined);

  const selectedId = params.selectedId;

  createEffect(() => {
    const size = filtered().length;
    if (size === 0) {
      setCursorIndex(0);
      return;
    }
    setCursorIndex((prev) => Math.min(prev, size - 1));
  });

  createEffect(() => {
    filter();
    setCursorIndex(0);
  });

  createEffect(() => {
    options();
    setCursorIndex(0);
  });

  createEffect(() => {
    if (!selectedId) return;
    const target = selectedId();
    if (!target) return;
    const index = filtered().findIndex((option) => option.id === target);
    if (index === -1) return;
    setCursorIndex(index);
  });

  const actions = {
    setFilter(value: string) {
      setFilterValue(value);
    },
    move(delta: number) {
      const size = filtered().length;
      if (size === 0) return;
      setCursorIndex((prev) => {
        let next = prev + delta;
        while (next < 0) next += size;
        while (next >= size) next -= size;
        return next;
      });
    },
    movePage(delta: number) {
      actions.move(delta * pageSize);
    },
    setCursor(index: number) {
      const size = filtered().length;
      if (size === 0) return;
      const clamped = Math.max(0, Math.min(index, size - 1));
      setCursorIndex(clamped);
    },
    select(index?: number) {
      const targetIndex = index ?? cursor();
      return filtered()[targetIndex];
    },
    reset() {
      setFilterValue("");
      setCursorIndex(0);
    },
  } satisfies DialogSelectActions<T>;

  function isActive(option: DialogSelectOption<T>) {
    if (!selectedId) return false;
    const current = selectedId();
    if (!current) return false;
    return option.id === current;
  }

  return {
    options,
    filtered,
    filter,
    cursor,
    selected,
    actions,
    isActive,
    limit,
    pageSize,
    keys,
  };
}
