import { type CanvasDoc, layoutCanvas, mountViewport } from "@visual-canvas/canvas";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/*
 * Touch gestures against the real viewport. Its own file rather than more
 * cases in realtimeCanvas.test.ts: everything here needs a coarse
 * `matchMedia` and fake timers for the whole module, and the pinned tests
 * next door assume neither.
 */

const anchors = [
  { id: "left", side: "left" as const, offset: 0.5 },
  { id: "right", side: "right" as const, offset: 0.5 },
];

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Touch",
    world: { width: 1_000, height: 600 },
    lanes: [],
    stages: [],
    labels: [],
    groups: [],
    edges: [],
    nodes: [
      {
        id: "a",
        kind: "native",
        shape: "note",
        rect: { x: 100, y: 100, w: 140, h: 90 },
        caption: { title: "A" },
        anchors,
      },
      {
        id: "b",
        kind: "native",
        shape: "note",
        rect: { x: 400, y: 100, w: 140, h: 90 },
        caption: { title: "B" },
        anchors,
      },
    ],
  };
}

describe("touch gestures", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&") });
    stubPointerMedia(true);
  });

  afterEach(() => {
    frames.clear();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubPointerMedia(coarse: boolean) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: coarse && query.includes("pointer: coarse"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  function flushFrames() {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(performance.now());
    }
  }

  /*
   * The helper next door hardcodes `pointerId: 1`, which is why the pinch
   * path had never been exercised: a second simultaneous finger could not
   * be expressed at all.
   */
  function pointer(
    target: Element,
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    x: number,
    y: number,
    pointerId = 1,
    pointerType: "mouse" | "touch" = "touch",
  ) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      pointerType: { value: pointerType },
    });
    target.dispatchEvent(event);
    return event;
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

  function mount(options: Parameters<typeof mountViewport>[0] extends never ? never : object = {}) {
    const container = viewportContainer();
    const controller = mountViewport({
      container,
      canvas: layoutCanvas(doc()),
      editable: true,
      ...options,
    });
    flushFrames();
    return { container, controller };
  }

  function useMoveTool(container: HTMLElement) {
    container.querySelector<HTMLElement>('[data-tool="move"]')?.click();
  }

  test("a coarse device is announced on the element the theme reads, and can be overridden", () => {
    const { container, controller } = mount();
    expect(container.dataset.pointer).toBe("coarse");
    expect(controller.getPointerMode()).toBe("coarse");

    // An iPad with a trackpad still reports `(pointer: coarse)`; this is the
    // way out of that for an app that knows better.
    controller.setPointerMode("fine");
    expect(container.dataset.pointer).toBe("fine");
    controller.dispose();
  });

  test("a finger on a fine-pointer device switches the affordances over", () => {
    stubPointerMedia(false);
    const changes: string[] = [];
    const { container, controller } = mount({ onPointerModeChange: (m: string) => changes.push(m) });
    expect(container.dataset.pointer).toBe("fine");

    pointer(container, "pointerdown", 20, 20, 1, "touch");
    expect(container.dataset.pointer).toBe("coarse");
    expect(changes).toEqual(["fine", "coarse"]);
    controller.dispose();
  });

  test("two fingers spreading zoom the camera, and two fingers moving pan it", () => {
    const { container, controller } = mount();
    const before = controller.getView();

    pointer(container, "pointerdown", 400, 400, 1);
    pointer(container, "pointerdown", 600, 400, 2);
    // Past the dead-zone, then a real spread.
    pointer(container, "pointermove", 300, 400, 1);
    pointer(container, "pointermove", 700, 400, 2);
    expect(controller.getView().scale).toBeGreaterThan(before.scale);

    pointer(container, "pointerup", 300, 400, 1);
    pointer(container, "pointerup", 700, 400, 2);

    /*
     * Same span, both fingers translated: the camera moves and the zoom
     * does not. In the Move tool this is the only way to pan at all.
     * Stepped and alternating, because that is how a browser delivers it —
     * one pointermove per finger per frame, never both at once.
     */
    const panStart = controller.getView();
    pointer(container, "pointerdown", 400, 400, 1);
    pointer(container, "pointerdown", 600, 400, 2);
    for (let step = 1; step <= 10; step += 1) {
      pointer(container, "pointermove", 400 + step * 6, 400 + step * 3, 1);
      pointer(container, "pointermove", 600 + step * 6, 400 + step * 3, 2);
    }
    const panned = controller.getView();
    expect(panned.scale).toBeCloseTo(panStart.scale, 10);
    expect(panned.x - panStart.x).toBeCloseTo(60, 6);
    expect(panned.y - panStart.y).toBeCloseTo(30, 6);
    controller.dispose();
  });

  test("two fingers resting on the glass do not shake the camera", () => {
    const { container, controller } = mount();
    pointer(container, "pointerdown", 400, 400, 1);
    pointer(container, "pointerdown", 600, 400, 2);
    const resting = controller.getView().scale;
    pointer(container, "pointermove", 398, 401, 1);
    pointer(container, "pointermove", 603, 399, 2);
    expect(controller.getView().scale).toBe(resting);
    controller.dispose();
  });

  test("a long press adds a node to the selection, the way shift-click does", () => {
    const { container, controller } = mount();
    useMoveTool(container);
    const a = container.querySelector<HTMLElement>('[data-node-id="a"]');
    const b = container.querySelector<HTMLElement>('[data-node-id="b"]');
    if (!a || !b) throw new Error("missing nodes");

    pointer(a, "pointerdown", 150, 150);
    pointer(a, "pointerup", 150, 150);
    expect(controller.getSelection()).toEqual(["a"]);

    pointer(b, "pointerdown", 450, 150);
    expect(b.classList.contains("is-press-pending")).toBe(true);
    vi.advanceTimersByTime(600);
    expect(b.classList.contains("is-press-pending")).toBe(false);
    expect(controller.getSelection().sort()).toEqual(["a", "b"]);

    // And takes it back out again.
    pointer(b, "pointerup", 450, 150);
    pointer(b, "pointerdown", 450, 150);
    vi.advanceTimersByTime(600);
    expect(controller.getSelection()).toEqual(["a"]);
    controller.dispose();
  });

  test("a press that turns into a drag is a drag, not a selection toggle", () => {
    const { container, controller } = mount();
    useMoveTool(container);
    const a = container.querySelector<HTMLElement>('[data-node-id="a"]');
    if (!a) throw new Error("missing node");
    pointer(a, "pointerdown", 150, 150);
    pointer(container, "pointermove", 150, 190);
    vi.advanceTimersByTime(600);
    expect(a.classList.contains("is-press-pending")).toBe(false);
    expect(controller.getSelection()).toEqual([]);
    controller.dispose();
  });

  test("a second finger cancels a pending press rather than toggling under the pinch", () => {
    const { container, controller } = mount();
    useMoveTool(container);
    const a = container.querySelector<HTMLElement>('[data-node-id="a"]');
    if (!a) throw new Error("missing node");
    pointer(a, "pointerdown", 150, 150, 1);
    pointer(container, "pointerdown", 600, 400, 2);
    vi.advanceTimersByTime(600);
    expect(controller.getSelection()).toEqual([]);
    controller.dispose();
  });

  test("the system context menu is suppressed for a finger and kept for a mouse", () => {
    const { container, controller } = mount();
    pointer(container, "pointerdown", 300, 300, 1, "touch");
    const touched = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.dispatchEvent(touched);
    expect(touched.defaultPrevented).toBe(true);

    pointer(container, "pointerdown", 300, 300, 1, "mouse");
    const clicked = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.dispatchEvent(clicked);
    expect(clicked.defaultPrevented).toBe(false);
    controller.dispose();
  });

  test("a single node can be deleted without a keyboard", () => {
    const onDeleteNodes = vi.fn();
    const { container, controller } = mount({ onDeleteNodes });
    useMoveTool(container);
    const a = container.querySelector<HTMLElement>('[data-node-id="a"]');
    if (!a) throw new Error("missing node");
    pointer(a, "pointerdown", 150, 150);
    pointer(a, "pointerup", 150, 150);

    const actions = container.querySelector<HTMLElement>(".vc-inspector-actions");
    expect(actions?.hidden).toBe(false);
    container.querySelector<HTMLElement>(".vc-inspector-delete")?.click();
    expect(onDeleteNodes).toHaveBeenCalledWith(["a"]);
    controller.dispose();
  });

  test("a read-only viewport offers no delete", () => {
    const { container, controller } = mount({ editable: false });
    expect(container.querySelector<HTMLElement>(".vc-inspector-actions")?.hidden).toBe(true);
    controller.dispose();
  });

  test("a tap on the minimap does not teleport the camera; a drag scrubs it", () => {
    const { container, controller } = mount();
    const minimap = container.querySelector<HTMLElement>(".vc-minimap");
    if (!minimap) throw new Error("missing minimap");
    minimap.getBoundingClientRect = () =>
      ({
        x: 980,
        y: 690,
        left: 980,
        top: 690,
        right: 1_160,
        bottom: 764,
        width: 180,
        height: 74,
        toJSON() {},
      }) as DOMRect;

    const before = controller.getView();
    pointer(minimap, "pointerdown", 1_000, 700);
    expect(controller.getView()).toEqual(before);

    pointer(minimap, "pointermove", 1_100, 740);
    expect(controller.getView()).not.toEqual(before);
    pointer(minimap, "pointerup", 1_100, 740);
    controller.dispose();
  });

  test("losing one finger to the system leaves the other one driving the camera", () => {
    const { container, controller } = mount();
    pointer(container, "pointerdown", 400, 400, 1);
    pointer(container, "pointerdown", 600, 400, 2);
    const before = controller.getView();

    // iOS claims a single pointer for an edge swipe. Clearing every pointer
    // here used to strand the finger still on the glass.
    pointer(container, "pointercancel", 600, 400, 2);
    pointer(container, "pointermove", 460, 400, 1);
    expect(controller.getView().x - before.x).toBeCloseTo(60, 6);
    controller.dispose();
  });
});
