import { fireEvent, render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Drawer } from "./Drawer";

/*
 * These cover the wiring this component owns — mount/unmount, the close
 * paths, and the labelling. They deliberately do not assert on focus
 * containment or stacking: jsdom has no top layer, and the shim in
 * vitest.setup.ts doesn't pretend otherwise, so a test of those would be
 * testing the shim rather than a browser.
 */

function Harness({ title }: { title?: string } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open details
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        label={title ? undefined : "Canvas details"}
        closeLabel="Close canvas details"
      >
        <p>Version history</p>
      </Drawer>
    </>
  );
}

describe("Drawer", () => {
  it("renders nothing until it is opened", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens as a modal dialog and shows its content", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open details" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });

  it("takes its accessible name from the visible title when there is one", async () => {
    const user = userEvent.setup();
    render(<Harness title="Details" />);
    await user.click(screen.getByRole("button", { name: "Open details" }));

    expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
  });

  it("falls back to the label when there is no visible title", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open details" }));

    expect(await screen.findByRole("dialog", { name: "Canvas details" })).toBeInTheDocument();
  });

  it("closes from its own close button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Close canvas details" }));

    // It unmounts only once the slide-out finishes. No transition ever runs
    // in jsdom, so what lands it here is usePresence's timeout fallback —
    // which is exactly the path `prefers-reduced-motion` takes in a browser.
    await waitForElementToBeRemoved(dialog, { timeout: 2000 });
    expect(screen.queryByText("Version history")).not.toBeInTheDocument();
  });

  it("routes native Escape cancellation through onClose", async () => {
    const user = userEvent.setup();
    render(<Harness title="Details" />);
    await user.click(screen.getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog", { name: "Details" });

    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitForElementToBeRemoved(dialog, { timeout: 2000 });
  });

  it("closes when the press lands on the backdrop rather than the panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open details" }));
    const dialog = await screen.findByRole("dialog");

    // The <dialog> box fills the viewport; the panel inside it is the drawer.
    // A press whose target is the dialog element itself came from outside the
    // panel, which is the only thing ::backdrop can be detected by.
    await user.click(dialog);

    await waitForElementToBeRemoved(dialog, { timeout: 2000 });
  });

  it("leaves the panel alone when the press is inside it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open details" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByText("Version history"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
