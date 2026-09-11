import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useContextMenuTrigger } from "./ContextMenu";
import type { MenuItem } from "./Menu";

/*
 * jsdom 26 has no PointerEvent, and testing-library's fallback builds a
 * plain Event whose constructor drops pointer init (button, pointerType,
 * clientX…) — exactly the fields the long-press gesture reads. The
 * polyfill below restores them so the tests exercise the real handler
 * path instead of asserting against neutered events.
 */
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class TestPointerEvent extends Event {
    pointerId = 0;
    pointerType = "";
    button = 0;
    isPrimary = false;
    clientX = 0;
    clientY = 0;
    constructor(type: string, init: Record<string, unknown> = {}) {
      super(type, init);
      // Event init (bubbles, cancelable, composed) is read-only after
      // construction; only the pointer payload is assigned here.
      const { pointerId, pointerType, button, isPrimary, clientX, clientY } = init;
      if (pointerId !== undefined) this.pointerId = pointerId as number;
      if (pointerType !== undefined) this.pointerType = pointerType as string;
      if (button !== undefined) this.button = button as number;
      if (isPrimary !== undefined) this.isPrimary = isPrimary as boolean;
      if (clientX !== undefined) this.clientX = clientX as number;
      if (clientY !== undefined) this.clientY = clientY as number;
    }
  }
  (window as unknown as Record<string, unknown>).PointerEvent = TestPointerEvent;
}

function Harness({
  items,
  label = "Target actions",
}: {
  items: MenuItem[] | null;
  label?: string;
}) {
  const { triggerProps, menu } = useContextMenuTrigger({
    resolveAnchor: (target) => {
      const element = target instanceof HTMLElement ? target : null;
      const anchor = element?.closest("[data-anchor]");
      return anchor instanceof HTMLElement ? anchor : null;
    },
    getMenu: () => (items ? { items, label } : null),
  });
  return (
    <div data-testid="overflow-ancestor" style={{ overflowY: "auto", transform: "scale(1)" }}>
      <div {...triggerProps}>
        <button type="button" data-anchor id="target">
          Target
        </button>
        <button type="button" id="plain">
          Plain
        </button>
      </div>
      <button type="button" id="outside">
        Outside
      </button>
      {menu}
    </div>
  );
}

function items(): MenuItem[] {
  return [
    { id: "open", label: "Open", onSelect: vi.fn() },
    { id: "rename", label: "Rename", onSelect: vi.fn() },
    { id: "stale", label: "Stale", disabled: true, onSelect: vi.fn() },
    { id: "sep", separator: true },
    { id: "delete", label: "Delete…", danger: true, onSelect: vi.fn() },
  ];
}

const target = () => screen.getByRole("button", { name: "Target" });
const menuItem = (name: string) => screen.getByRole("menuitem", { name });

