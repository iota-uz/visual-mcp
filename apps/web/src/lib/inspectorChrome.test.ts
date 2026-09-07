import { type CanvasDoc, layoutCanvas, mountViewport } from "@visual-canvas/canvas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Inspector",
    world: { width: 1_000, height: 600 },
    lanes: [],
    stages: [],
    labels: [],
    groups: [],
    edges: [],
    drawings: [],
    nodes: [
      {
        id: "note",
        kind: "native",
        shape: "note",
        rect: { x: 80, y: 80, w: 160, h: 120 },
        caption: { title: "Note" },
        annotation: { format: "text", content: "Why this step exists." },
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
    ],
  };
}

describe("node-anchored inspector", () => {
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

  function mount(options: Partial<Parameters<typeof mountViewport>[0]> = {}) {
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
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(doc()),
      editable: true,
      initialView: { x: 0, y: 0, scale: 1 },
      resolveElementRef: (id) => `canvas://ws/c?node=${id}`,
      ...options,
    });
    live.push(controller);
    flushFrames();
    return { container, controller };
  }

  test("the inspector sits next to the selected node, not in the viewport corner", () => {
    const { container, controller } = mount();
    controller.selectNode("note");
    flushFrames();
    const inspector = container.querySelector<HTMLElement>(".vc-inspector");
    expect(inspector?.classList.contains("visible")).toBe(true);
    expect(inspector?.style.transform).toMatch(/translate\(/);
    expect(inspector?.style.left ?? "").not.toBe("18px");
    expect(inspector?.querySelector(".vc-inspector-annotation")).toHaveTextContent(
      "Why this step exists.",
    );
  });

  test("Escape leaves screen interaction and keeps the selection", () => {
    const { container, controller } = mount();
    controller.selectNode("screen");
    controller.activateIframe("screen");
    flushFrames();
    expect(container.classList.contains("is-interacting")).toBe(true);
    expect(
      container.querySelector('[data-node-id="screen"]')?.classList.contains("iframe-active"),
    ).toBe(true);

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(container.classList.contains("is-interacting")).toBe(false);
    expect(controller.getSelection()).toEqual(["screen"]);
    expect(
      container.querySelector('[data-node-id="screen"]')?.classList.contains("iframe-active"),
    ).toBe(false);

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(controller.getSelection()).toEqual([]);
  });

  test("Exit is a screen-space control on the active iframe", () => {
    const { container, controller } = mount();
    controller.selectNode("screen");
    controller.activateIframe("screen");
    flushFrames();
    const exit = container.querySelector<HTMLButtonElement>(".vc-screen-exit");
    expect(exit).not.toBeNull();
    expect(container.querySelector(".vc-iframe-exit")).toBeNull();
    expect(exit?.style.transform).toMatch(/translate\(/);
    exit?.click();
    expect(container.classList.contains("is-interacting")).toBe(false);
    expect(controller.getSelection()).toEqual(["screen"]);
  });
});
