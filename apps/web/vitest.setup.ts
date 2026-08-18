import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

/*
 * jsdom 26 still ships no `HTMLDialogElement.showModal` / `.close` — calling
 * either throws "is not a function", which takes down every test that opens a
 * drawer. This is the minimum that makes `<dialog>` observable: the `open`
 * attribute flips, and `close` fires its event so the exit transition's
 * listener still runs.
 *
 * Deliberately not a focus trap or top-layer emulation. Those are the parts
 * of showModal() jsdom cannot model at all, so a test asserting on them
 * would be asserting on this shim rather than on a browser.
 */
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(
    this: HTMLDialogElement,
    returnValue?: string,
  ) {
    if (!this.open) return;
    this.open = false;
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  };
}
