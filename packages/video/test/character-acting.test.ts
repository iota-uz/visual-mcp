import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterSceneProps } from "../src/character.js";
import { CharacterActingPlan, compileCharacterActing } from "../src/character-acting.js";
import { builtInCharacterPacks } from "../src/character-packs.js";

test("compiles gaze-leading semantic beats deterministically at the authored timebase", () => {
  const plan = {
    timebase: { numerator: 30, denominator: 1 },
    beats: [
      {
        id: "offer",
        type: "show_prop",
        actorId: "mascot",
        startFrame: 30,
        durationFrames: 60,
        propId: "phone",
        target: { kind: "camera" },
        emotion: "happy",
      },
    ],
  };
  const first = compileCharacterActing(plan);
  assert.deepEqual(first, compileCharacterActing(structuredClone(plan)));
  assert.deepEqual(first.actionOrder, ["offer-gaze", "offer-prop", "offer-face"]);
  assert.equal(first.actionsById["offer-gaze"]?.startFrame, 27);
  assert.equal(first.actionsById["offer-prop"]?.acting?.anticipationFrames, 5);
  assert.equal(first.actionsById["offer-prop"]?.acting?.accentFrame, 9);
  assert.equal(first.actionsById["offer-prop"]?.acting?.holdFrames, 7);
  assert.equal(first.actionsById["offer-prop"]?.acting?.settleFrames, 6);
  assert.equal(first.actionsById["offer-prop"]?.acting?.stillness, 0.35);
});

test("supports explicit phase timing and validates contact release timing", () => {
  const parsed = CharacterActingPlan.parse({
    timebase: { numerator: 30000, denominator: 1001 },
    beats: [
      {
        id: "release",
        type: "show_prop",
        actorId: "mascot",
        startFrame: 12,
        durationFrames: 24,
        propId: "phone",
        interaction: "release",
        releaseFrame: 18,
        timing: {
          anticipationFrames: 2,
          accentFrame: 4,
          holdFrames: 8,
          settleFrames: 5,
          gazeLeadFrames: 3,
          secondaryDelayFrames: 2,
        },
        stillness: 0.8,
      },
    ],
  });
  const action = compileCharacterActing(parsed).actionsById["release-prop"];
  assert.equal(action?.type, "showProp");
  if (action?.type === "showProp") {
    assert.equal(action.interaction, "release");
    assert.equal(action.releaseFrame, 18);
  }
  const invalid = structuredClone(parsed) as unknown as { beats: Array<Record<string, unknown>> };
  invalid.beats[0]!.releaseFrame = 24;
  assert.equal(CharacterActingPlan.safeParse(invalid).success, false);
});

test("rejects duplicate IDs and camera pointing", () => {
  const base = {
    id: "beat",
    type: "point",
    actorId: "mascot",
    startFrame: 0,
    durationFrames: 10,
    target: { kind: "camera" },
  };
  assert.equal(
    CharacterActingPlan.safeParse({ timebase: { numerator: 30, denominator: 1 }, beats: [base] })
      .success,
    false,
  );
  assert.equal(
    CharacterActingPlan.safeParse({
      timebase: { numerator: 30, denominator: 1 },
      beats: [
        { ...base, type: "react", emotion: "happy", target: undefined },
        { ...base, type: "react", emotion: "thinking", target: undefined },
      ],
    }).success,
    false,
  );
});

test("compiled actions integrate into a complete strict character scene", () => {
  const compiled = compileCharacterActing({
    timebase: { numerator: 30, denominator: 1 },
    beats: [
      {
        id: "attention",
        type: "point",
        actorId: "mascot",
        startFrame: 12,
        durationFrames: 36,
        target: { kind: "point", x: 0.8, y: 0.3 },
      },
    ],
  });
  const scene = CharacterSceneProps.parse({
    stage: { aspect: "9:16", width: 1080, height: 1920 },
    timebase: compiled.timebase,
    seed: 7,
    staging: { layout: "single-product", focalActorId: "mascot" },
    camera: { movement: "locked", startFrame: 0, durationFrames: 60 },
    environment: {
      background: "#101820",
      horizonY: 0.6,
      ground: "#1f2933",
      accent: "#ffb52e",
      layers: [],
    },
    characterPacksById: { "farq-mascot": builtInCharacterPacks["farq-mascot"] },
    actorOrder: ["mascot"],
    actorsById: {
      mascot: {
        characterPackId: "farq-mascot",
        x: 0.5,
        y: 0.65,
        scale: 1,
        facing: "right",
        initialEmotion: "neutral",
      },
    },
    propOrder: [],
    propsById: {},
    actionOrder: compiled.actionOrder,
    actionsById: compiled.actionsById,
    overlayOrder: [],
    overlaysById: {},
  });
  assert.deepEqual(scene.actionOrder, ["attention-gaze", "attention-point"]);
});
