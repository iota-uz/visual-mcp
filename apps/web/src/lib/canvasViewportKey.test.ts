import { describe, expect, it } from "vitest";
import type { CanvasDoc } from "@visual-canvas/canvas";
import { canvasViewportStructureKey } from "./canvasViewportKey";

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Test",
    world: { width: 1000, height: 700 },
    lanes: [],
    stages: [],
    labels: [],
    nodes: [
      {
        id: "node",
        kind: "native",
        rect: { x: 10, y: 20, w: 200, h: 100 },
        caption: { title: "Node" },
        anchors: [],
        shape: "actor",
      },
    ],
    edges: [],
  };
}

describe("canvasViewportStructureKey", () => {
  it("does not remount for a persisted geometry echo", () => {
    const before = doc();
    const after = doc();
    const node = after.nodes[0];
    if (!node) throw new Error("fixture node missing");
    node.rect = { x: 80, y: 90, w: 260, h: 140 };
    expect(canvasViewportStructureKey(after)).toBe(canvasViewportStructureKey(before));
  });

  it("does remount for a structural change", () => {
    const before = doc();
    const after = doc();
    const node = after.nodes[0];
    if (!node) throw new Error("fixture node missing");
    node.caption.title = "Changed";
    expect(canvasViewportStructureKey(after)).not.toBe(canvasViewportStructureKey(before));
  });
});
