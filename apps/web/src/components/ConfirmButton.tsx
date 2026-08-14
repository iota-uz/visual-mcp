import { Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

interface ConfirmButtonProps {
  /** Label of the resting (unarmed) button. */
  label?: string;
  /** Label once armed — phrase it as the irreversible thing it does. */
  confirmLabel?: string;
  /** What will be lost, shown only once armed (e.g. "3 canvases"). */
  description?: ReactNode;
  busyLabel?: string;
  onConfirm: () => Promise<unknown>;
}

/*
 * Two-step, in-place destructive action: the button arms itself instead of
 * opening a browser modal (window.confirm blocks the whole tab, can't show
 * what is about to be lost, and is unstyleable). Armed state also exposes
 * an explicit Cancel so the escape route is a target, not a guess.
 */
export function ConfirmButton({
  label = "Delete",
  confirmLabel = "Really delete?",
  description,
  busyLabel = "Deleting…",
  onConfirm,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!armed) {
    return (
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setArmed(true)}>
        <Trash2 size={14} /> {label}
      </button>
    );
  }

  return (
    <span className="confirm-inline">
      {description && <span className="confirm-inline-text">{description}</span>}
      <button
        type="button"
        className="btn btn-danger btn-sm"
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
      {error && <span className="error-text confirm-inline-text">{error}</span>}
    </span>
  );
}
