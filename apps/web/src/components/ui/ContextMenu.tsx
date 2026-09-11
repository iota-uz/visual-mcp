import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type MenuItem, MenuPopup } from "./Menu";

/*
 * The app's contextual menu: right-click on pointer devices, intentional
 * long-press on touch, Shift+F10 / ContextMenu key from the keyboard.
 *
 * It reuses Menu's popup contract (focus entry, wrapping arrows, Home/End,
 * Escape-with-focus-return, Tab dismissal, disabled/destructive rows) and
 * adds only what a floating menu needs: collision-aware placement, outside
 * dismissal, and a press gesture that never fires while scrolling,
 * dragging, multi-touching, or after the pointer wanders.
 *
 * The popup renders through a portal into document.body. Ancestors like
 * the scene navigator (overflow-y: auto) or any transformed pane would
 * otherwise become the fixed-position containing block and clip the
 * popup while the coordinates below are viewport client pixels. Portaled
 * to <body>, fixed positioning and the client coordinate space agree by
 * construction, and no studio scroll container can clip or offset it.
 *
 * The browser keeps its own menu wherever this has nothing to offer: the
 * trigger only calls preventDefault when it actually opens one.
 */

export interface ContextMenuContent {
  items: MenuItem[];
  /** Accessible name of the popup, e.g. `Scene 2 actions`. */
  label: string;
}

interface OpenMenu extends ContextMenuContent {
  x: number;
  y: number;
  anchor: HTMLElement;
  nonce: number;
}

const VIEWPORT_MARGIN_PX = 8;
const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_MOVE_PX = 10;

function focusAnchor(anchor: HTMLElement) {
  if (anchor.tabIndex >= 0 && !(anchor as HTMLButtonElement).disabled) anchor.focus();
}

export interface ContextMenuTriggerOptions {
  /**
   * Nearest actionable ancestor of the event target, or null when the
   * gesture landed on something with no app actions. Returning null is
   * what preserves the native browser menu there.
   */
  resolveAnchor: (target: EventTarget | null) => HTMLElement | null;
  /** Built at open time, so disabled states reflect the moment of opening. */
  getMenu: (anchor: HTMLElement) => ContextMenuContent | null;
  /** Long-press needs a pointing device that has no right button. */
  enableLongPress?: boolean;
  longPressDelayMs?: number;
  longPressMovePx?: number;
}

export function useContextMenuTrigger({
  resolveAnchor,
  getMenu,
  enableLongPress = true,
  longPressDelayMs = LONG_PRESS_DELAY_MS,
  longPressMovePx = LONG_PRESS_MOVE_PX,
}: ContextMenuTriggerOptions): {
  triggerProps: {
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  menu: ReactNode;
  isOpen: boolean;
} {
  const [state, setState] = useState<OpenMenu | null>(null);
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null);
  const popupId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OpenMenu | null>(null);
  const nonceRef = useRef(0);
  const getMenuRef = useRef(getMenu);
  getMenuRef.current = getMenu;
  const resolveRef = useRef(resolveAnchor);
  resolveRef.current = resolveAnchor;
  const pressRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    anchor: HTMLElement;
    timer: number;
  } | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    const current = stateRef.current;
    stateRef.current = null;
    setState(null);
    setPlaced(null);
    if (returnFocus && current && document.contains(current.anchor)) focusAnchor(current.anchor);
  }, []);

  const cancelPress = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press) window.clearTimeout(press.timer);
  }, []);

  const openAt = useCallback(
    (x: number, y: number, content: ContextMenuContent, anchor: HTMLElement) => {
      cancelPress();
      nonceRef.current += 1;
      stateRef.current = { ...content, x, y, anchor, nonce: nonceRef.current };
      setPlaced(null);
      setState(stateRef.current);
    },
    [cancelPress],
  );

  const firePress = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || !document.contains(press.anchor)) return;
    const content = getMenuRef.current(press.anchor);
    if (!content || content.items.length === 0) return;
    openAt(press.x, press.y, content, press.anchor);
  }, [openAt]);

  // Collision: measure after mount, then clamp inside the viewport.
  useLayoutEffect(() => {
    if (!state) return;
    const node = wrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPlaced({
      x: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(state.x, window.innerWidth - rect.width - VIEWPORT_MARGIN_PX),
      ),
      y: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(state.y, window.innerHeight - rect.height - VIEWPORT_MARGIN_PX),
      ),
    });
  }, [state]);

  // Dismiss on outside pointerdown (without stealing the click), on scroll
  // or resize that would detach the popup, and when the anchor itself is
  // removed — e.g. the action that opened it navigated away. A right-click
  // on the popup itself dismisses instead of stacking the browser menu on
  // top; this lives on window (not JSX) because the wrapper is a pure
  // positioning vessel with no widget role of its own.
  useEffect(() => {
    if (!state) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) close(false);
    }
    function onContextMenu(event: MouseEvent) {
      if (wrapRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        close(false);
      }
    }
    function onScroll() {
      close(false);
    }
    const observer = new MutationObserver(() => {
      const current = stateRef.current;
      if (current && !document.contains(current.anchor)) close(false);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [state, close]);

  // A pending press dies with the tree that started it.
  useEffect(() => cancelPress, [cancelPress]);

  // Native touch scrolling normally emits pointercancel, but that is not
  // consistent across embedded browsers. Cancel explicitly on any scroll so
  // a stationary finger never opens a menu after the viewport has moved.
  useEffect(() => {
    window.addEventListener("scroll", cancelPress, true);
    return () => window.removeEventListener("scroll", cancelPress, true);
  }, [cancelPress]);

  function onContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const anchor = resolveRef.current(event.target);
    if (!anchor) return;
    const content = getMenuRef.current(anchor);
    if (!content || content.items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    openAt(event.clientX, event.clientY, content, anchor);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key.toLowerCase() === "f10"))
      return;
    const anchor = resolveRef.current(document.activeElement);
    if (!anchor) return;
    const content = getMenuRef.current(anchor);
    if (!content || content.items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = anchor.getBoundingClientRect();
    openAt(rect.left, rect.bottom + 4, content, anchor);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!enableLongPress || event.pointerType === "mouse" || event.button !== 0) return;
    if (!event.isPrimary) {
      cancelPress();
      return;
    }
    const anchor = resolveRef.current(event.target);
    cancelPress();
    if (!anchor) return;
    const { pointerId, clientX, clientY } = event;
    pressRef.current = {
      pointerId,
      x: clientX,
      y: clientY,
      anchor,
      timer: window.setTimeout(firePress, longPressDelayMs),
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const press = pressRef.current;
    if (!press || event.pointerId !== press.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > longPressMovePx)
      cancelPress();
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (pressRef.current && event.pointerId === pressRef.current.pointerId) cancelPress();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (pressRef.current && event.pointerId === pressRef.current.pointerId) cancelPress();
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLElement>) {
    if (pressRef.current && event.pointerId === pressRef.current.pointerId) cancelPress();
  }

  // Portal vessel: a child of <body>, so position: fixed resolves against
  // the viewport and no studio overflow/transform ancestor clips it.
  const menu = state
    ? createPortal(
        <div
          ref={wrapRef}
          className="menu-popup-fixed"
          style={{ left: (placed ?? state).x, top: (placed ?? state).y }}
        >
          <MenuPopup
            key={state.nonce}
            id={popupId}
            label={state.label}
            items={state.items}
            onDismiss={close}
            className="menu-popup menu-popup-fixed-inner"
          />
        </div>,
        document.body,
      )
    : null;

  return {
    triggerProps: {
      onContextMenu,
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
    },
    menu,
    isOpen: state !== null,
  };
}
