import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { CopyButton } from "./CopyButton";

// The failure that motivated this: on a non-secure origin `writeText`
// rejects, and the button still said "Copied" — so a user pasted nothing
// believing they had their token.
function stubClipboard(impl: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("says Copied when the write resolves", async () => {
  const user = userEvent.setup();
  stubClipboard(() => Promise.resolve());
  render(<CopyButton value="secret" />);

  await user.click(screen.getByRole("button"));
  expect(screen.getByText("Copied")).toBeInTheDocument();
});

test("does not say Copied when the write rejects", async () => {
  const user = userEvent.setup();
  stubClipboard(() => Promise.reject(new Error("denied")));
  render(<CopyButton value="secret" />);

  await user.click(screen.getByRole("button"));
  expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  expect(screen.getByText("Copy")).toBeInTheDocument();
});
