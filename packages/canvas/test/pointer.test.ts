import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_PINCH_SPAN_PX,
  PINCH_ACTIVATE_PX,
  pinchZoom,
  resolvePointerMode,
  shouldArmLongPress,
} from "../src/viewport.js";

test("an explicit pointer mode beats what the device reports", () => {
  assert.equal(
    resolvePointerMode({ mode: "fine", mediaCoarse: true, lastPointerType: "touch" }),
    "fine",
  );
  assert.equal(
    resolvePointerMode({ mode: "coarse", mediaCoarse: false, lastPointerType: "mouse" }),
    "coarse",
  );
});

test("auto follows the device and the last pointer, and a pen counts as fine", () => {
  // A touchscreen laptop reports a fine primary pointer until a finger lands.
  assert.equal(
    resolvePointerMode({ mode: "auto", mediaCoarse: false, lastPointerType: null }),
    "fine",
  );
  assert.equal(
    resolvePointerMode({ mode: "auto", mediaCoarse: false, lastPointerType: "touch" }),
    "coarse",
  );
  assert.equal(
    resolvePointerMode({ mode: "auto", mediaCoarse: false, lastPointerType: "pen" }),
    "fine",
  );
  /*
   * An iPad with a Magic Keyboard still reports `(pointer: coarse)`, so a
   * trackpad user gets 44px targets. Deliberate — the device is touch-first,
   * and setPointerMode("fine") is the way out.
   */
  assert.equal(
    resolvePointerMode({ mode: "auto", mediaCoarse: true, lastPointerType: "mouse" }),
    "coarse",
  );
});

test("a pinch does not scale until it has travelled, and then it starts where it is", () => {
  const start = { startDistance: 200, startScale: 1, engaged: false };
  // Two fingers resting on glass wobble a few pixels a frame.
  const resting = pinchZoom(start, 204);
  assert.equal(resting.engaged, false);
  assert.equal(resting.scale, 1);
  assert.equal(resting.startDistance, 200);

  // On the frame it crosses, the span is rebased: engaging must not itself
  // move the camera by the width of the dead-zone.
  const crossing = pinchZoom(start, 200 + PINCH_ACTIVATE_PX + 1);
  assert.equal(crossing.engaged, true);
  assert.equal(crossing.scale, 1);
  assert.equal(crossing.startDistance, 211);

  const engaged = { startDistance: 211, startScale: 1, engaged: true };
  assert.ok(pinchZoom(engaged, 422).scale > 1.99);
  // Once engaged it stays engaged: a slow pinch must not stutter back into
  // the dead-zone every time the fingers pause.
  const back = pinchZoom(engaged, 213);
  assert.equal(back.engaged, true);
  assert.ok(Math.abs(back.scale - 213 / 211) < 1e-9);
});

test("two fingers touching are a grab, not a pinch", () => {
  const tiny = { startDistance: MIN_PINCH_SPAN_PX - 1, startScale: 1, engaged: false };
  // The old floor was Math.max(1, span), where a 1px start meant any spread
  // at all multiplied the scale into the clamp.
  assert.equal(pinchZoom(tiny, 400).engaged, false);
  assert.equal(pinchZoom(tiny, 400).scale, 1);
});

test("a pinch cannot escape the zoom clamp", () => {
  assert.equal(pinchZoom({ startDistance: 100, startScale: 4, engaged: true }, 800).scale, 8);
  assert.equal(
    pinchZoom({ startDistance: 800, startScale: 0.01, engaged: true }, 1).scale,
    0.005,
  );
});

test("long-press arms only where it is the finger's only way to add to a selection", () => {
  const base = {
    coarse: true,
    pointerCount: 1,
    nodeId: "a",
    tool: "move" as const,
    doubleTapPending: false,
    selectableTarget: false,
  };
  assert.equal(shouldArmLongPress(base), true);
  // Shift-click adds in the View tool too, so long-press has to match it.
  assert.equal(shouldArmLongPress({ ...base, tool: "view" }), true);
  assert.equal(shouldArmLongPress({ ...base, tool: "comment" }), false);
  assert.equal(shouldArmLongPress({ ...base, coarse: false }), false);
  assert.equal(shouldArmLongPress({ ...base, nodeId: null }), false);
  // A second finger is a pinch starting, not a press being held.
  assert.equal(shouldArmLongPress({ ...base, pointerCount: 2 }), false);
  // The press already matched the double-tap window: it opens the screen,
  // and toggling the selection underneath it as well is two answers to one
  // gesture.
  assert.equal(shouldArmLongPress({ ...base, doubleTapPending: true }), false);
  // Node body text keeps its own selection and its own iOS callout.
  assert.equal(shouldArmLongPress({ ...base, selectableTarget: true }), false);
});
