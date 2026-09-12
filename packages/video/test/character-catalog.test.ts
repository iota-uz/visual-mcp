import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterSceneProps } from "../src/character.js";
import {
  characterBackgroundCatalog,
  characterPropCatalog,
  createCharacterBackground,
  createCharacterProp,
} from "../src/character-catalog.js";
import { builtInCharacterPacks } from "../src/character-packs.js";

test("catalog provides differentiated reusable packs, backgrounds and props", () => {
  assert.equal(Object.keys(characterBackgroundCatalog).length, 6);
  assert.equal(Object.keys(characterPropCatalog).length, 13);
  const customer = builtInCharacterPacks.customer!;
  const energetic = builtInCharacterPacks["customer-energetic"]!;
  assert.notDeepEqual(energetic.rig, customer.rig);
  assert.notDeepEqual(energetic.layers, customer.layers);
  assert.notEqual(energetic.style.limbColor, customer.style.limbColor);
  assert.equal(energetic.capabilities.gestures.length, 22);
  assert.equal(energetic.capabilities.emotions.length, 14);
  assert.equal(
    new Set(Object.values(characterPropCatalog).map((item) => JSON.stringify(item.shapes))).size,
    13,
  );
});

test("catalog factories return isolated authoring data", () => {
  const first = createCharacterBackground("midnight-tech");
  const second = createCharacterBackground("midnight-tech");
  first.layers[0]!.x = 0;
  assert.notEqual(first.layers[0]!.x, second.layers[0]!.x);
  const card = createCharacterProp("card");
  card.shapes[0]!.fill = "#000000";
  assert.notEqual(card.shapes[0]!.fill, createCharacterProp("card").shapes[0]!.fill);
});

test("every background composes schema-valid scenes at every supported stage geometry", () => {
  const stages = [
    { aspect: "9:16" as const, width: 1080 as const, height: 1920 as const },
    { aspect: "16:9" as const, width: 1920 as const, height: 1080 as const },
    { aspect: "1:1" as const, width: 1080 as const, height: 1080 as const },
  ];
  for (const id of Object.keys(
    characterBackgroundCatalog,
  ) as (keyof typeof characterBackgroundCatalog)[])
    for (const stage of stages) {
      const parsed = CharacterSceneProps.safeParse({
        stage,
        timebase: { numerator: 30, denominator: 1 },
        seed: 1,
        staging: { layout: "two-shot", focalActorId: "customer" },
        camera: { movement: "locked", startFrame: 0, durationFrames: 90 },
        cameraSequence: [],
        effects: [],
        environment: createCharacterBackground(id),
        characterPacksById: { customer: builtInCharacterPacks.customer },
        actorOrder: ["customer"],
        actorsById: {
          customer: {
            characterPackId: "customer",
            x: 0.5,
            y: 0.65,
            scale: 1,
            facing: "right",
            initialEmotion: "neutral",
          },
        },
        propOrder: [],
        propsById: {},
        actionOrder: [],
        actionsById: {},
        overlayOrder: [],
        overlaysById: {},
      });
      assert.equal(parsed.success, true, `${id} must validate at ${stage.aspect}`);
    }
});
