import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CharacterSceneProps,
  ComponentSource,
  componentResources,
  componentTimingIssues,
} from "../src/registry.js";

function pilot() {
  return {
    background: "#061b36",
    seed: 42,
    actorOrder: ["farq", "customer"],
    actorsById: {
      farq: {
        character: "farq-mascot",
        x: 0.3,
        y: 0.65,
        scale: 1,
        facing: "right",
        initialEmotion: "neutral",
      },
      customer: {
        character: "customer",
        x: 0.72,
        y: 0.65,
        scale: 1,
        facing: "left",
        initialEmotion: "thinking",
      },
    },
    actionOrder: ["farqEnter", "customerLook", "farqTalk", "customerReact"],
    actionsById: {
      farqEnter: {
        type: "enter",
        actorId: "farq",
        startFrame: 0,
        durationFrames: 18,
        from: "left",
      },
      customerLook: {
        type: "look",
        actorId: "customer",
        startFrame: 18,
        durationFrames: 12,
        target: "farq",
      },
      farqTalk: {
        type: "talk",
        actorId: "farq",
        startFrame: 30,
        durationFrames: 30,
        emotion: "happy",
        visemes: [
          { frame: 0, shape: "rest" },
          { frame: 6, shape: "a" },
          { frame: 12, shape: "m" },
        ],
      },
      customerReact: {
        type: "react",
        actorId: "customer",
        startFrame: 60,
        durationFrames: 20,
        preset: "shocked",
      },
    },
    overlayOrder: ["price"],
    overlaysById: {
      price: {
        text: "129 000 so'm",
        x: 0.5,
        y: 0.2,
        startFrame: 60,
        endFrame: 110,
        style: "price-new",
      },
    },
    caption: "Farq finds a better price.",
  };
}

test("character-scene accepts a deterministic built-in actor pilot and appears in catalog", () => {
  const props = CharacterSceneProps.parse(pilot());
  assert.equal(props.actionsById.farqTalk?.type, "talk");
  assert.ok(
    componentResources.some(
      (resource) =>
        resource.resourceId === "video/component/character-scene" && resource.revisionId === "1",
    ),
  );
  assert.equal(
    ComponentSource.safeParse({
      kind: "component",
      component: { resourceId: "video/component/character-scene", revisionId: "1" },
      props,
    }).success,
    true,
  );
});

test("character-scene rejects unknown references, timing and overlapping owned channels", () => {
  const unknownActor = pilot();
  unknownActor.actionsById.customerLook.target = "missing";
  assert.equal(CharacterSceneProps.safeParse(unknownActor).success, false);

  const badViseme = pilot();
  badViseme.actionsById.farqTalk.visemes[1]!.frame = 30;
  assert.equal(CharacterSceneProps.safeParse(badViseme).success, false);

  const conflict = pilot();
  conflict.actionOrder = ["farqEnter", "blinkOne", "blinkTwo", "farqTalk", "customerReact"];
  conflict.actionsById.blinkOne = {
    type: "blink",
    actorId: "farq",
    startFrame: 18,
    durationFrames: 8,
  };
  conflict.actionsById.blinkTwo = {
    type: "blink",
    actorId: "farq",
    startFrame: 22,
    durationFrames: 8,
  };
  assert.equal(CharacterSceneProps.safeParse(conflict).success, false);
});

test("character-scene enforces exact order and rejects non-serializable extras", () => {
  const missingOverlay = pilot();
  missingOverlay.overlayOrder = [];
  assert.equal(CharacterSceneProps.safeParse(missingOverlay).success, false);

  const extra = { ...pilot(), executable: "fetch('https://example.com')" };
  assert.equal(CharacterSceneProps.safeParse(extra).success, false);
});

test("character-scene clip timing checks actions and overlays against its enclosing clip", () => {
  const props = CharacterSceneProps.parse(pilot());
  const source = ComponentSource.parse({
    kind: "component",
    component: { resourceId: "video/component/character-scene", revisionId: "1" },
    props,
  });
  assert.deepEqual(componentTimingIssues(source, [], 120), []);
  assert.deepEqual(
    componentTimingIssues(source, [], 75).map((issue) => issue.path),
    [
      ["source", "props", "actionsById", "customerReact"],
      ["source", "props", "overlaysById", "price"],
    ],
  );
});
