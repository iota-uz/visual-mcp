import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce. Used to keep a Convex subscription from being
 * torn down and re-established on every keystroke of a search box.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
