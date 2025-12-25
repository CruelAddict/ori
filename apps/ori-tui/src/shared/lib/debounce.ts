export type Debounced<Args extends unknown[]> = ((...args: Args) => void) & {
  clear: () => void;
};

/**
 * Simple trailing debounce that always runs in Node/renderer contexts.
 */
export function debounce<Args extends unknown[]>(callback: (...args: Args) => void, wait = 0): Debounced<Args> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const debounced = (...args: Args) => {
    clear();
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      callback(...args);
    }, wait);
  };

  return Object.assign(debounced, { clear });
}
