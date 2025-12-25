import fuzzysort, { type KeysOptions } from "fuzzysort";

export type FuzzySearchKey<T> = (keyof T & string) | ((item: T) => string | null | undefined);

export type FuzzySearchOptions<T> = {
  keys?: FuzzySearchKey<T>[];
  limit?: number;
  threshold?: number;
  scoreFn?: KeysOptions<T>["scoreFn"];
};

export function fuzzyFilter<T>(query: string, items: readonly T[], options: FuzzySearchOptions<T> = {}): T[] {
  const limit = options.limit ?? items.length;
  const trimmed = query.trim();
  if (!trimmed) {
    return items.slice(0, limit);
  }
  const normalizedKeys = (options.keys ?? []).map((key) => {
    if (typeof key === "function") {
      return (item: T) => key(item) ?? "";
    }
    return key;
  });
  if (normalizedKeys.length === 0) {
    const result = fuzzysort.go(trimmed, items as ReadonlyArray<string>, {
      limit,
      threshold: options.threshold,
    });
    return result.map((entry) => entry.target as T);
  }
  const result = fuzzysort.go(trimmed, items as ReadonlyArray<T>, {
    limit,
    threshold: options.threshold,
    keys: normalizedKeys,
    scoreFn: options.scoreFn,
  });
  return result.map((entry) => entry.obj);
}
