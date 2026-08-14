import { type LucideIcon, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

interface ConfirmButtonProps {
  /** Label of the resting (unarmed) button. */
  label?: string;
  /** Label once armed — phrase it as the irreversible thing it does. */
  confirmLabel?: string;
  /** What will be lost, shown only once armed (e.g. "3 canvases"). */
  description?: ReactNode;
  busyLabel?: string;
  /** `danger` destroys data; `warning` breaks something outside the app. */
  tone?: "danger" | "warning";
  icon?: LucideIcon;
  onConfirm: () => Promise<unknown>;
}

/** Long enough to read the description and decide, short enough not to rot. */
const AUTO_DISARM_MS = 8000;

/*
 * Two-step, in-place destructive action: the button arms itself instead of
 * opening a browser modal (window.confirm blocks the whole tab, can't show
 * what is about to be lost, and is unstyleable). Armed state also exposes
 * an explicit Cancel so the escape route is a target, not a guess — plus
 * Escape and click-outside, because an armed Delete sitting live in a list
 * row is exactly the thing a stray click finds.
 */
export function ConfirmButton({
  label = "Delete",
  confirmLabel = "Really delete?",
  description,
  busyLabel = "Deleting…",
  tone = "danger",
  icon: Icon = Trash2,
  onConfirm,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restRef = useRef<HTMLButtonElement>(null);
  const wasArmed = useRef(false);

  // Arming swaps in a different element tree, so without this the focus
  // ring is left on a button that no longer exists and a keyboard user has
  // to hunt for the confirmation they just triggered. Disarming moves it
  // back, so Escape or Cancel returns you where you were rather than
  // dropping focus on <body>.
  useEffect(() => {
    if (armed) {
      confirmRef.current?.focus();
      wasArmed.current = true;
    } else if (wasArmed.current) {
      wasArmed.current = false;
      // Only when focus was inside the armed tree that just unmounted — by
      // now that leaves it on <body>. The auto-disarm below and the
      // document-level Escape listener both fire while the user may be
      // typing somewhere else entirely; neither may yank focus back here.
      if (document.activeElement === document.body) restRef.current?.focus();
    }
  }, [armed]);

  useEffect(() => {
    // `error` is a bail condition, not just a dep: the failure message
    // renders inside the armed tree, so auto-disarming would delete the
    // explanation of why the delete failed 8 seconds after showing it.
    if (!armed || busy || error) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setArmed(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setArmed(false);
    }
    // An armed Delete left live in a list row is a trap you walk back into
    // minutes later having forgotten it was armed. Disarm itself.
    const timer = window.setTimeout(() => setArmed(false), AUTO_DISARM_MS);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [armed, busy, error]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setArmed(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const btnClass = tone === "warning" ? "btn btn-warning btn-sm" : "btn btn-danger btn-sm";

  if (!armed) {
    return (
      <button type="button" ref={restRef} className={btnClass} onClick={() => setArmed(true)}>
        <Icon size={14} aria-hidden="true" /> {label}
      </button>
    );
  }

  return (
    <span className="confirm-inline" ref={wrapRef}>
      {description && (
        <span className="confirm-inline-text" role="alert">
          {description}
        </span>
      )}
      <button
        type="button"
        ref={confirmRef}
        className={btnClass}
        onClick={handleConfirm}
        disabled={busy}
      >
        {busy ? busyLabel : confirmLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setArmed(false)}
        disabled={busy}
      >
        Cancel
      </button>
      {error && (
        <span className="error-text confirm-inline-text" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
