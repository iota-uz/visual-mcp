import assert from "node:assert/strict";
import test from "node:test";
import { placeBesideRect, placeExitOnNode } from "../src/chrome-placement.js";

test("places the card to the right of the node when there is room", () => {
  const placed = placeBesideRect({
    anchor: { x: 100, y: 80, width: 200, height: 400 },
    cardWidth: 280,
    cardHeight: 120,
    viewportWidth: 1200,
    viewportHeight: 800,
  });
  assert.equal(placed.x, 312);
  assert.equal(placed.y, 80);
});

test("flips to the left when the right side does not fit", () => {
  const placed = placeBesideRect({
    anchor: { x: 900, y: 80, width: 280, height: 400 },
    cardWidth: 280,
    cardHeight: 120,
    viewportWidth: 1200,
    viewportHeight: 800,
  });
  assert.equal(placed.x, 900 - 12 - 280);
  assert.equal(placed.y, 80);
});

test("drops below the node when both sides are blocked", () => {
  const placed = placeBesideRect({
    anchor: { x: 20, y: 80, width: 1160, height: 200 },
    cardWidth: 280,
    cardHeight: 80,
    viewportWidth: 1200,
    viewportHeight: 800,
  });
  assert.equal(placed.y, 80 + 200 + 12);
});

test("avoids a reserved toolbar band by flipping above the node", () => {
  const placed = placeBesideRect({
    anchor: { x: 20, y: 650, width: 1160, height: 80 },
    cardWidth: 280,
    cardHeight: 80,
    viewportWidth: 1200,
    viewportHeight: 800,
    avoid: [{ x: 0, y: 740, width: 1200, height: 48 }],
  });
  assert.equal(placed.y, 650 - 12 - 80);
});

test("Exit sits above the node when there is room, otherwise inset", () => {
  const above = placeExitOnNode({
    anchor: { x: 100, y: 80, width: 200, height: 400 },
    cardWidth: 72,
    cardHeight: 30,
  });
  assert.equal(above.x, 100 + 200 - 72);
  assert.equal(above.y, 80 - 30 - 8);

  const inset = placeExitOnNode({
    anchor: { x: 100, y: 10, width: 200, height: 400 },
    cardWidth: 72,
    cardHeight: 30,
  });
  assert.equal(inset.y, 18);
});
