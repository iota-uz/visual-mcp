import { type RefObject, useEffect, useState } from "react";

export type PresenceStatus = "entering" | "entered" | "exiting";

/**
 * Keeps a node mounted through its exit animation.
 *
 * The alternative — leaving the node permanently mounted and animating with
 * `@starting-style` — is cheaper in CSS and wrong here: the canvas details
 * drawer holds a live `listVersionsMine` subscription, which would then
 * never unsubscribe for as long as the page is open.
 *
 * @param open   whether the caller wants the node present
 * @param ref    the animating element, watched for `transitionend`
 * @param maxMs  fallback, in case no transition runs at all — an element
 *               with no transition (or `prefers-reduced-motion`, where the
 *               duration collapses to 0.01ms) may never fire the event
 */
export function usePresence(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  maxMs = 400,
): { mounted: boolean; status: PresenceStatus } {
  const [mounted, setMounted] = useState(open);
  const [status, setStatus] = useState<PresenceStatus>(open ? "entered" : "exiting");

  useEffect(() => {
    if (open) {
      setMounted(true);
      setStatus("entering");
      // Two frames: one for React to commit the node with its entering
      // styles, one for the browser to record them as the transition's
      // start value. A single frame lands mid-commit and the element pops
      // in fully-styled with nothing to animate from.
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setStatus("entered"));
      });
      return () => cancelAnimationFrame(raf);
    }

    if (!mounted) return;
    setStatus("exiting");

    const node = ref.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setMounted(false);
    };
    // `target === node`: a transition on anything *inside* the drawer —
    // a hover on a button the pointer is still over — bubbles to here too,
    // and would unmount the drawer mid-exit.
    const onEnd = (event: TransitionEvent) => {
      if (event.target === node) finish();
    };
    node?.addEventListener("transitionend", onEnd);
    const timer = window.setTimeout(finish, maxMs);
    return () => {
      node?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
    };
  }, [open, mounted, ref, maxMs]);

  return { mounted, status };
}
