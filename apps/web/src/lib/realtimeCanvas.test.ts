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
    groups: [],
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
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  function flushFrames() {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(performance.now());
    }
  }

  function dispatchPointer(
    target: Element,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    x: number,
    y: number,
    pointerType: "mouse" | "touch" = "mouse",
    shiftKey = false,
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      shiftKey,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
    });
    target.dispatchEvent(event);
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
    const edgePaths = [...container.querySelectorAll(".vc-edge path")];
    expect(edgePaths).toHaveLength(2);
    expect(edgePaths.every((path) => path.getAttribute("d")?.includes("720"))).toBe(true);

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
    /*
     * Dimming focuses the selected node's stage, so the node itself must
     * never be part of what fades: it used to be compared as
     * `dataset.stage !== node.stageId`, and an absent stage is `""` in the
     * DOM but `undefined` here — on a stageless canvas that dimmed
     * everything, selection included.
     */
    const dimmed = () =>
      [...container.querySelectorAll<HTMLElement>(".vc-node.dimmed")].map((el) => el.dataset.nodeId);
    expect(dimmed()).toEqual(["native"]);
    expect(container.querySelector(".vc-node.selected")?.classList.contains("dimmed")).toBe(false);

    const ref = container.querySelector<HTMLElement>(".vc-inspector-ref");
    expect(ref?.hidden).toBe(false);
    expect(container.querySelector(".vc-inspector-ref-value")).toHaveTextContent(
      "canvas://osago/realtime?node=screen",
    );
    container.querySelector<HTMLButtonElement>(".vc-inspector-ref-copy")?.click();
    expect(onCopy).toHaveBeenCalledWith("canvas://osago/realtime?node=screen");
    controller.dispose();
  });

  test("a canvas with no stages dims nothing when a node is selected", () => {
    const container = viewportContainer();
    // Stages are optional, and plenty of canvases are just a board of nodes.
    // There is no stage to focus here, so the dim has nothing to say.
    const stageless = doc();
    stageless.stages = [];
    stageless.nodes = stageless.nodes.map((node) => ({ ...node, stageId: undefined }));
    const controller = mountViewport({ container, canvas: layoutCanvas(stageless) });
    flushFrames();

    controller.selectNode("screen");
    expect(container.querySelectorAll(".vc-node.dimmed")).toHaveLength(0);
    expect(container.querySelector(".vc-node.selected")?.getAttribute("data-node-id")).toBe(
      "screen",
    );
    controller.dispose();
  });

  test("starts in safe View and persists geometry only after explicit Move", () => {
    const container = viewportContainer();
    const onGeometryChange = vi.fn();
    const positioned = layoutCanvas(doc());
    const positionedNode = positioned.nodes[0];
    if (!positionedNode) throw new Error("Missing positioned node");
    const original = { ...positionedNode.rect };
    const controller = mountViewport({
      container,
      canvas: positioned,
      editable: true,
      onGeometryChange,
    });
    flushFrames();

    const node = container.querySelector<HTMLElement>('[data-node-id="native"]');
    const view = container.querySelector<HTMLButtonElement>('[data-tool="view"]');
    const move = container.querySelector<HTMLButtonElement>('[data-tool="move"]');
    if (!node || !view || !move) throw new Error("Missing viewport controls");

    expect(controller.getTool()).toBe("view");
    expect(container.dataset.tool).toBe("view");
    expect(view).toHaveAttribute("aria-pressed", "true");

    dispatchPointer(node, "pointerdown", 100, 100);
    dispatchPointer(node, "pointerup", 100, 100);
    expect(node).toHaveClass("selected");
    expect(document.activeElement).toBe(container);

    dispatchPointer(node, "pointerdown", 100, 100);
    dispatchPointer(node, "pointermove", 160, 130);
    dispatchPointer(node, "pointerup", 160, 130);
    flushFrames();
    expect(positionedNode.rect).toEqual(original);
    expect(onGeometryChange).not.toHaveBeenCalled();

    move.click();
    expect(controller.getTool()).toBe("move");
    expect(move).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".vc-resize-handle")).not.toBeNull();

    dispatchPointer(node, "pointerdown", 100, 100);
    dispatchPointer(node, "pointermove", 160, 130);
    dispatchPointer(node, "pointerup", 160, 130);
    flushFrames();
    expect(positionedNode.rect.x).toBe(original.x + 60);
    expect(positionedNode.rect.y).toBe(original.y + 30);
    expect(onGeometryChange).toHaveBeenCalledOnce();
    // The third argument is the rect the drag started from: the app keeps it
    // for a session-local undo, and nothing else still knows it by then.
    expect(onGeometryChange).toHaveBeenCalledWith("native", positionedNode.rect, original);

    const committed = { ...positionedNode.rect };
    dispatchPointer(node, "pointerdown", 160, 130);
    dispatchPointer(node, "pointermove", 220, 180);
    dispatchPointer(node, "pointercancel", 220, 180);
    flushFrames();
    expect(positionedNode.rect).toEqual(committed);
    expect(onGeometryChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  /* --- multi-selection: marquee, shift-click, batch move, delete --- */

  function multiDoc(): CanvasDoc {
    const base = doc();
    return {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "second",
          kind: "native",
          shape: "note",
          laneId: "lane",
          stageId: "one",
          rect: { x: 260, y: 100, w: 140, h: 90 },
          caption: { title: "Second" },
          anchors,
        },
      ],
    };
  }

  function mountEditable(canvasDoc: CanvasDoc, options: Record<string, unknown> = {}) {
    const container = viewportContainer();
    const positioned = layoutCanvas(canvasDoc);
    const controller = mountViewport({ container, canvas: positioned, editable: true, ...options });
    flushFrames();
    container.querySelector<HTMLButtonElement>('[data-tool="move"]')?.click();
    const view = controller.getView();
    const toScreen = (x: number, y: number): [number, number] => [
      x * view.scale + view.x,
      y * view.scale + view.y,
    ];
    return { container, controller, positioned, toScreen };
  }

  test("comment pins only exist when the app opts in", () => {
    const { container } = mountEditable(multiDoc());
    // Present and the public share page mount this same viewport.
    expect(container.querySelector('[data-tool="comment"]')).toBeNull();
    expect(container.querySelector(".vc-comments")).not.toBeNull();
    expect(container.querySelector(".vc-comment-marker")).toBeNull();
  });

  test("a pin follows its node, survives its deletion, and opens its thread", () => {
    const onCommentActivate = vi.fn();
    const { container, controller, positioned } = mountEditable(multiDoc(), {
      onCommentDraft: vi.fn(),
      onCommentActivate,
      comments: [
        { id: "c1", nodeId: "native", status: "open" },
        { id: "c2", point: { x: 500, y: 300 }, status: "resolved" },
      ],
    });
    const view = controller.getView();
    const node = positioned.nodes.find((entry) => entry.id === "native");
    if (!node) throw new Error("Missing node");

    const pin = container.querySelector<HTMLElement>('[data-comment-id="c1"]');
    expect(pin).not.toBeNull();
    // Anchored to the node's top-right corner, projected through the camera,
    // and carrying how many threads are on that anchor — never blank.
    expect(pin?.style.transform).toBe(
      `translate(${(node.x + node.w) * view.scale + view.x}px, ${node.y * view.scale + view.y}px)`,
    );
    expect(pin).toHaveTextContent("1");
    expect(container.querySelector('[data-comment-id="c2"]')).toHaveAttribute(
      "data-status",
      "resolved",
    );

    pin?.click();
    expect(onCommentActivate).toHaveBeenCalledWith("c1");

    // The node goes; the thread does not become a pin over empty canvas.
    const withoutNative = multiDoc();
    withoutNative.nodes = withoutNative.nodes.filter((entry) => entry.id !== "native");
    withoutNative.edges = [];
    controller.updateCanvas(layoutCanvas(withoutNative));
    flushFrames();
    expect(container.querySelector<HTMLElement>('[data-comment-id="c1"]')?.hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-comment-id="c2"]')?.hidden).toBe(false);
  });

  test("threads sharing an anchor are one pin, counted and coloured by the worst", () => {
    const { container, controller } = mountEditable(multiDoc(), {
      onCommentDraft: vi.fn(),
      comments: [
        { id: "c1", nodeId: "native", status: "completed" },
        { id: "c2", nodeId: "native", status: "open" },
      ],
    });
    // Two pins on one corner read as a smudge however far they are nudged
    // apart, so the anchor gets one pin.
    const pins = container.querySelectorAll(".vc-comment-marker");
    expect(pins).toHaveLength(1);
    const pin = pins[0] as HTMLElement;
    expect(pin).toHaveTextContent("2");
    // Open outranks completed: the pin shows the work still to do, and
    // clicking it opens that thread rather than the finished one.
    expect(pin.dataset.status).toBe("open");
    expect(pin.dataset.commentId).toBe("c2");

    // The panel says which thread it has open; the pin says so too.
    controller.setActiveComment("c1");
    expect(pin.hasAttribute("data-active")).toBe(true);
    controller.setActiveComment(null);
    expect(pin.hasAttribute("data-active")).toBe(false);
  });

  test("the Comment tool hands the app an anchor instead of drawing anything", () => {
    const onCommentDraft = vi.fn();
    const { container, controller, toScreen } = mountEditable(multiDoc(), {
      onCommentDraft,
      comments: [],
    });
    const native = container.querySelector<HTMLElement>('[data-node-id="native"]');
    if (!native) throw new Error("Missing node");

    container.querySelector<HTMLButtonElement>('[data-tool="comment"]')?.click();
    expect(controller.getTool()).toBe("comment");

    dispatchPointer(native, "pointerdown", ...toScreen(120, 120));
    expect(onCommentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "native", point: expect.anything() }),
    );
    // Placing a comment neither selects the node nor starts a drag.
    expect(controller.getSelection()).toEqual([]);

    dispatchPointer(container, "pointerdown", ...toScreen(700, 400));
    const [anchor] = onCommentDraft.mock.calls[1] as [{ nodeId?: string; point: { x: number } }];
    expect(anchor.nodeId).toBeUndefined();
    expect(Math.round(anchor.point.x)).toBe(700);
  });

  test("C selects the Comment tool only where comments exist", () => {
    // mountEditable leaves the Move tool active, so an ignored C is visible
    // as the tool staying exactly where it was.
    const plain = mountEditable(multiDoc());
    plain.container.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    expect(plain.controller.getTool()).toBe("move");

    const withComments = mountEditable(multiDoc(), { onCommentDraft: vi.fn(), comments: [] });
    withComments.container.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    expect(withComments.controller.getTool()).toBe("comment");
  });

  test("a marquee in Move takes only the nodes it fully contains", () => {
    const { container, controller, toScreen } = mountEditable(multiDoc());
    const world = container.querySelector<HTMLElement>(".vc-world");
    if (!world) throw new Error("Missing world");

    // "native" is 100..240; "second" starts at 260, so this band only clips it.
    dispatchPointer(container, "pointerdown", ...toScreen(80, 80));
    dispatchPointer(container, "pointermove", ...toScreen(300, 220));
    expect(container.querySelector(".vc-marquee")).not.toHaveAttribute("hidden");
    dispatchPointer(container, "pointerup", ...toScreen(300, 220));

    expect(controller.getSelection()).toEqual(["native"]);
    // The band disappears with the gesture.
    expect(container.querySelector(".vc-marquee")).toHaveAttribute("hidden");

    dispatchPointer(container, "pointerdown", ...toScreen(80, 80));
    dispatchPointer(container, "pointermove", ...toScreen(420, 220));
    dispatchPointer(container, "pointerup", ...toScreen(420, 220));
    expect(controller.getSelection()).toEqual(["native", "second"]);
    expect(container.querySelector(".vc-multiselect-count")).toHaveTextContent("2 nodes selected");
  });

  test("shift-click adds a node to the set and takes it back out", () => {
    const { container, controller } = mountEditable(multiDoc());
    const native = container.querySelector<HTMLElement>('[data-node-id="native"]');
    const second = container.querySelector<HTMLElement>('[data-node-id="second"]');
    if (!native || !second) throw new Error("Missing nodes");

    dispatchPointer(native, "pointerdown", 100, 100);
    dispatchPointer(native, "pointerup", 100, 100);
    expect(controller.getSelection()).toEqual(["native"]);

    dispatchPointer(second, "pointerdown", 300, 100, "mouse", true);
    dispatchPointer(second, "pointerup", 300, 100, "mouse", true);
    expect(controller.getSelection()).toEqual(["native", "second"]);
    expect(second).toHaveClass("selected");

    dispatchPointer(second, "pointerdown", 300, 100, "mouse", true);
    dispatchPointer(second, "pointerup", 300, 100, "mouse", true);
    expect(controller.getSelection()).toEqual(["native"]);
    expect(second).not.toHaveClass("selected");
  });

  test("dragging one of several selected nodes moves the whole set in one write", () => {
    const onNodesMove = vi.fn();
    const onGeometryChange = vi.fn();
    const { container, controller, positioned } = mountEditable(multiDoc(), {
      onNodesMove,
      onGeometryChange,
    });
    controller.setSelection(["native", "second"]);
    const native = container.querySelector<HTMLElement>('[data-node-id="native"]');
    if (!native) throw new Error("Missing node");
    const before = positioned.nodes.map((node) => ({ ...node.rect }));

    dispatchPointer(native, "pointerdown", 100, 100);
    dispatchPointer(native, "pointermove", 140, 70);
    dispatchPointer(native, "pointerup", 140, 70);
    flushFrames();

    // Relative arrangement preserved: both moved by exactly the same delta.
    expect(positioned.nodes[0]?.rect.x).toBe((before[0]?.x ?? 0) + 40);
    expect(positioned.nodes[2]?.rect.x).toBe((before[2]?.x ?? 0) + 40);
    expect(positioned.nodes[0]?.rect.y).toBe((before[0]?.y ?? 0) - 30);
    expect(onNodesMove).toHaveBeenCalledOnce();
    expect(onNodesMove).toHaveBeenCalledWith(["native", "second"], 40, -30);
    // One batch write, not one per node.
    expect(onGeometryChange).not.toHaveBeenCalled();
  });

  test("Delete asks the app instead of removing anything itself", () => {
    const onDeleteNodes = vi.fn();
    const { container, controller } = mountEditable(multiDoc(), { onDeleteNodes });
    controller.setSelection(["native", "second"]);

    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }),
    );
    expect(onDeleteNodes).toHaveBeenCalledWith(["native", "second"]);
    // The engine never mutates the document: deletion is a durable write the
    // app confirms and performs, and it comes back through updateCanvas.
    expect(container.querySelectorAll(".vc-node")).toHaveLength(3);

    container.querySelector<HTMLButtonElement>(".vc-multiselect-delete")?.click();
    expect(onDeleteNodes).toHaveBeenCalledTimes(2);
  });

  test("a selection survives a reactive update that deletes part of it", () => {
    const { container, controller } = mountEditable(multiDoc());
    controller.setSelection(["native", "second"]);
    const remaining = multiDoc();
    remaining.nodes = remaining.nodes.filter((node) => node.id !== "second");
    remaining.edges = [];
    controller.updateCanvas(layoutCanvas(remaining));
    flushFrames();

    expect(controller.getSelection()).toEqual(["native"]);
    expect(container.querySelector(".vc-multiselect")).toHaveAttribute("hidden");
  });

  test("supports keyboard tools, preserves camera on tool changes, Escape, and touch movement", () => {
    const container = viewportContainer();
    const onGeometryChange = vi.fn();
    const positioned = layoutCanvas(doc());
    const controller = mountViewport({
      container,
      canvas: positioned,
      editable: true,
      onGeometryChange,
    });
    flushFrames();

    const initialView = controller.getView();

    const moveTool = container.querySelector<HTMLButtonElement>('[data-tool="move"]');
    const viewTool = container.querySelector<HTMLButtonElement>('[data-tool="view"]');
    if (!moveTool || !viewTool) throw new Error("Missing viewport tools");

    moveTool.click();
    expect(controller.getTool()).toBe("move");
    expect(container.dataset.tool).toBe("move");
    expect(controller.getView()).toEqual(initialView);

    viewTool.click();
    expect(controller.getTool()).toBe("view");
    expect(controller.getView()).toEqual(initialView);

    expect(container.querySelector('[data-tool="pan"]')).toBeNull();
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    expect(controller.getTool()).toBe("view");
    expect(controller.getView()).toEqual(initialView);

    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(controller.getTool()).toBe("view");
    expect(container.dataset.tool).toBe("view");

    const input = document.createElement("input");
    container.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(controller.getTool()).toBe("view");

    const node = container.querySelector<HTMLElement>('[data-node-id="native"]');
    if (!node) throw new Error("Missing node");
    dispatchPointer(node, "pointerdown", 100, 100, "touch");
    dispatchPointer(node, "pointermove", 150, 130, "touch");
    dispatchPointer(node, "pointerup", 150, 130, "touch");
    expect(onGeometryChange).not.toHaveBeenCalled();

    dispatchPointer(node, "pointerdown", 100, 100, "touch");
    dispatchPointer(node, "pointerup", 100, 100, "touch");
    controller.setTool("move");
    dispatchPointer(node, "pointerdown", 100, 100, "touch");
    dispatchPointer(node, "pointermove", 150, 130, "touch");
    dispatchPointer(node, "pointerup", 150, 130, "touch");
    expect(onGeometryChange).toHaveBeenCalledOnce();
    controller.dispose();
  });

  test("uses one zoom control for restored camera, Fit Page, Fit Selection, and fixed scales", () => {
    const container = viewportContainer();
    const onViewChange = vi.fn();
    const positioned = layoutCanvas(doc());
    const controller = mountViewport({
      container,
      canvas: positioned,
      initialView: { x: 24, y: 36, scale: 0.5 },
      onViewChange,
    });
    flushFrames();

    // The readout is an editable field, not a label — see the typed-zoom
    // test below.
    const zoomField = container.querySelector<HTMLInputElement>(".vc-zoom-value");
    expect(controller.getView()).toEqual({ x: 24, y: 36, scale: 0.5 });
    expect(zoomField?.value).toBe("50%");
    const iframe = container.querySelector<HTMLIFrameElement>(
      '[data-node-id="screen"] .vc-iframe-viewport',
    );
    const naturalSize = iframe?.getAttribute("style");

    // Discrete zoom walks the canonical ladder, so 50% steps to the next
    // round rung. It used to multiply by 1.2 and land on 60%, then 72%,
    // then 86.4% — numbers no one chose.
    container.querySelector<HTMLButtonElement>('[data-zoom="in"]')?.click();
    flushFrames();
    expect(controller.getView().scale).toBe(0.75);
    expect(zoomField?.value).toBe("75%");

    container.querySelector<HTMLButtonElement>('[data-zoom="out"]')?.click();
    flushFrames();
    expect(controller.getView().scale).toBe(0.5);

    container.querySelector<HTMLButtonElement>('[data-zoom-action="200"]')?.click();
    flushFrames();
    expect(controller.getView().scale).toBe(2);
    expect(zoomField?.value).toBe("200%");

    controller.selectNode("screen");
    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "2", shiftKey: true, bubbles: true }),
    );
    flushFrames();
    expect(controller.getView().scale).toBe(1);

    container.dispatchEvent(
      new KeyboardEvent("keydown", { key: "1", shiftKey: true, bubbles: true }),
    );
    flushFrames();
    expect(controller.getView().scale).toBe(1);
    expect(iframe?.getAttribute("style")).toBe(naturalSize);
    expect(onViewChange).toHaveBeenCalled();
    controller.dispose();
  });

  test("accepts a typed zoom percentage and opens shortcut help on ?", () => {
    const container = viewportContainer();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(doc()),
      initialView: { x: 0, y: 0, scale: 1 },
    });
    flushFrames();

    const zoomField = container.querySelector<HTMLInputElement>(".vc-zoom-value");
    if (!zoomField) throw new Error("Missing zoom field");

    zoomField.value = "150";
    zoomField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushFrames();
    expect(controller.getView().scale).toBe(1.5);
    expect(zoomField.value).toBe("150%");

    // Nonsense reverts to the live camera instead of zooming to NaN.
    zoomField.value = "banana";
    zoomField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushFrames();
    expect(controller.getView().scale).toBe(1.5);
    expect(zoomField.value).toBe("150%");

    // Out of range is clamped, not rejected.
    zoomField.value = "5000%";
    zoomField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushFrames();
    expect(controller.getView().scale).toBe(8);

    // Typing inside the field must not reach the canvas shortcuts: "0"
    // would otherwise fire Fit Page mid-entry.
    const help = container.querySelector<HTMLElement>(".vc-shortcut-help");
    zoomField.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    expect(controller.getView().scale).toBe(8);

    expect(help?.hasAttribute("hidden")).toBe(true);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(help?.hasAttribute("hidden")).toBe(false);
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(help?.hasAttribute("hidden")).toBe(true);

    /*
     * Shortcuts have to survive focus landing on the canvas's own chrome.
     * The toolbar and the inspector live inside the viewport, so clicking
     * the help toggle put focus on a <button> — and the guard used to bail
     * out on any button, which left Escape and every tool key dead until
     * the user thought to click the empty canvas again.
     */
    const helpToggle = container.querySelector<HTMLButtonElement>(".vc-help-toggle");
    if (!helpToggle) throw new Error("Missing help toggle");
    helpToggle.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(help?.hasAttribute("hidden")).toBe(false);
    helpToggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(help?.hasAttribute("hidden")).toBe(true);

    // ...but the keys the button itself needs still belong to the button.
    helpToggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(help?.hasAttribute("hidden")).toBe(true);

    controller.dispose();
  });

  test("moves every group member together and emits one atomic group change", () => {
    const container = viewportContainer();
    const source = doc();
    source.groups = [{ id: "pair", label: "Pair", nodeIds: ["native", "screen"] }];
    const onGroupMove = vi.fn();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(source),
      editable: true,
      onGroupMove,
    });
    flushFrames();
    const group = container.querySelector<HTMLElement>('[data-group-id="pair"]');
    if (!group) throw new Error("Missing group");

    dispatchPointer(group, "pointerdown", 60, 60, "touch");
    dispatchPointer(group, "pointerup", 60, 60, "touch");
    controller.setTool("move");
    dispatchPointer(group, "pointerdown", 60, 60, "touch");
    dispatchPointer(group, "pointermove", 100, 84, "touch");
    dispatchPointer(group, "pointerup", 100, 84, "touch");
    flushFrames();

    expect(onGroupMove).toHaveBeenCalledOnce();
    const [, dx, dy] = onGroupMove.mock.calls[0] as [string, number, number];
    expect(dx).not.toBe(0);
    expect(dy).not.toBe(0);
    const positioned = layoutCanvas(source);
    for (const node of positioned.nodes) {
      const element = container.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`);
      expect(Number.parseFloat(element?.style.left ?? "NaN") - node.x).toBeCloseTo(dx);
      expect(Number.parseFloat(element?.style.top ?? "NaN") - node.y).toBeCloseTo(dy);
    }
    controller.dispose();
  });

  test("does not animate Fit when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const container = viewportContainer();
    const controller = mountViewport({ container, canvas: layoutCanvas(doc()) });
    flushFrames();
    controller.fitAll();
    flushFrames();
    expect(container).not.toHaveClass("is-camera-animating");
    controller.dispose();
  });
});
