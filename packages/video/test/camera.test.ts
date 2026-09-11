import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cameraMovementInstruction,
  normalizeCameraMovement,
  normalizeFraming,
} from "../src/camera.js";

describe("camera vocabulary", () => {
  test("normalizes historical framing labels", () => {
    assert.equal(normalizeFraming("Closeup"), "close-up");
    assert.equal(normalizeFraming("Extreme wide"), "extreme-wide");
    assert.equal(normalizeFraming("Imported"), "");
  });

  test("normalizes provider and UI movement labels", () => {
    assert.equal(normalizeCameraMovement("Push in"), "push-in");
    assert.equal(normalizeCameraMovement("pull"), "pull-out");
    assert.equal(normalizeCameraMovement("none"), "static");
  });

  test("turns canonical movement into a provider-safe instruction", () => {
    assert.match(cameraMovementInstruction("push-in"), /push-in/);
  });
});
