import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { IconButton, type IconButtonProps } from "./IconButton";

/*
 * The app's popup menu.
 *
 * Two of these existed, written twice and word for word: the canvas header's
 * Export menu and the Pages rail's per-page ⋯. Both got the keyboard
 * contract right — which is the hard part and the reason a menu is worth a
 * primitive at all — so this is their shared implementation, not a new one.
 *
 * The contract a `role="menu"` promises, and this keeps: focus moves into
 * the menu when it opens, the arrows wrap, Home/End jump, Escape closes and
 * hands focus back to the trigger, Tab closes without stealing it, and a
 * pointerdown anywhere else dismisses without swallowing that click.
 *
 * Not related to `packages/canvas`'s right-click menu, which belongs to the
 * viewer and stays there (adr/product/canvas-context-menu.md).
 */

interface MenuItemBase {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Destructive. Ends the list, reads in --app-danger, and by convention
   *  its label ends in `…` because it opens a confirmation elsewhere. */
  danger?: boolean;
  disabled?: boolean;
}

export type MenuItem =
  | (MenuItemBase & { onSelect: () => void; to?: never; href?: never })
  | (MenuItemBase & { to: string; onSelect?: never; href?: never })
  | (MenuItemBase & { href: string; onSelect?: never; to?: never })
  | { separator: true; id: string };

export interface MenuProps {
  items: MenuItem[];
  /** Accessible name of the popup, e.g. `Actions for ${title}`. */
  label: string;
  /**
   * Trigger appearance. Defaults to a ⋯ button named `label`. Export passes
   * the full IconButton surface — icon, text, chevron, busy state.
   */
  trigger?: Omit<IconButtonProps, "aria-expanded" | "aria-haspopup" | "ref" | "onClick">;
  /** Controlled open state, for a list that allows only one open menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which edge the popup grows from. Default "bottom". */
  side?: "bottom" | "top";
  /** Which edge it lines up with. Default "end" — right-aligned. */
  align?: "start" | "end";
  /** Extra class on the root, where a call site sets `--menu-width`. */
  className?: string;
}

/** The menu's own items, in DOM order, minus the ones that cannot be used. */
function enabledItems(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])].filter(
    (item) =>
      !(item as HTMLButtonElement).disabled && item.getAttribute("aria-disabled") !== "true",
  );
}

export function Menu({
  items,
  label,
  trigger,
  open: openProp,
  onOpenChange,
  side = "bottom",
  align = "end",
  className,
}: MenuProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = openProp ?? uncontrolled;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setUncontrolled(next);
    },
    [onOpenChange, openProp],
  );

  // Focus moving in on open is what makes the arrow keys below reachable.
  useEffect(() => {
    if (open) enabledItems(menuRef.current)[0]?.focus();
  }, [open]);

  // A click anywhere else dismisses the menu without stealing the click.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = enabledItems(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Wraps: ArrowUp from the first item is the fastest way to the
      // destructive one at the bottom.
      list[(index + delta + list.length) % list.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      list.at(-1)?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      // Tabbing out dismisses rather than leaving an orphaned popup behind
      // the next control.
      close(false);
    }
  }

  const triggerProps = trigger ?? { icon: MoreHorizontal, label, iconSize: 15 };
  /*
   * The default ⋯ look applies only when the call site brought no class of
   * its own. The canvas header's Export button is a command-bar control
   * first and a menu trigger second, and `.menu-trigger`'s square geometry
   * would crush it.
   */
  const triggerClassName = triggerProps.className ?? "menu-trigger";

  return (
    <div className={className ? `menu ${className}` : "menu"} ref={rootRef}>
      <IconButton
        {...triggerProps}
        className={triggerClassName}
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? popupId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && (
        <div
          ref={menuRef}
          id={popupId}
          className={`menu-popup menu-popup-${side} menu-popup-${align}`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) =>
            "separator" in item ? (
              <hr key={item.id} className="menu-separator" />
            ) : (
              <MenuRow key={item.id} item={item} onActivate={() => close(true)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  item,
  onActivate,
}: {
  item: Exclude<MenuItem, { separator: true }>;
  onActivate: () => void;
}) {
  const Icon = item.icon;
  const className = item.danger ? "menu-item is-danger" : "menu-item";
  const content: ReactNode = (
    <>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {item.label}
    </>
  );

  /*
   * A disabled link is a span, not an <a> without href: the latter is not
   * focusable, so it would silently drop out of the arrow-key walk while
   * still looking like a row.
   */
  if (item.disabled && (item.to !== undefined || item.href !== undefined)) {
    return (
      <span role="menuitem" aria-disabled="true" tabIndex={-1} className={className}>
        {content}
      </span>
    );
  }
  if (item.to !== undefined) {
    return (
      <Link role="menuitem" className={className} to={item.to} onClick={onActivate}>
        {content}
      </Link>
    );
  }
  if (item.href !== undefined) {
    return (
      <a
        role="menuitem"
        className={className}
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onActivate}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={className}
      disabled={item.disabled}
      onClick={() => {
        // Close first, then act: the action often replaces what is under
        // the menu, and a menu left open over it is a trap.
        onActivate();
        item.onSelect();
      }}
    >
      {content}
    </button>
  );
}
