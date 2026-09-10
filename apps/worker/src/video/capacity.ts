let busy = false;
/** One memory-heavy video/media operation per 4GiB worker process. */
export function acquireMediaCapacity(): null | (() => void) {
  if (busy) return null;
  busy = true;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      busy = false;
    }
  };
}
