import { type CanvasDoc, layoutCanvas, mountViewport } from "@visual-canvas/canvas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Menu",
    world: { width: 1_000, height: 600 },
    lanes: [],
    stages: [],
    labels: [],
    groups: [{ id: "bundle", label: "Bundle", nodeIds: ["note"] }],
    edges: [],
    drawings: [],
    notes: [],
    nodes: [
      {
        id: "note",
        kind: "native",
        shape: "card",
        rect: { x: 80, y: 80, w: 160, h: 120 },
        caption: { title: "Note" },
        body: { text: "Selectable copy" },
        anchors,
      },
      {
        id: "screen",
        kind: "iframe",
        rect: { x: 400, y: 80, w: 200, h: 400 },
        caption: { title: "Screen" },
        anchors,
        source: { entrypoint: "/src/screens/runtime.html", route: "#/start" },
        viewport: { width: 284, height: 642 },
        frame: { kind: "phone", time: "09:42" },
        sandbox: ["allow-scripts"],
        permissions: [],
        activation: "double-click",
      },
      {
        id: "other",
        kind: "native",
        shape: "card",
        rect: { x: 700, y: 80, w: 140, h: 90 },
        caption: { title: "Other" },
        anchors,
      },
    ],
  };
}

describe("canvas context menu", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const live: Array<ReturnType<typeof mountViewport>> = [];

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
  });

  afterEach(() => {
    for (const controller of live.splice(0)) controller.dispose();
    frames.clear();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(performance.now());
    }
  }

  function viewportContainer() {
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1_200,
        bottom: 800,
        width: 1_200,
        height: 800,
        toJSON() {},
      }) as DOMRect;
    container.setPointerCapture = vi.fn();
    document.body.appendChild(container);
    return container;
  }

  function mount(options: Partial<Parameters<typeof mountViewport>[0]> = {}) {
    const container = viewportContainer();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(doc()),
      editable: true,
      ...options,
    });
    live.push(controller);
    flushFrames();
    return { container, controller };
  }

  function menu(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".vc-context-menu");
  }

  function items(container: HTMLElement) {
    return [
      ...(menu(container)?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []),
    ].map((item) => item.textContent);
  }

  function contextmenu(target: EventTarget, x = 40, y = 40) {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    (target as HTMLElement).dispatchEvent(event);
    return event;
  }

  test("right-click on empty canvas opens fit/zoom and keeps the current selection", () => {
    const { container, controller } = mount();
    controller.setSelection(["note"]);
    const event = contextmenu(container, 20, 20);
    expect(event.defaultPrevented).toBe(true);
    expect(menu(container)?.hasAttribute("hidden")).toBe(false);
    expect(items(container).join(" ")).toContain("Fit Page");
    expect(items(container).join(" ")).toContain("Fit Selection");
    expect(items(container).some((label) => label?.includes("Delete"))).toBe(false);
    expect(controller.getSelection()).toEqual(["note"]);
  });

  test("right-click on a node selects it and offers delete when editable", () => {
    const onDeleteNodes = vi.fn();
    const { container, controller } = mount({ onDeleteNodes });
    const node = container.querySelector<HTMLElement>('[data-node-id="note"]');
    if (!node) throw new Error("missing note");
    contextmenu(node, 120, 120);
    expect(controller.getSelection()).toEqual(["note"]);
    expect(items(container).join(" ")).toContain("Delete…");
    menu(container)?.querySelector<HTMLButtonElement>("[data-command='delete']")?.click();
    expect(onDeleteNodes).toHaveBeenCalledWith(["note"]);
    expect(menu(container)?.hasAttribute("hidden")).toBe(true);
  });

  test("a multi-selection keeps the set and only offers fit and delete", () => {
    const { container, controller } = mount();
    controller.setSelection(["note", "other"]);
    const note = container.querySelector<HTMLElement>('[data-node-id="note"]');
    if (!note) throw new Error("missing note");
    contextmenu(note, 120, 120);
    expect(controller.getSelection()).toEqual(["note", "other"]);
    expect(items(container).join(" ")).toContain("Fit Selection");
    expect(items(container).join(" ")).toContain("Delete…");
    expect(items(container).join(" ")).not.toContain("Copy link");
  });

  test("Add comment uses the click point on empty canvas and the node when the target is a node", () => {
    const onCommentDraft = vi.fn();
    const { container } = mount({ onCommentDraft });
    contextmenu(container, 30, 40);
    menu(container)?.querySelector<HTMLButtonElement>("[data-command='add-comment']")?.click();
    expect(onCommentDraft).toHaveBeenCalledTimes(1);
    expect(onCommentDraft.mock.calls[0]?.[0].nodeId).toBeUndefined();

    const node = container.querySelector<HTMLElement>('[data-node-id="note"]');
    if (!node) throw new Error("missing note");
    contextmenu(node, 120, 120);
    menu(container)?.querySelector<HTMLButtonElement>("[data-command='add-comment']")?.click();
    expect(onCommentDraft.mock.calls[1]?.[0].nodeId).toBe("note");
  });

  test("Copy link and Copy element ref call the app; read-only hides delete", () => {
    const onCopyNodeLink = vi.fn();
    const onCopyElementRef = vi.fn();
    const { container } = mount({
      editable: false,
      onCopyNodeLink,
      resolveElementRef: (id) => `canvas://ws/c?node=${id}`,
      onCopyElementRef,
    });
    const node = container.querySelector<HTMLElement>('[data-node-id="note"]');
    if (!node) throw new Error("missing note");
    contextmenu(node, 120, 120);
    expect(items(container).some((label) => label?.includes("Delete"))).toBe(false);
    menu(container)?.querySelector<HTMLButtonElement>("[data-command='copy-link']")?.click();
    expect(onCopyNodeLink).toHaveBeenCalledWith("note");

    contextmenu(node, 120, 120);
    menu(container)?.querySelector<HTMLButtonElement>("[data-command='copy-ref']")?.click();
    expect(onCopyElementRef).toHaveBeenCalledWith("canvas://ws/c?node=note");
  });

  test("Shift+F10 opens at the selection and Escape returns focus to the canvas", () => {
    const { container, controller } = mount();
    controller.setSelection(["note"]);
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
    );
    expect(menu(container)?.hasAttribute("hidden")).toBe(false);
    expect(items(container).join(" ")).toContain("Delete…");
    menu(container)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu(container)?.hasAttribute("hidden")).toBe(true);
    expect(document.activeElement).toBe(container);
  });

  test("toolbar and selected native-body text keep the system menu", () => {
    const { container } = mount();
    const toolbar = container.querySelector<HTMLElement>(".vc-toolbar");
    if (!toolbar) throw new Error("missing toolbar");
    const onChrome = contextmenu(toolbar, 600, 760);
    expect(onChrome.defaultPrevented).toBe(false);
    expect(menu(container)?.hasAttribute("hidden")).toBe(true);

    const body = container.querySelector<HTMLElement>(".vc-native-body");
    if (!body) throw new Error("missing native body");
    const range = document.createRange();
    range.selectNodeContents(body);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const onText = contextmenu(body, 120, 140);
    expect(onText.defaultPrevented).toBe(false);
    expect(menu(container)?.hasAttribute("hidden")).toBe(true);
  });

  test("a group offers only Fit Selection", () => {
    const { container } = mount();
    const group = container.querySelector<HTMLElement>('[data-group-id="bundle"]');
    if (!group) throw new Error("missing group");
    contextmenu(group, 90, 70);
    expect(items(container)).toEqual(["Fit Selection⇧2"]);
  });
});
