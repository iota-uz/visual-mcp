import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConfirmButton } from "./ConfirmButton";

// The armed state is the whole safety mechanism: if it can be left live in
// a list row, a stray click deletes something. Each disarm route is tested
// because each is a separate listener and any one can rot independently.
function renderArmed(onConfirm = vi.fn().mockResolvedValue(undefined)) {
  render(
    <div>
      <ConfirmButton description="Deletes 3 canvases. Permanent." onConfirm={onConfirm} />
      <button type="button">outside</button>
    </div>,
  );
  return onConfirm;
}

test("arming shows the consequence and focuses the confirm button", async () => {
  const user = userEvent.setup();
  renderArmed();
  await user.click(screen.getByRole("button", { name: /delete/i }));

  const confirm = screen.getByRole("button", { name: "Really delete?" });
  expect(screen.getByText("Deletes 3 canvases. Permanent.")).toBeInTheDocument();
  expect(confirm).toHaveFocus();
});

test("Escape disarms without confirming, and returns focus", async () => {
  const user = userEvent.setup();
  const onConfirm = renderArmed();
  await user.click(screen.getByRole("button", { name: /delete/i }));
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("button", { name: "Really delete?" })).not.toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /delete/i })).toHaveFocus();
});

test("a click outside disarms without confirming", async () => {
  const user = userEvent.setup();
  const onConfirm = renderArmed();
  await user.click(screen.getByRole("button", { name: /delete/i }));
  await user.click(screen.getByRole("button", { name: "outside" }));

  expect(screen.queryByRole("button", { name: "Really delete?" })).not.toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
});

test("confirming calls onConfirm exactly once", async () => {
  const user = userEvent.setup();
  const onConfirm = renderArmed();
  await user.click(screen.getByRole("button", { name: /delete/i }));
  await user.click(screen.getByRole("button", { name: "Really delete?" }));

  expect(onConfirm).toHaveBeenCalledTimes(1);
});

/*
 * Reached from a ⋯ menu, the first of the two decisions has already been
 * made, so the button mounts armed and the parent owns the state. `onDisarm`
 * is what tells that parent to stop rendering the confirmation — without it
 * every escape route below collapses into a resting Delete button sitting in
 * the card next to the menu item that opened it.
 */
test("mounts armed for a menu-staged confirmation", async () => {
  const onDisarm = vi.fn();
  render(<ConfirmButton defaultArmed onDisarm={onDisarm} onConfirm={vi.fn()} />);

  const confirm = screen.getByRole("button", { name: "Really delete?" });
  expect(confirm).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(onDisarm).not.toHaveBeenCalled();
});

test.each([
  ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  [
    "Cancel",
    async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole("button", { name: "Cancel" })),
  ],
  [
    "a click outside",
    async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole("button", { name: "outside" })),
  ],
])("reports the disarm from %s", async (_route, act) => {
  const user = userEvent.setup();
  const onDisarm = vi.fn();
  render(
    <div>
      <ConfirmButton defaultArmed onDisarm={onDisarm} onConfirm={vi.fn()} />
      <button type="button">outside</button>
    </div>,
  );
  await act(user);
  expect(onDisarm).toHaveBeenCalledTimes(1);
});

test("reports the disarm after the action succeeds", async () => {
  const user = userEvent.setup();
  const onDisarm = vi.fn();
  render(
    <ConfirmButton
      defaultArmed
      onDisarm={onDisarm}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Really delete?" }));
  expect(onDisarm).toHaveBeenCalledTimes(1);
});

test("disarms itself after the timeout, and says so", async () => {
  vi.useFakeTimers();
  try {
    const onDisarm = vi.fn();
    render(<ConfirmButton defaultArmed onDisarm={onDisarm} onConfirm={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(8000);
    expect(onDisarm).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