describe("ContextMenu mouse and keyboard", () => {
  test("right-click opens a labelled menu and focuses the first item", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 100, clientY: 120 });
    expect(screen.getByRole("menu")).toHaveAccessibleName("Target actions");
    expect(menuItem("Open")).toHaveFocus();
  });

  test("no app actions means no preventDefault and no menu", () => {
    render(<Harness items={null} />);
    const event = fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    expect(event).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("plain areas inside the zone keep the browser menu", () => {
    render(<Harness items={items()} />);
    const event = fireEvent.contextMenu(screen.getByRole("button", { name: "Plain" }));
    expect(event).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Escape closes and returns focus to the anchor", async () => {
    const user = userEvent.setup();
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(target()).toHaveFocus();
  });

  test("outside pointerdown dismisses without stealing the click", async () => {
    const user = userEvent.setup();
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    expect(menuItem("Open")).toHaveFocus();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
  });

  test("arrows wrap, Home/End jump, disabled rows are skipped", async () => {
    const user = userEvent.setup();
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    await user.keyboard("{ArrowUp}");
    expect(menuItem("Delete…")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menuItem("Open")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(menuItem("Rename")).toHaveFocus();
    await user.keyboard("{End}");
    expect(menuItem("Delete…")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(menuItem("Open")).toHaveFocus();
  });

  test("Enter activates, closes, and returns focus", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Harness
        items={[
          { id: "open", label: "Open", onSelect: vi.fn() },
          { id: "rename", label: "Rename", onSelect: onRename },
        ]}
      />,
    );
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    await user.keyboard("{ArrowDown}");
    expect(menuItem("Rename")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(target()).toHaveFocus();
  });

  test("destructive rows read as danger", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    expect(menuItem("Delete…")).toHaveClass("is-danger");
  });

  test("Shift+F10 and the ContextMenu key open at the anchor", async () => {
    const user = userEvent.setup();
    render(<Harness items={items()} />);
    target().focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(menuItem("Open")).toHaveFocus();
    await user.keyboard("{Escape}");
    fireEvent.keyDown(target(), { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("right-click on the popup dismisses instead of stacking menus", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    const popup = screen.getByRole("menu");
    const event = fireEvent.contextMenu(popup, { clientX: 12, clientY: 12 });
    expect(event).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ContextMenu long-press", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function press(id: string, init: Record<string, unknown> = {}, advanceMs = 500): boolean {
    const element = id === "target" ? target() : screen.getByRole("button", { name: "Plain" });
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 60,
      clientY: 80,
      ...init,
    });
    act(() => {
      vi.advanceTimersByTime(advanceMs);
    });
    return screen.queryByRole("menu") !== null;
  }

  test("touch hold opens the menu", () => {
    render(<Harness items={items()} />);
    expect(press("target")).toBe(true);
    expect(menuItem("Open")).toHaveFocus();
  });

  test("movement past the threshold cancels", () => {
    render(<Harness items={items()} />);
    const element = target();
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 60,
      clientY: 80,
    });
    fireEvent.pointerMove(element, { pointerId: 7, clientX: 120, clientY: 80 });
    vi.advanceTimersByTime(500);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("multi-touch cancels", () => {
    render(<Harness items={items()} />);
    const element = target();
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 60,
      clientY: 80,
    });
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 8,
      button: 0,
      isPrimary: false,
      clientX: 200,
      clientY: 200,
    });
    vi.advanceTimersByTime(500);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("pointer cancel aborts", () => {
    render(<Harness items={items()} />);
    const element = target();
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 60,
      clientY: 80,
    });
    fireEvent.pointerCancel(element, { pointerId: 7 });
    vi.advanceTimersByTime(500);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("scrolling while pressed aborts", () => {
    render(<Harness items={items()} />);
    const element = target();
    fireEvent.pointerDown(element, {
      pointerType: "touch",
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 60,
      clientY: 80,
    });
    fireEvent.scroll(window);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("mouse hold never opens", () => {
    render(<Harness items={items()} />);
    expect(press("target", { pointerType: "mouse", isPrimary: true })).toBe(false);
  });

  test("plain areas never arm a press", () => {
    render(<Harness items={items()} />);
    expect(press("plain")).toBe(false);
  });
});

describe("ContextMenu viewport placement", () => {
  test("popup renders through a portal into document.body, outside any overflow/transform ancestor", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 60, clientY: 80 });
    const vessel = document.querySelector(".menu-popup-fixed");
    expect(vessel).not.toBeNull();
    const zone = screen.getByTestId("overflow-ancestor");
    expect(zone).not.toBeNull();
    expect(zone?.contains(vessel)).toBe(false);
    expect(vessel?.parentElement).toBe(document.body);
  });

  test("pointer invocation places the popup at the pointer's viewport coordinates", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 150, clientY: 220 });
    const vessel = document.querySelector(".menu-popup-fixed") as HTMLElement;
    // Inside the viewport the raw client coords pass through unclamped.
    expect(vessel.style.left).toBe("150px");
    expect(vessel.style.top).toBe("220px");
  });

  test("keyboard invocation places the popup beside the anchor rectangle, not at the pointer", () => {
    render(<Harness items={items()} />);
    const anchor = target();
    anchor.focus();
    anchor.getBoundingClientRect = () =>
      ({
        left: 300,
        right: 420,
        top: 160,
        bottom: 200,
        width: 120,
        height: 40,
        x: 300,
        y: 160,
      }) as DOMRect;
    fireEvent.keyDown(anchor, { key: "ContextMenu" });
    const vessel = document.querySelector(".menu-popup-fixed") as HTMLElement;
    expect(vessel.style.left).toBe("300px");
    expect(vessel.style.top).toBe("204px");
  });

  test("placement clamps to the viewport edge when the pointer is outside it", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 5000, clientY: -400 });
    const vessel = document.querySelector(".menu-popup-fixed") as HTMLElement;
    const left = Number.parseFloat(vessel.style.left);
    const top = Number.parseFloat(vessel.style.top);
    // jsdom measures the unstyled popup at zero width, so the clamp lands
    // at innerWidth minus the margin; what matters is it clamped at all.
    expect(left).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(top).toBeGreaterThanOrEqual(8);
  });
});

describe("ContextMenu lifecycle", () => {
  test("scroll detaches the popup", () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("anchor removal closes the popup", async () => {
    render(<Harness items={items()} />);
    fireEvent.contextMenu(target(), { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    target().remove();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
