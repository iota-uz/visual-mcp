import { type CanvasDoc, layoutCanvas, mountViewport } from "@visual-canvas/canvas";
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
    lanes: [{ id: "lane", label: "Lane", role: "primary", rect: { x: 0, y: 0, w: 1_000, h: 600 } }],
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
    document.body.appendChild(container);
    const initial = doc();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(initial),
      resolveIframeUrl: (node) =>
        `https://screens.test/v1${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveIframeIdentity: () => "runtime@1",
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
      resolveIframeUrl: (node) =>
        `https://screens.test/v1${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveIframeIdentity: () => "runtime@1",
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
      resolveIframeUrl: (node) =>
        `https://screens.test/v2${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveIframeIdentity: () => "runtime@1",
    });
    expect(container.querySelector('[data-node-id="screen"]')).toBe(screenOwner);
    expect(container.querySelector('[data-node-id="screen"] iframe')).toBe(iframe);

    controller.updateCanvas(layoutCanvas(changed), {
      resolveIframeUrl: (node) =>
        `https://screens.test/v2${node.source.entrypoint}${node.source.route ?? ""}`,
      resolveIframeIdentity: () => "runtime@2",
    });
    expect(container.querySelector('[data-node-id="screen"]')).not.toBe(screenOwner);
    expect(
      container.querySelector('[data-node-id="screen"] .vc-iframe-placeholder'),
    ).not.toBeNull();
    controller.dispose();
  });

  test("switches to a disjoint Page document without recreating the viewport shell", () => {
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
    document.body.appendChild(container);
    const controller = mountViewport({ container, canvas: layoutCanvas(doc()) });
    flushFrames();
    const world = container.querySelector(".vc-world");
    const transform = (world as HTMLElement | null)?.style.transform;

    const architecture = doc();
    architecture.title = "Architecture";
    architecture.nodes = [
      {
        id: "architecture-product-map-desktop",
        kind: "native",
        shape: "note",
        rect: { x: 80, y: 70, w: 500, h: 300 },
        caption: { title: "01 · Схема продукта" },
        anchors,
      },
    ];
    architecture.edges = [];
    controller.updateCanvas(layoutCanvas(architecture));
    flushFrames();

    expect(container.querySelector(".vc-world")).toBe(world);
    expect(container.querySelector('[data-node-id="native"]')).toBeNull();
    expect(container.querySelector('[data-node-id="screen"]')).toBeNull();
    expect(
      container.querySelector('[data-node-id="architecture-product-map-desktop"]'),
    ).toHaveTextContent("01 · Схема продукта");
    expect((world as HTMLElement | null)?.style.transform).toBe(transform);
    controller.dispose();
  });

  test("replaces only the iframe whose content revision changed", () => {
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
    document.body.appendChild(container);
    const initial = doc();
    const firstScreen = initial.nodes[1];
    if (firstScreen?.kind !== "iframe") throw new Error("Missing screen fixture");
    initial.nodes.push({
      ...structuredClone(firstScreen),
      id: "untouched-screen",
      rect: { x: 430, y: 100, w: 200, h: 500 },
      source: { entrypoint: "/src/screens/untouched.html", route: "#/start" },
    });
    const revisions: Record<string, string> = {
      "/src/screens/runtime.html": "runtime@1",
      "/src/screens/untouched.html": "untouched@1",
    };
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(initial),
      resolveIframeUrl: (node) => `https://screens.test/token-1${node.source.entrypoint}`,
      resolveIframeIdentity: (node) => revisions[node.source.entrypoint] ?? "",
    });
    controller.activateIframe("screen");
    controller.deactivateIframe();
    controller.activateIframe("untouched-screen");
    const changedOwner = container.querySelector('[data-node-id="screen"]');
    const untouchedOwner = container.querySelector('[data-node-id="untouched-screen"]');
    const untouchedIframe = untouchedOwner?.querySelector("iframe");
    expect(changedOwner?.querySelector("iframe")).not.toBeNull();
    expect(untouchedIframe).not.toBeNull();

    const nextRevisions: Record<string, string> = {
      ...revisions,
      "/src/screens/runtime.html": "runtime@2",
    };
    controller.updateCanvas(layoutCanvas(structuredClone(initial)), {
      resolveIframeUrl: (node) => `https://screens.test/token-2${node.source.entrypoint}`,
      resolveIframeIdentity: (node) => nextRevisions[node.source.entrypoint] ?? "",
    });

    expect(container.querySelector('[data-node-id="screen"]')).not.toBe(changedOwner);
    expect(container.querySelector('[data-node-id="untouched-screen"]')).toBe(untouchedOwner);
    expect(container.querySelector('[data-node-id="untouched-screen"] iframe')).toBe(
      untouchedIframe,
    );
    controller.dispose();
  });

  test("reveals and copies the selected node ref when a resolver is provided", () => {
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
    document.body.appendChild(container);
    const onCopy = vi.fn();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(doc()),
      resolveElementRef: (nodeId) => `canvas://osago/realtime?node=${nodeId}`,
      onCopyElementRef: onCopy,
    });

    controller.selectNode("screen");
    const ref = container.querySelector<HTMLElement>(".vc-inspector-ref");
    expect(ref?.hidden).toBe(false);
    expect(container.querySelector(".vc-inspector-ref-value")).toHaveTextContent(
      "canvas://osago/realtime?node=screen",
    );
    container.querySelector<HTMLButtonElement>(".vc-inspector-ref-copy")?.click();
    expect(onCopy).toHaveBeenCalledWith("canvas://osago/realtime?node=screen");
    controller.dispose();
  });
});
