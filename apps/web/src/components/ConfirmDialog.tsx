import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => Promise<unknown> | unknown;
  onCancel: () => void;
}

/**
 * A modal confirmation for one destructive, immediate action.
 *
 * `ConfirmButton` covers the inline case, where the control that triggers
 * the action is on screen. A keyboard-initiated deletion has no such
 * control — the user pressed Delete — so the confirmation has to arrive on
 * its own and take focus with it.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel,
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    confirmRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onBackdropPress = (event: MouseEvent) => {
      if (event.target === dialog && !busy) onCancel();
    };
    dialog.addEventListener("click", onBackdropPress);
    return () => dialog.removeEventListener("click", onBackdropPress);
  }, [busy, onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="confirm-dialog-shell">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={confirm}
            busy={busy}
          >
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
