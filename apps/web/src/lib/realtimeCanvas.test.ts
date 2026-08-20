import { layoutCanvas, mountViewport, type CanvasDoc } from "@visual-canvas/canvas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Realtime",
    world: { width: 1_000, height: 600 },
    lanes: [
      { id: "lane", label: "Lane", role: "primary", rect: { x: 0, y: 0, w: 1_000, h: 600 } },
    ],
    stages: [
      { id: "one", index: 0, label: "One", rect: { x: 0, y: 0, w: 500, h: 600 } },
      { id: "two", index: 1, label: "Two", rect: { x: 500, y: 0, w: 500, h: 600 } },
    ],
    labels: [],
    nodes: [
      {
        id: "native",
        kind: "native",
        shape: "note",
        laneId: "lane",
        stageId: "one",
        rect: { x: 100, y: 100, w: 140, h: 90 },
        caption: { title: "Before" },
        anchors,
      },
      {
        id: "screen",
        kind: "iframe",
        laneId: "lane",
        stageId: "two",
        rect: { x: 680, y: 100, w: 200, h: 500 },
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
    edges: [
      {
        id: "edge",
        source: { nodeId: "native", anchorId: "right" },
        target: { nodeId: "screen", anchorId: "left" },
        kind: "main",
        route: { type: "orthogonal" },
      },
    ],
  };
}

describe("reactive viewport reconciliation", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;

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
    frames.clear();
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(performance.now());
    }
  }

  test("updates structure and routes without resetting camera or a stable iframe", () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 1_200, bottom: 800, width: 1_200, height: 800, toJSON() {} }) as DOMRect;
    document.body.appendChild(container);
    const initial = doc();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(initial),
      resolveIframeUrl: (node) => `https://screens.test/v1${node.source.entrypoint}${node.source.route ?? ""}`,
    });
    flushFrames();
    controller.activateIframe("screen");
    const screenOwner = container.querySelector('[data-node-id="screen"]');
    const iframe = screenOwner?.querySelector("iframe");
    expect(iframe).not.toBeNull();

    controller.zoomAt(300, 200, 1.2);
    flushFrames();
    const transform = container.querySelector<HTMLElement>(".vc-world")?.style.transform;

    const changed = structuredClone(initial);
    const lane = changed.lanes[0];
    const native = changed.nodes[0];
    const screen = changed.nodes[1];
    if (!lane || !native || !screen) throw new Error("Invalid realtime test fixture");
    lane.label = "Updated lane";
    native.caption.title = "After";
    screen.rect.x = 720;
    controller.updateCanvas(layoutCanvas(changed), {
      resolveIframeUrl: (node) => `https://screens.test/v1${node.source.entrypoint}${node.source.route ?? ""}`,
    });
    flushFrames();

    expect(container.querySelector(".vc-lane-label")).toHaveTextContent("Updated lane");
    expect(container.querySelector('[data-node-id="native"] .vc-caption-title')).toHaveTextContent(
      "After",
    );
    expect(container.querySelector('[data-node-id="screen"]')).toBe(screenOwner);
    expect(container.querySelector('[data-node-id="screen"] iframe')).toBe(iframe);
    expect(container.querySelector<HTMLElement>(".vc-world")?.style.transform).toBe(transform);
    expect(container.querySelector(".vc-edge path")?.getAttribute("d")).toContain("720");

    controller.updateCanvas(layoutCanvas(changed), {
      resolveIframeUrl: (node) => `https://screens.test/v2${node.source.entrypoint}${node.source.route ?? ""}`,
    });
    expect(container.querySelector('[data-node-id="screen"]')).not.toBe(screenOwner);
    expect(container.querySelector('[data-node-id="screen"] .vc-iframe-placeholder')).not.toBeNull();
    controller.dispose();
  });
});
