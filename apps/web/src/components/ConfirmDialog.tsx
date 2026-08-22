import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { Button } from "./ui/Button";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
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
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

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
      if (event.target === dialog) onCancel();
    };
    dialog.addEventListener("click", onBackdropPress);
    return () => dialog.removeEventListener("click", onBackdropPress);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <div className="confirm-dialog-shell">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <div className="confirm-dialog-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
