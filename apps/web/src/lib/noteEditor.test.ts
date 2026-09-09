import { fireEvent } from "@testing-library/react";
import { type CanvasNote, mountNoteEditor, renderNote } from "@visual-canvas/canvas";
import { afterEach, describe, expect, test } from "vitest";

// jsdom has no PointerEvent constructor; MouseEvent supplies the coordinates
// and button semantics this pointer-driven double-tap needs.
Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent });

function note(overrides: Partial<CanvasNote> = {}): CanvasNote {
  return {
    id: "n-1",
    x: 0,
    y: 0,
    w: 220,
    text: "hello",
    color: "yellow",
    size: "m",
    author: "human",
    ...overrides,
  };
}

function mount(opts: { notes?: CanvasNote[]; editable?: boolean } = {}) {
  const notes = opts.notes ?? [note()];
  const container = document.createElement("div");
  const notesRoot = document.createElement("div");
  notesRoot.className = "vc-notes";
  notesRoot.innerHTML = notes.map((item) => renderNote(item)).join("");
  container.append(notesRoot);
  document.body.append(container);
  const editor = mountNoteEditor({
    container,
    notesRoot: () => notesRoot,
    notes: () => notes,
    editable: opts.editable ?? true,
    toWorld: (x, y) => ({ x, y }),
    toScreen: (point) => ({ x: point.x, y: point.y }),
    scale: () => 1,
    dragThreshold: () => 4,
  });
  return { container, notesRoot, notes, editor };
}

function press(el: Element, clientX = 10, clientY = 10) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX, clientY });
  fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX, clientY });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("sticky note double-click", () => {
  test("two presses within 500ms open the editor", () => {
    const { container, notesRoot } = mount();
    const el = notesRoot.querySelector(".vc-note");
    if (!el) throw new Error("expected a note");
    press(el);
    press(el);
    expect(container.querySelector("textarea.vc-note-editor")).not.toBeNull();
  });

  test("a drag between presses does not open the editor", () => {
    const { container, notesRoot } = mount();
    const el = notesRoot.querySelector(".vc-note");
    if (!el) throw new Error("expected a note");
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(container, { pointerId: 1, clientX: 40, clientY: 10 });
    fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX: 40, clientY: 10 });
    press(el);
    expect(container.querySelector("textarea.vc-note-editor")).toBeNull();
  });

  test("a second press on the resize handle does not open the editor", () => {
    const { container, notesRoot } = mount();
    const el = notesRoot.querySelector(".vc-note");
    if (!el) throw new Error("expected a note");
    press(el);
    const handle = el.querySelector(".vc-note-resize");
    if (!handle) throw new Error("expected a resize handle on the selected note");
    press(handle);
    expect(container.querySelector("textarea.vc-note-editor")).toBeNull();
  });

  test("does nothing when the editor is read-only", () => {
    const { container, notesRoot } = mount({ editable: false });
    const el = notesRoot.querySelector(".vc-note");
    if (!el) throw new Error("expected a note");
    press(el);
    press(el);
    expect(container.querySelector("textarea.vc-note-editor")).toBeNull();
  });
});
