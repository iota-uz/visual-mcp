import type { CanvasNode } from "@visual-canvas/canvas";
import { describe, expect, it } from "vitest";
import { presentHotspotBox } from "./presentGeometry";

describe("presentHotspotBox", () => {
  it("maps native hotspots through the same centered fit transform", () => {
    const node = {
      id: "screen",
      kind: "native",
      shape: "note",
      rect: { x: 100, y: 100, w: 400, h: 200 },
      caption: { title: "Screen" },
      anchors: [],
    } satisfies CanvasNode;
    expect(
      presentHotspotBox(
        node,
        { x: 100, y: 50, width: 200, height: 100 },
        { width: 1000, height: 600 },
      ),
    ).toEqual({ left: 400, top: 250, width: 200, height: 100 });
  });

  it("places phone hotspots inside the content viewport below bezel and status chrome", () => {
    const node = {
      id: "phone",
      kind: "iframe",
      rect: { x: 0, y: 0, w: 310, h: 755 },
      caption: { title: "Phone" },
      anchors: [],
      source: { entrypoint: "/src/screens/phone.html" },
      viewport: { width: 284, height: 642 },
      frame: { kind: "phone", time: "09:42" },
      sandbox: ["allow-scripts"],
      permissions: [],
      activation: "double-click",
    } satisfies CanvasNode;
    const box = presentHotspotBox(
      node,
      { x: 0, y: 0, width: 284, height: 48 },
      { width: 1000, height: 900 },
    );
    expect(box.left).toBeGreaterThan(300);
    expect(box.top).toBeGreaterThan(100);
    expect(box.width).toBeGreaterThan(260);
    expect(box.height).toBeGreaterThan(40);
  });
});
