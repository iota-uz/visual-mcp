/**
 * Canvas context menu: command catalog, pointer policy, and placement.
 * The viewport owns the DOM and the run() mapping; this module stays
 * framework-free and DOM-light so the menu can be unit-tested without a
 * viewport mount.
 */

export const CONTEXT_MENU_OFFSET_PX = 4;
export const CONTEXT_MENU_GUTTER_PX = 8;

/** Chrome that must keep its own pointer behaviour, including native menus. */
export const CONTEXT_MENU_CHROME_SELECTOR = [
  ".vc-toolbar",
  ".vc-inspector",
  ".vc-minimap",
  ".vc-shortcut-help",
  ".vc-comment-overlay",
  ".vc-comments",
  ".vc-edge",
  ".vc-edge-editor",
  ".vc-edge-handles",
  ".vc-multiselect",
  ".vc-context-menu",
  ".vc-zoom-menu",
].join(", ");

export type ContextMenuPointerPolicy = "open" | "suppress" | "native";

/**
 * A finger already uses long-press for multi-select and must not grow a
 * second menu. A mouse (or a keyboard with no prior pointer) opens ours.
 * `suppress` means preventDefault and do nothing else.
 */
export function contextMenuPointerPolicy(input: {
  enabled: boolean;
  pointerType: string | null;
}): ContextMenuPointerPolicy {
  if (input.pointerType === "touch") return "suppress";
  if (!input.enabled) return "native";
  return "open";
}

export function nativeBodyKeepsContextMenu(
  inNativeBody: boolean,
  selection: { isCollapsed: boolean; rangeCount: number } | null,
): boolean {
  return inNativeBody && !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
}

export type ContextCommandId =
  | "open-screen"
  | "fit-selection"
  | "fit-page"
  | "zoom-100"
  | "add-comment"
  | "copy-link"
  | "copy-ref"
  | "delete";

export type ContextMenuTarget =
  | { kind: "canvas"; hasSelection: boolean }
  | { kind: "node"; nodeKind: string; hasRef: boolean }
  | { kind: "nodes" }
  | { kind: "group" };

export type ContextMenuEntry =
  | { type: "separator" }
  | {
      type: "item";
      id: ContextCommandId;
      label: string;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
    };

export function contextMenuEntries(
  target: ContextMenuTarget,
  caps: { comments: boolean; editable: boolean; copyLink: boolean },
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [];
  const fitSelection = (disabled: boolean): ContextMenuEntry => ({
    type: "item",
    id: "fit-selection",
    label: "Fit Selection",
    shortcut: "⇧2",
    disabled,
  });
  const comment = (): ContextMenuEntry => ({
    type: "item",
    id: "add-comment",
    label: "Add comment",
  });
  const del = (): ContextMenuEntry => ({
    type: "item",
    id: "delete",
    label: "Delete…",
    shortcut: "⌫",
    danger: true,
  });

  if (target.kind === "canvas") {
    if (caps.comments) items.push(comment());
    items.push(
      { type: "separator" },
      fitSelection(!target.hasSelection),
      { type: "item", id: "fit-page", label: "Fit Page", shortcut: "⇧1" },
      { type: "item", id: "zoom-100", label: "Zoom to 100%", shortcut: "⇧0" },
    );
  } else if (target.kind === "node") {
    if (target.nodeKind === "iframe") {
      items.push({ type: "item", id: "open-screen", label: "Open screen", shortcut: "↵" });
    }
    items.push(fitSelection(false));
    if (caps.comments) items.push(comment());
    if (caps.copyLink) items.push({ type: "item", id: "copy-link", label: "Copy link" });
    if (target.hasRef) items.push({ type: "item", id: "copy-ref", label: "Copy element ref" });
    if (caps.editable) items.push({ type: "separator" }, del());
  } else if (target.kind === "nodes") {
    items.push(fitSelection(false));
    if (caps.editable) items.push({ type: "separator" }, del());
  } else {
    items.push(fitSelection(false));
  }

  return compactSeparators(items);
}

function compactSeparators(items: ContextMenuEntry[]): ContextMenuEntry[] {
  const next: ContextMenuEntry[] = [];
  for (const item of items) {
    if (item.type === "separator" && (next.length === 0 || next.at(-1)?.type === "separator"))
      continue;
    next.push(item);
  }
  if (next.at(-1)?.type === "separator") next.pop();
  return next;
}

export function placeContextMenu(input: {
  pointerX: number;
  pointerY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  offset?: number;
  gutter?: number;
}): { x: number; y: number } {
  const offset = input.offset ?? CONTEXT_MENU_OFFSET_PX;
  const gutter = input.gutter ?? CONTEXT_MENU_GUTTER_PX;
  const maxX = Math.max(gutter, input.viewportWidth - input.menuWidth - gutter);
  const maxY = Math.max(gutter, input.viewportHeight - input.menuHeight - gutter);
  let x = input.pointerX + offset;
  let y = input.pointerY + offset;
  if (x + input.menuWidth > input.viewportWidth - gutter)
    x = input.pointerX - input.menuWidth - offset;
  if (y + input.menuHeight > input.viewportHeight - gutter)
    y = input.pointerY - input.menuHeight - offset;
  return {
    x: Math.min(maxX, Math.max(gutter, x)),
    y: Math.min(maxY, Math.max(gutter, y)),
  };
}

export function contextMenuButtons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("[role='menuitem']")].filter(
    (item) => !item.disabled,
  );
}

export function paintContextMenu(
  host: HTMLElement,
  entries: ContextMenuEntry[],
  onPick: (id: ContextCommandId) => void,
): void {
  host.replaceChildren();
  for (const entry of entries) {
    if (entry.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "vc-context-sep";
      sep.setAttribute("role", "separator");
      host.append(sep);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.command = entry.id;
    if (entry.danger) button.classList.add("is-danger");
    button.disabled = Boolean(entry.disabled);
    const label = document.createElement("span");
    label.textContent = entry.label;
    button.append(label);
    if (entry.shortcut) {
      const kbd = document.createElement("kbd");
      kbd.textContent = entry.shortcut;
      button.append(kbd);
    }
    button.addEventListener("click", () => {
      if (button.disabled) return;
      onPick(entry.id);
    });
    host.append(button);
  }
}
