import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { handleHistoryKey, useDocumentHistory } from "./useDocumentHistory";
import { useRevisionEditor } from "./useRevisionEditor";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const writeScript = vi.fn().mockResolvedValue("s2");
  const writeTimeline = vi.fn().mockResolvedValue("t2");
  return {
    writeScript,
    ...renderHook(
      ({ revision, text }) => {
        const script = useRevisionEditor({ revision, document: text }, writeScript);
        const timeline = useRevisionEditor({ revision: "t1", document: 0 }, writeTimeline);
        const history = useDocumentHistory({ script, timeline });
        return { script, timeline, history };
      },
      { initialProps: { revision: "s1", text: "Original" } },
    ),
  };
}

test("one chronological history spans script and timeline, survives saves, and clears redo on a new branch", async () => {
  const { result } = setup();
  act(() => result.current.history.edit("script", "Scene"));
  await act(() => result.current.script.save());
  act(() => result.current.history.edit("timeline", 5));
  act(() => result.current.history.undo());
  expect(result.current.timeline.document).toBe(0);
  expect(result.current.timeline.dirty).toBe(false);
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("Original");
  expect(result.current.script.dirty).toBe(true);
  act(() => result.current.history.redo());
  expect(result.current.script.document).toBe("Scene");
  expect(result.current.script.dirty).toBe(false);
  act(() => result.current.history.edit("script", "Different"));
  expect(result.current.history.canRedo).toBe(false);
});

test("adopting a remote revision invalidates history, own subscription acknowledgement does not", async () => {
  const { result, rerender } = setup();
  act(() => result.current.history.edit("script", "Mine"));
  await act(() => result.current.script.save());
  rerender({ revision: "s2", text: "Mine" });
  expect(result.current.history.canUndo).toBe(true);
  rerender({ revision: "s3", text: "Collaborator" });
  expect(result.current.script.document).toBe("Collaborator");
  expect(result.current.history.canUndo).toBe(false);
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("Collaborator");
});

test("conflicts freeze history; explicit discard clears it", async () => {
  const { result, writeScript, rerender } = setup();
  writeScript.mockRejectedValue({ data: { code: "REVISION_CONFLICT" } });
  act(() => result.current.history.edit("script", "Mine"));
  rerender({ revision: "s3", text: "Theirs" });
  await act(() => result.current.script.save());
  expect(result.current.history.canUndo).toBe(false);
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("Mine");
  act(() => result.current.script.useSaved());
  expect(result.current.script.document).toBe("Theirs");
  expect(result.current.history.canUndo).toBe(false);
});

test("typing coalesces by field and pause, separate gestures remain individually reversible", () => {
  vi.useFakeTimers();
  const input = document.createElement("textarea");
  document.body.append(input);
  const { result } = setup();
  input.focus();
  act(() => result.current.history.edit("script", "A"));
  act(() => result.current.history.edit("script", "AB"));
  act(() => vi.advanceTimersByTime(760));
  act(() => result.current.history.edit("script", "ABC"));
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("AB");
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("Original");
  input.remove();
});

test("no-op edits do not destroy redo and rapid commands use current documents", () => {
  const { result } = setup();
  act(() => {
    result.current.history.edit("script", "One");
    result.current.history.edit("script", "Two");
  });
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("One");
  act(() => result.current.history.edit("script", "One"));
  expect(result.current.history.canRedo).toBe(true);
  act(() => result.current.history.redo());
  expect(result.current.script.document).toBe("Two");
});

test("a drag that stops propagation ends a typing group even when focus stays in the field", () => {
  const input = document.createElement("textarea");
  const handle = document.createElement("button");
  handle.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
  });
  document.body.append(input, handle);
  const { result } = setup();
  input.focus();
  act(() => result.current.history.edit("timeline", 1));
  handle.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
  act(() => result.current.history.edit("timeline", 2));
  act(() => result.current.history.undo());
  expect(result.current.timeline.document).toBe(1);
  act(() => result.current.history.undo());
  expect(result.current.timeline.document).toBe(0);
  input.remove();
  handle.remove();
});

test("starting a save and undo in the same event neither changes the document nor consumes history", async () => {
  const { result } = setup();
  act(() => result.current.history.edit("script", "Mine"));
  await act(async () => {
    const saving = result.current.script.save();
    result.current.history.undo();
    result.current.history.edit("timeline", 10);
    await saving;
  });
  expect(result.current.script.document).toBe("Mine");
  expect(result.current.timeline.document).toBe(0);
  act(() => result.current.history.undo());
  expect(result.current.script.document).toBe("Original");
});

test("Cmd/Ctrl shortcuts normalize case; composition, Alt and consumed events remain untouched", () => {
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true };
  for (const init of [
    { key: "z", metaKey: true },
    { key: "Z", ctrlKey: true, shiftKey: true },
    { key: "y", ctrlKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", { ...init, cancelable: true });
    expect(handleHistoryKey(event, history)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  }
  for (const init of [{ altKey: true }, { isComposing: true }]) {
    expect(
      handleHistoryKey(new KeyboardEvent("keydown", { key: "z", metaKey: true, ...init }), history),
    ).toBe(false);
  }
  expect(history.undo).toHaveBeenCalledTimes(1);
  expect(history.redo).toHaveBeenCalledTimes(2);
});
