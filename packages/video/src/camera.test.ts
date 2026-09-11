import { describe, expect, test } from "vitest";
import { cameraMovementInstruction, normalizeCameraMovement, normalizeFraming } from "./camera.js";

describe("camera vocabulary", () => {
  test("normalizes historical framing labels", () => {
    expect(normalizeFraming("Closeup")).toBe("close-up");
    expect(normalizeFraming("Extreme wide")).toBe("extreme-wide");
    expect(normalizeFraming("Imported")).toBe("");
  });

  test("normalizes provider and UI movement labels", () => {
    expect(normalizeCameraMovement("Push in")).toBe("push-in");
    expect(normalizeCameraMovement("pull")).toBe("pull-out");
    expect(normalizeCameraMovement("none")).toBe("static");
  });

  test("turns canonical movement into a provider-safe instruction", () => {
    expect(cameraMovementInstruction("push-in")).toContain("push-in");
  });
});
