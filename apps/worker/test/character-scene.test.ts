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
    actionOrder: ["enter", "look", "blink", "phone", "point", "shock", "think", "talk"],
    actionsById: {
      enter: {
        type: "enter",
        actorId: "mascot",
        startFrame: 10,
        durationFrames: 45,
        from: "right",
      },
      look: {
        type: "look",
        actorId: "customer",
        startFrame: 50,
        durationFrames: 40,
        target: "mascot",
      },
      blink: { type: "blink", actorId: "customer", startFrame: 60, durationFrames: 8 },
      phone: {
        type: "gesture",
        actorId: "mascot",
        startFrame: 70,
        durationFrames: 20,
        preset: "show-phone",
      },
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
      think: {
        type: "react",
        actorId: "customer",
        startFrame: 200,
        durationFrames: 30,
        preset: "thinking",
      },
      talk: {
        type: "talk",
        actorId: "mascot",
        startFrame: 240,
        durationFrames: 30,
        emotion: "happy",
        visemes: [
          { frame: 0, shape: "m" },
          { frame: 4, shape: "a" },
          { frame: 12, shape: "e" },
          { frame: 22, shape: "m" },
        ],
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
      state.opacity,
      state.scaleX,
      state.scaleY,
      state.rotation,
      state.gazeX,
      state.gazeY,
    ])
      assert.equal(Number.isFinite(value), true);
});

test("enter stays hidden before its start and reaches rest without a reset pop", () => {
  const props = fixture();
  const before = evaluateCharacterActors(props, 9).mascot!;
  const start = evaluateCharacterActors(props, 10).mascot!;
  const finalEnterFrame = evaluateCharacterActors(props, 54).mascot!;
  const settled = evaluateCharacterActors(props, 55).mascot!;
  assert.equal(before.opacity, 0);
  assert.ok(before.x > 1);
  assert.equal(start.opacity, 0);
  assert.equal(settled.opacity, 1);
  assert.ok(Math.abs(finalEnterFrame.x - settled.x) < 0.001);
  assert.ok(Math.abs(finalEnterFrame.y - settled.y) < 0.01);
});

test("semantic gaze, blink, gesture and reaction evaluate into distinct rig states", () => {
  const props = fixture();
  const gaze = evaluateCharacterActors(props, 55);
  assert.ok(gaze.customer!.gazeX > 0);

  const blink = evaluateCharacterActors(props, 64);
  assert.equal(blink.customer!.eyeOpen, 0.05);

  const gesture = evaluateCharacterActors(props, 110);
  assert.equal(gesture.mascot!.gesture, "point");
  assert.equal(gesture.mascot!.gazeX, 0);
  assert.ok(gesture.mascot!.gazeY > 0.5);

  const beforeShock = evaluateCharacterActors(props, 144).customer!;
  const shock = evaluateCharacterActors(props, 167).customer!;
  assert.equal(shock.emotion, "shocked");
  assert.notEqual(shock.rotation, beforeShock.rotation);
  assert.notEqual(shock.scaleX, beforeShock.scaleX);
  assert.ok(shock.y > beforeShock.y);

  const thinking = evaluateCharacterActors(props, 215).customer!;
  assert.equal(thinking.emotion, "thinking");
  assert.ok(thinking.gazeY < -0.5);
  assert.ok(Math.abs(thinking.gazeX) > 0.5);

  const closed = evaluateCharacterActors(props, 240).mascot!;
  const open = evaluateCharacterActors(props, 246).mascot!;
  assert.equal(closed.speaking, true);
  assert.equal(closed.viseme, "m");
  assert.equal(open.viseme, "a");
  assert.ok(open.mouthScaleY > closed.mouthScaleY);
});

test("character scene renders repository-owned SVG rigs and timed overlays", () => {
  const props = fixture();
  const before = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 90 }));
  const during = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.match(during, /<svg/);
  assert.match(during, /999 000 сум/);
  assert.doesNotMatch(before, /999 000 сум/);
  assert.doesNotMatch(during, /https?:\/\//);

  const phone = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 75 }));
  assert.match(phone, /aria-label="phone"/);
  assert.match(phone, /M138 99 L143 104 L153 93/);

  const pointing = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 110 }));
  assert.match(pointing, /M62 35 Q118 88 142 168/);

  const thinking = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 215 }));
  assert.match(thinking, /M62 35 Q67 76 30 73/);
});
