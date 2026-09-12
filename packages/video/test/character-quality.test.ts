import assert from "node:assert/strict";
import { test } from "node:test";
import type { CharacterSceneProps } from "../src/character.js";
import {
  type CharacterQualityEvidence,
  canonicalCharacterQualityBytes,
  characterRenderDimensions,
  diagnoseCharacterQuality,
} from "../src/character-quality.js";

const scene = (endFrame: number) =>
  ({
    timebase: { numerator: 30, denominator: 1 },
    overlayOrder: ["title"],
    overlaysById: { title: { startFrame: 10, endFrame, text: "Readable offer" } },
    actionOrder: ["enter"],
    actionsById: { enter: { type: "enter", actorId: "hero", startFrame: 0, durationFrames: 12 } },
  }) as unknown as CharacterSceneProps;
const evidence = (
  actorBounds = { left: 120, top: 120, right: 880, bottom: 1680 },
): CharacterQualityEvidence => ({
  boundsBasis: "conservative_pack_aabb",
  samples: [
    {
      frame: 30,
      viewport: { width: 1080, height: 1920 },
      cameraMatrix: [1, 0, 0, 1, 0, 0],
      actorsById: { hero: { opacity: 1, bounds: actorBounds } },
      propsById: {},
    },
  ],
});

test("known bad scene returns actionable patches and patched evidence passes", () => {
  const bad = diagnoseCharacterQuality(
    scene(20),
    evidence({ left: -10, top: 100, right: 900, bottom: 1700 }),
  );
  assert.deepEqual(
    bad.map((item) => item.code),
    ["text_too_brief", "unsafe_actor_bounds"],
  );
  assert.deepEqual(bad[0]!.patch, {
    op: "replace",
    path: "/overlaysById/title/endFrame",
    value: 31,
  });
  assert.deepEqual(diagnoseCharacterQuality(scene(31), evidence()), []);
});

test("intentional entrance frames are distinguished from clipped held subjects", () => {
  const movingEvidence: CharacterQualityEvidence = {
    ...evidence({ left: -400, top: 100, right: 200, bottom: 1700 }),
    samples: [
      {
        ...evidence().samples[0]!,
        frame: 6,
        actorsById: {
          hero: { opacity: 1, bounds: { left: -400, top: 100, right: 200, bottom: 1700 } },
        },
      },
    ],
  };
  assert.equal(
    diagnoseCharacterQuality(scene(31), movingEvidence).some(
      (item) => item.code === "unsafe_actor_bounds",
    ),
    false,
  );
});

test("canonical evidence bytes are deterministic JSON, without claiming pixel determinism", () => {
  const first = canonicalCharacterQualityBytes(evidence());
  const second = canonicalCharacterQualityBytes(structuredClone(evidence()));
  assert.deepEqual(first, second);
  assert.equal(new TextDecoder().decode(first).includes("conservative_pack_aabb"), true);
});

test("render profiles preserve aspect using the requested short edge", () => {
  const vertical = { aspect: "9:16" as const, width: 1080 as const, height: 1920 as const };
  assert.deepEqual(characterRenderDimensions(vertical, "draft360"), { width: 360, height: 640 });
  assert.deepEqual(characterRenderDimensions(vertical, "draft540"), { width: 540, height: 960 });
  assert.deepEqual(characterRenderDimensions(vertical, "preview720"), { width: 720, height: 1280 });
  assert.deepEqual(characterRenderDimensions(vertical, "final1080"), { width: 1080, height: 1920 });
  assert.deepEqual(
    characterRenderDimensions({ aspect: "16:9", width: 1920, height: 1080 }, "draft540"),
    { width: 960, height: 540 },
  );
});
