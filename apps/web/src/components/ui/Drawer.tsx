import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef } from "react";
import { usePresence } from "../../lib/usePresence";
import { IconButton } from "./IconButton";

/*
 * A panel that slides in over the page, built on the native <dialog>.
 *
 * showModal() supplies — correctly, and for free — the four things both
 * hand-rolled drawers in this app were missing: focus moves into the panel,
 * Tab cycles inside it, Escape closes it, and focus returns to whatever
 * opened it. It renders in the top layer, so a drawer no longer has to win
 * a z-index argument with the page. And the full-viewport <button> that
 * used to serve as a click-away scrim is gone: ::backdrop is not focusable,
 * so it can't sit in the tab order pretending to be a control.
 */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Heading shown in the drawer's own header row, and its accessible name. */
  title?: ReactNode;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** Which edge it slides from. */
  side?: "left" | "right";
  id?: string;
  /** Say what closes. "Close" alone is ambiguous with two of these around. */
  closeLabel: string;
  className?: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, ...rest }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The transition runs on the panel, not on the dialog — the dialog is a
  // full-viewport box that exists only to catch backdrop presses.
  const { mounted, status } = usePresence(open, panelRef);

  // Mounted and unmounted as a whole, rather than kept in the tree with an
  // effect toggling showModal(): React runs a deleted subtree's layout
  // cleanups before it detaches the host nodes, and close()-before-detach is
  // what makes focus restore work. See the note in Dialog below.
  if (!mounted) return null;
  return <Dialog {...rest} status={status} panelRef={panelRef} onClose={onClose} />;
}

function Dialog({
  onClose,
  title,
  label,
  side = "right",
  id,
  closeLabel,
  className,
  children,
  status,
  panelRef,
}: Omit<DrawerProps, "open"> & {
  status: string;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  /*
   * Layout, not passive, and the distinction is the whole reason focus
   * restore works: it is close() that returns focus to whatever opened the
   * drawer, and it can only do so while the dialog is still in the
   * document. React detaches host nodes during the mutation phase and runs
   * passive cleanups after the paint, by which point close() has nothing to
   * restore and focus drops to <body>.
   */
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  /*
   * The backdrop press, attached natively rather than as an onClick prop.
   * A press whose target is the <dialog> element itself landed on
   * ::backdrop — everything the drawer renders is inside the panel — and
   * as a JSX handler this reads to a linter as a click handler on a
   * non-interactive element with no keyboard equivalent. Which is true:
   * ::backdrop isn't a control, and Escape is the keyboard way out.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onBackdropPress = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", onBackdropPress);
    return () => dialog.removeEventListener("click", onBackdropPress);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-label={title ? undefined : label}
      aria-labelledby={title ? titleId : undefined}
      className={["drawer", `drawer-${side}`, `is-${status}`, className].filter(Boolean).join(" ")}
      // Escape fires `cancel` before `close`. Routed through onClose so the
      // parent's state follows, instead of it still believing the drawer is
      // open and refusing to reopen it.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="drawer-panel" ref={panelRef}>
        <header className="drawer-header">
          {title && (
            <h2 className="drawer-title" id={titleId}>
              {title}
            </h2>
          )}
          <IconButton
            icon={X}
            label={closeLabel}
            iconSize={18}
            className="drawer-close"
            onClick={onClose}
          />
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </dialog>
  );
}
