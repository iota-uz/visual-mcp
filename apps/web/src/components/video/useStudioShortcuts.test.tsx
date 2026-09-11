import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isInteractiveShortcutTarget, useStudioShortcuts } from "./useStudioShortcuts";

function setup(mode: "story" | "shots" | "timeline" | "review" = "story") {
  const onMode = vi.fn();
  const saveScript = vi.fn();
  const saveTimeline = vi.fn();
  renderHook(() => useStudioShortcuts({ mode, onMode, saveScript, saveTimeline }));
  return { onMode, saveScript, saveTimeline };
}

describe("isInteractiveShortcutTarget", () => {
  test.each([
    ["text input", '<input type="text">'],
    ["number input", '<input type="number">'],
    ["textarea", "<textarea></textarea>"],
    ["select", "<select></select>"],
    ["button", "<button>Save</button>"],
    ["link", '<a href="/v/1">Project</a>'],
    ["summary", "<summary>Versions</summary>"],
    ["checkbox", '<input type="checkbox">'],
    ["radio", '<input type="radio" name="m">'],
    ["slider role", '<div role="slider"></div>'],
    ["tab role", '<div role="tab"></div>'],
    ["contenteditable", '<div contenteditable="true"></div>'],
  ])("opts out: %s", (_label, html) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    const target = host.firstElementChild;
    if (!target) throw new Error("Expected a fixture element");
    expect(isInteractiveShortcutTarget(target)).toBe(true);
  });

  test.each([
    ["body", () => document.body],
    ["section", () => document.createElement("section")],
    ["plain div", () => document.createElement("div")],
    ["heading", () => document.createElement("h2")],
  ])("keeps the shortcut: %s", (_label, make) => {
    expect(isInteractiveShortcutTarget(make())).toBe(false);
  });

  test("non-elements never count as interactive", () => {
    expect(isInteractiveShortcutTarget(null)).toBe(false);
    expect(isInteractiveShortcutTarget(document)).toBe(false);
  });
});

describe("useStudioShortcuts", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement("div");
    host.innerHTML = `
      <textarea id="narration"></textarea>
      <input id="caption" type="text">
      <button id="action">Add scene</button>
      <input id="agree" type="checkbox">
      <div id="plain">canvas chrome</div>
    `;
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  function targetOf(id: string): HTMLElement {
    const target = host.querySelector(`#${id}`);
    if (!(target instanceof HTMLElement)) throw new Error(`Expected #${id}`);
    return target;
  }

  function keyOn(id: string, key: string, init?: KeyboardEventInit) {
    return fireEvent.keyDown(targetOf(id), { key, ...init });
  }

  test("digits switch modes from bare chrome", () => {
    const { onMode } = setup("story");
    keyOn("plain", "2");
    expect(onMode).toHaveBeenCalledWith("shots");
  });

  test("digits never fire from fields, buttons, or toggles", () => {
    const { onMode } = setup("story");
    for (const id of ["narration", "caption", "action", "agree"]) keyOn(id, "2");
    expect(onMode).not.toHaveBeenCalled();
  });

  test("digits with modifiers never switch", () => {
    const { onMode } = setup("story");
    keyOn("plain", "2", { ctrlKey: true });
    keyOn("plain", "2", { altKey: true });
    keyOn("plain", "2", { metaKey: true });
    expect(onMode).not.toHaveBeenCalled();
  });

  test("repeating the active mode is a no-op", () => {
    const { onMode } = setup("shots");
    keyOn("plain", "2");
    expect(onMode).not.toHaveBeenCalled();
  });

  test("Cmd+S and Ctrl+S save both editors from anywhere", () => {
    const { onMode, saveScript, saveTimeline } = setup("story");
    expect(fireEvent.keyDown(targetOf("narration"), { key: "s", metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(targetOf("caption"), { key: "S", ctrlKey: true })).toBe(false);
    expect(saveScript).toHaveBeenCalledTimes(2);
    expect(saveTimeline).toHaveBeenCalledTimes(2);
    expect(onMode).not.toHaveBeenCalled();
  });

  test("listener detaches on unmount", () => {
    const onMode = vi.fn();
    const { unmount } = renderHook(() =>
      useStudioShortcuts({ mode: "story", onMode, saveScript: () => {}, saveTimeline: () => {} }),
    );
    unmount();
    fireEvent.keyDown(document.body, { key: "2" });
    expect(onMode).not.toHaveBeenCalled();
  });

  test("undo works from buttons and managed document fields but preserves native draft forms and dialogs", () => {
    const history = { undo: vi.fn(), redo: vi.fn(), canUndo: true, canRedo: true };
    renderHook(() =>
      useStudioShortcuts({
        mode: "story",
        onMode: vi.fn(),
        saveScript: vi.fn(),
        saveTimeline: vi.fn(),
        history,
      }),
    );
    expect(keyOn("action", "z", { metaKey: true })).toBe(false);
    expect(keyOn("caption", "z", { metaKey: true })).toBe(true);
    targetOf("caption").setAttribute("data-document-history", "");
    expect(keyOn("caption", "z", { metaKey: true })).toBe(false);
    targetOf("caption").setAttribute("data-native-history", "");
    expect(keyOn("caption", "z", { metaKey: true })).toBe(true);
    host.setAttribute("role", "dialog");
    expect(keyOn("action", "z", { metaKey: true })).toBe(true);
    expect(history.undo).toHaveBeenCalledTimes(2);
  });
});
