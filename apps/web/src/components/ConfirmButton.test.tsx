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
