import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem } from "./Menu";

/*
 * The keyboard contract is the whole reason this is a primitive: the two
 * menus it replaced each implemented it by hand, and a third call site
 * would have implemented it a third time. Every assertion here is a promise
 * `role="menu"` makes to a screen-reader or keyboard user.
 */

function renderMenu(items: MenuItem[], props: Partial<Parameters<typeof Menu>[0]> = {}) {
  return render(
    <MemoryRouter>
      <Menu label="Actions for Claim intake" items={items} {...props} />
      <button type="button">After</button>
    </MemoryRouter>,
  );
}

const open = () => screen.getByRole("button", { name: "Actions for Claim intake" });
const item = (name: string) => screen.getByRole("menuitem", { name });

describe("Menu", () => {
  const items: MenuItem[] = [
    { id: "open", label: "Open", to: "/c/one" },
    { id: "rename", label: "Rename", onSelect: vi.fn() },
    { id: "sep", separator: true },
    { id: "delete", label: "Delete canvas…", danger: true, onSelect: vi.fn() },
  ];

  it("renders no popup until it is opened", () => {
    renderMenu(items);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(open()).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus into the menu on open", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    await user.click(open());
    expect(screen.getByRole("menu")).toHaveAccessibleName("Actions for Claim intake");
    expect(item("Open")).toHaveFocus();
  });

  it("opens from the trigger with the arrow keys", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    open().focus();
    await user.keyboard("{ArrowDown}");
    expect(item("Open")).toHaveFocus();
  });

  it("wraps the arrows and jumps with Home and End", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    await user.click(open());
    // ArrowUp from the first item is the fastest way to the destructive one.
    await user.keyboard("{ArrowUp}");
    expect(item("Delete canvas…")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Open")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Delete canvas…")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Open")).toHaveFocus();
  });

  it("returns focus to the trigger on Escape", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    await user.click(open());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(open()).toHaveFocus();
  });

  it("closes on Tab without taking focus back", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    await user.click(open());
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(open()).not.toHaveFocus();
  });

  it("closes on a pointerdown outside", async () => {
    const user = userEvent.setup();
    renderMenu(items);
    await user.click(open());
    await user.click(screen.getByRole("button", { name: "After" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("runs an action and dismisses itself, so nothing is left over the result", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderMenu([{ id: "rename", label: "Rename", onSelect }]);
    await user.click(open());
    await user.click(item("Rename"));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("skips disabled items when walking with the arrows", async () => {
    const user = userEvent.setup();
    renderMenu([
      { id: "open", label: "Open", to: "/c/one" },
      { id: "delete", label: "Delete canvas…", danger: true, disabled: true, onSelect: vi.fn() },
      { id: "rename", label: "Rename", onSelect: vi.fn() },
    ]);
    await user.click(open());
    await user.keyboard("{ArrowDown}");
    expect(item("Rename")).toHaveFocus();
  });

  /*
   * A disabled link cannot be an <a> without href: that is not focusable, so
   * it would drop out of the walk above while still looking like a row.
   */
  it("renders a disabled link as an aria-disabled span", async () => {
    const user = userEvent.setup();
    renderMenu([{ id: "open", label: "Open", to: "/c/one", disabled: true }]);
    await user.click(open());
    const row = item("Open");
    expect(row.tagName).toBe("SPAN");
    expect(row).toHaveAttribute("aria-disabled", "true");
  });

  it("lets a list own which menu is open", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderMenu(items, { open: false, onOpenChange });
    await user.click(open());
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Controlled: the parent said closed, so it stays closed.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
