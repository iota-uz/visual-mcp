import { describe, expect, it } from "vitest";
import {
  clampPrototypeHotspot,
  drawPrototypeHotspot,
  movePrototypeHotspot,
  resizePrototypeHotspot,
} from "./prototypeGeometry";

const viewport = { width: 320, height: 640 };

describe("prototype hotspot geometry", () => {
  it("draws in either direction and clamps to the source viewport", () => {
    expect(drawPrototypeHotspot({ x: 280, y: 620 }, { x: 100, y: 400 }, viewport)).toEqual({
      x: 100,
      y: 400,
      width: 180,
      height: 220,
    });
    expect(drawPrototypeHotspot({ x: -20, y: -10 }, { x: 400, y: 700 }, viewport)).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 640,
    });
  });

  it("keeps move, resize, and direct numeric edits inside the frame", () => {
    const hotspot = { x: 20, y: 30, width: 100, height: 50 };
    expect(movePrototypeHotspot(hotspot, 300, 630, viewport)).toEqual({
      x: 220,
      y: 590,
      width: 100,
      height: 50,
    });
    expect(resizePrototypeHotspot(hotspot, 400, 700, viewport)).toEqual({
      x: 20,
      y: 30,
      width: 300,
      height: 610,
    });
    expect(clampPrototypeHotspot({ x: -4, y: 700, width: 0, height: 20 }, viewport)).toEqual({
      x: 0,
      y: 620,
      width: 1,
      height: 20,
    });
  });
});
