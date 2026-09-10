import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useUnsavedNavigation } from "./useUnsavedNavigation";

function Editor() {
  useUnsavedNavigation(true);
  return <textarea aria-label="Dirty editor" defaultValue="Retain this text" />;
}
test("cancelled browser back suppresses navigation and restores history without losing editor", () => {
  window.history.replaceState({ idx: 3 }, "", window.location.href);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
  const navigation = vi.fn();
  const mounted = render(<Editor />);
  window.addEventListener("popstate", navigation);
  fireEvent(window, new PopStateEvent("popstate", { state: { idx: 2 } }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(go).toHaveBeenCalledWith(1);
  expect(navigation).not.toHaveBeenCalled();
  fireEvent(window, new PopStateEvent("popstate", { state: { idx: 3 } }));
  expect(navigation).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox")).toHaveValue("Retain this text");
  mounted.unmount();
  window.removeEventListener("popstate", navigation);
  confirm.mockRestore();
  go.mockRestore();
});
