import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterSceneProps } from "@visual-canvas/video/registry";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CharacterScene, evaluateCharacterActors } from "../src/video/character-scene.js";

function fixture() {
  return CharacterSceneProps.parse({
    background: "#170f0a",
    seed: 18273,
    actorOrder: ["customer", "mascot"],
    actorsById: {
      customer: {
        character: "customer",
        x: 0.25,
        y: 0.7,
        scale: 1.1,
        facing: "right",
        initialEmotion: "neutral",
      },
      mascot: {
        character: "farq-mascot",
        x: 0.7,
        y: 0.64,
        scale: 1.15,
        facing: "left",
        initialEmotion: "happy",
      },
    },
    actionOrder: ["enter", "look", "blink", "point", "shock"],
    actionsById: {
      enter: { type: "enter", actorId: "mascot", startFrame: 0, durationFrames: 45, from: "right" },
      look: {
        type: "look",
        actorId: "customer",
        startFrame: 50,
        durationFrames: 40,
        target: "mascot",
      },
      blink: { type: "blink", actorId: "customer", startFrame: 60, durationFrames: 8 },
      point: {
        type: "gesture",
        actorId: "mascot",
        startFrame: 95,
        durationFrames: 45,
        preset: "point",
      },
      shock: {
        type: "react",
        actorId: "customer",
        startFrame: 145,
        durationFrames: 45,
        preset: "shocked",
      },
    },
    overlayOrder: ["price"],
    overlaysById: {
      price: {
        text: "999 000 сум",
        x: 0.5,
        y: 0.22,
        startFrame: 100,
        endFrame: 200,
        style: "price-new",
      },
    },
    caption: "Farq character motion pilot",
  });
}

test("character state is deterministic and seeded idle is reproducible", () => {
  const props = fixture();
  const first = evaluateCharacterActors(props, 210);
  assert.deepEqual(first, evaluateCharacterActors(props, 210));
  assert.notDeepEqual(first, evaluateCharacterActors({ ...props, seed: props.seed + 1 }, 210));
  for (const state of Object.values(first))
    for (const value of [
      state.x,
      state.y,
      state.scaleX,
      state.scaleY,
      state.rotation,
      state.gazeX,
      state.gazeY,
    ])
      assert.equal(Number.isFinite(value), true);
});

test("semantic gaze, blink, gesture and reaction evaluate into distinct rig states", () => {
  const props = fixture();
  const gaze = evaluateCharacterActors(props, 55);
  assert.ok(gaze.customer!.gazeX > 0);

  const blink = evaluateCharacterActors(props, 64);
  assert.equal(blink.customer!.eyeOpen, 0.05);

  const gesture = evaluateCharacterActors(props, 110);
  assert.equal(gesture.mascot!.gesture, "point");

  const beforeShock = evaluateCharacterActors(props, 144).customer!;
  const shock = evaluateCharacterActors(props, 167).customer!;
  assert.equal(shock.emotion, "shocked");
  assert.notEqual(shock.rotation, beforeShock.rotation);
  assert.notEqual(shock.scaleX, beforeShock.scaleX);
});

test("character scene renders repository-owned SVG rigs and timed overlays", () => {
  const props = fixture();
  const before = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 90 }));
  const during = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.match(during, /<svg/);
  assert.match(during, /999 000 сум/);
  assert.doesNotMatch(before, /999 000 сум/);
  assert.doesNotMatch(during, /https?:\/\//);
});
