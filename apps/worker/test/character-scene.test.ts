import assert from "node:assert/strict";
import { test } from "node:test";
import {
  builtInCharacterPacks,
  CharacterSceneProps,
  phoneCharacterProp,
} from "@visual-canvas/video/registry";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CharacterScene, evaluateCharacterActors } from "../src/video/character-scene.js";

function fixture() {
  return CharacterSceneProps.parse({
    background: "#170f0a",
    seed: 18273,
    characterPacksById: structuredClone(builtInCharacterPacks),
    actorOrder: ["customer", "mascot"],
    actorsById: {
      customer: {
        characterPackId: "customer",
        x: 0.25,
        y: 0.7,
        scale: 1.1,
        facing: "right",
        initialEmotion: "neutral",
      },
      mascot: {
        characterPackId: "farq-mascot",
        x: 0.7,
        y: 0.64,
        scale: 1.15,
        facing: "left",
        initialEmotion: "happy",
      },
    },
    propOrder: ["phone"],
    propsById: { phone: structuredClone(phoneCharacterProp) },
    actionOrder: [
      "enter",
      "look",
      "blink",
      "phone",
      "point",
      "shock",
      "think",
      "thinkGesture",
      "talk",
    ],
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
        target: { kind: "actor", actorId: "mascot" },
      },
      blink: {
        type: "blink",
        actorId: "customer",
        startFrame: 60,
        durationFrames: 8,
        blendInFrames: 0,
        blendOutFrames: 0,
      },
      phone: {
        type: "showProp",
        actorId: "mascot",
        startFrame: 70,
        durationFrames: 20,
        propId: "phone",
        hand: "right",
      },
      point: {
        type: "point",
        actorId: "mascot",
        startFrame: 95,
        durationFrames: 45,
        target: { kind: "overlay", overlayId: "price" },
        hand: "right",
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
      thinkGesture: {
        type: "gesture",
        actorId: "customer",
        startFrame: 200,
        durationFrames: 30,
        preset: "think",
        hand: "right",
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
      state.opacity,
      ...Object.values(state.pose),
      ...Object.values(state.rig).flatMap((node) => [node.origin.x, node.origin.y]),
    ])
      assert.equal(Number.isFinite(value), true);
});

test("fixed-orientation asymmetric packs ignore actor mirroring", () => {
  const input = structuredClone(fixture());
  input.actorsById.mascot.characterPackId = "farq-official";
  input.actorsById.mascot.facing = "left";
  const fixed = evaluateCharacterActors(CharacterSceneProps.parse(input), 90).mascot!;
  assert.ok(fixed.rig.root.matrix[0] > 0);

  input.characterPacksById["farq-official"]!.orientation = {
    canonicalFacing: "right",
    mirror: "allowed",
  };
  const mirrored = evaluateCharacterActors(CharacterSceneProps.parse(input), 90).mascot!;
  assert.ok(mirrored.rig.root.matrix[0] < 0);
});

test("enter stays hidden before its start and reaches rest without a reset pop", () => {
  const props = fixture();
  const before = evaluateCharacterActors(props, 9).mascot!;
  const start = evaluateCharacterActors(props, 10).mascot!;
  const finalEnterFrame = evaluateCharacterActors(props, 54).mascot!;
  const settled = evaluateCharacterActors(props, 55).mascot!;
  assert.equal(before.opacity, 0);
  assert.ok(before.pose["root.x"]! > 1080);
  assert.equal(start.opacity, 0);
  assert.equal(settled.opacity, 1);
  assert.ok(Math.abs(finalEnterFrame.pose["root.x"]! - settled.pose["root.x"]!) < 0.001);
  assert.ok(Math.abs(finalEnterFrame.pose["root.y"]! - settled.pose["root.y"]!) < 0.01);
});

test("semantic gaze, blink, gesture and reaction evaluate into distinct rig states", () => {
  const props = fixture();
  const gaze = evaluateCharacterActors(props, 55);
  assert.ok(gaze.customer!.face.gazeX > 0);

  const blink = evaluateCharacterActors(props, 64);
  assert.ok(Math.abs(blink.customer!.face.eyeOpen - 0.05) < 1e-9);

  const beforePoint = evaluateCharacterActors(props, 94).mascot!.rig.rightHand.origin;
  const gesture = evaluateCharacterActors(props, 110);
  const pointed = gesture.mascot!.rig.rightHand.origin;
  const price = { x: 540, y: 0.22 * 1920 };
  assert.ok(
    Math.hypot(pointed.x - price.x, pointed.y - price.y) <
      Math.hypot(beforePoint.x - price.x, beforePoint.y - price.y),
  );

  const beforeShock = evaluateCharacterActors(props, 144).customer!;
  const shock = evaluateCharacterActors(props, 167).customer!;
  assert.equal(shock.emotion, "shocked");
  assert.notEqual(shock.pose["body.scaleX"], beforeShock.pose["body.scaleX"]);
  assert.equal(shock.face.browTilt > beforeShock.face.browTilt, true);

  const beforeThinking = evaluateCharacterActors(props, 199).customer!;
  const thinking = evaluateCharacterActors(props, 215).customer!;
  assert.equal(thinking.emotion, "thinking");
  const mouth = thinking.rig.mouth.origin;
  assert.ok(
    Math.hypot(
      thinking.rig.rightHand.origin.x - mouth.x,
      thinking.rig.rightHand.origin.y - mouth.y,
    ) <
      Math.hypot(
        beforeThinking.rig.rightHand.origin.x - mouth.x,
        beforeThinking.rig.rightHand.origin.y - mouth.y,
      ),
  );

  const closed = evaluateCharacterActors(props, 240).mascot!;
  const open = evaluateCharacterActors(props, 246).mascot!;
  assert.equal(closed.face.viseme, "m");
  assert.equal(open.face.viseme, "a");
  assert.ok(open.face.mouthOpen > closed.face.mouthOpen);
});

test("explicit blink reaches its authored closed pose with default action blends", () => {
  const input = structuredClone(fixture());
  delete input.actionsById.blink!.blendInFrames;
  delete input.actionsById.blink!.blendOutFrames;
  const props = CharacterSceneProps.parse(input);
  assert.equal(props.actionsById.blink!.blendInFrames, 6);
  assert.ok(Math.abs(evaluateCharacterActors(props, 64).customer!.face.eyeOpen - 0.05) < 1e-9);
});

test("zero gesture intensity preserves the authored rest hand for every preset", () => {
  for (const preset of ["point", "explain", "shrug", "think"] as const) {
    const input = structuredClone(fixture());
    input.actionOrder = ["gesture"];
    input.actionsById = {
      gesture: {
        type: "gesture",
        actorId: "customer",
        startFrame: 10,
        durationFrames: 30,
        preset,
        hand: "right",
        intensity: 0,
      },
    };
    const withGesture = CharacterSceneProps.parse(input);
    const restInput = structuredClone(input);
    restInput.actionOrder = [];
    restInput.actionsById = {};
    const atRest = evaluateCharacterActors(CharacterSceneProps.parse(restInput), 25).customer!.rig
      .rightHand.origin;
    const zero = evaluateCharacterActors(withGesture, 25).customer!.rig.rightHand.origin;
    assert.ok(
      Math.hypot(zero.x - atRest.x, zero.y - atRest.y) < 1e-6,
      `${preset} intensity 0 moved the right hand`,
    );
  }
});

test("pointing silhouette follows the action blend continuously", () => {
  const props = fixture();
  const early = evaluateCharacterActors(props, 96).mascot!.pointing.right!;
  const settled = evaluateCharacterActors(props, 101).mascot!.pointing.right!;
  assert.ok(early.weight > 0 && early.weight < 0.1);
  assert.equal(settled.weight, 1);
  assert.deepEqual(early.target, settled.target);

  const markup = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 96 }));
  assert.match(markup, /data-character-point-finger="right"/);
  assert.match(markup, /opacity="0\.0/);
});

test("showProp fades in at its attached hand and remains fully visible after the action", () => {
  const props = fixture();
  const start = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 70 }));
  const entering = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 71 }));
  const held = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.match(start, /aria-label="Phone"[^>]*opacity="0"/);
  assert.match(entering, /aria-label="Phone"[^>]*opacity="0\.0/);
  assert.match(held, /aria-label="Phone"[^>]*opacity="1"/);
});

test("character scene renders repository-owned SVG rigs and timed overlays", () => {
  const props = fixture();
  const before = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 90 }));
  const during = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.match(during, /<svg/);
  assert.match(during, /999 000 сум/);
  assert.doesNotMatch(before, /999 000 сум/);
  assert.doesNotMatch(during, /https?:\/\//);

  const phone = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.match(phone, /aria-label="Phone"/);
  assert.match(phone, /data-character-prop="true"/);

  const pointing = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 110 }));
  assert.match(pointing, /data-arm="right"/);
  assert.match(pointing, /data-character-point-arm="right"/);
  assert.match(pointing, /data-character-point-finger="right"/);

  const thinking = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 215 }));
  assert.match(thinking, /data-character-pack="customer"/);
  assert.match(thinking, /data-character-pack="farq-mascot"/);
  assert.match(thinking, /data-character-foreground-arm="right"/);
});

test("arm masks include the forearm channel used by IK", () => {
  const input = structuredClone(fixture());
  input.actionsById.point!.mask = ["rightArm"];
  const props = CharacterSceneProps.parse(input);
  const before = evaluateCharacterActors(props, 94).mascot!.pose;
  const pointing = evaluateCharacterActors(props, 110).mascot!.pose;
  assert.notEqual(pointing["rightArm.rotation"], before["rightArm.rotation"]);
  assert.notEqual(pointing["rightForearm.rotation"], before["rightForearm.rotation"]);
});

test("gaze-only masks leave the separately owned head channel untouched", () => {
  const input = structuredClone(fixture());
  input.actionsById.look!.mask = ["gaze"];
  const state = evaluateCharacterActors(CharacterSceneProps.parse(input), 55).customer!;
  assert.notEqual(state.face.gazeX, 0);
  assert.equal(state.pose["head.rotation"], 0);
});

test("IK reaches a world target when an imported pack uses a nonzero rig root", () => {
  const input = structuredClone(fixture());
  for (const point of Object.values(input.characterPacksById["farq-mascot"]!.rig)) {
    point.x += 30;
    point.y += 40;
  }
  input.actionsById.point!.target = {
    kind: "point",
    x: 600 / 1080,
    y: 1340 / 1920,
  };
  const state = evaluateCharacterActors(CharacterSceneProps.parse(input), 110).mascot!;
  const hand = state.rig.rightHand.origin;
  assert.ok(Math.hypot(hand.x - 600, hand.y - 1340) < 2);
});

test("zero-weight enter is disabled instead of becoming a permanent offscreen base", () => {
  const input = structuredClone(fixture());
  input.actionsById.enter!.weight = 0;
  const state = evaluateCharacterActors(CharacterSceneProps.parse(input), 60).mascot!;
  assert.equal(state.pose["root.x"], 0.7 * 1080);
  assert.equal(state.opacity, 1);
});

test("a faint high-priority viseme blends over rather than silencing lower-priority speech", () => {
  const input = structuredClone(fixture());
  input.actionOrder.splice(5, 0, "baseTalk", "faintTalk");
  input.actionsById.baseTalk = {
    type: "talk",
    actorId: "customer",
    startFrame: 100,
    durationFrames: 40,
    priority: 0,
    visemes: [{ frame: 0, shape: "a" }],
  };
  input.actionsById.faintTalk = {
    type: "talk",
    actorId: "customer",
    startFrame: 100,
    durationFrames: 40,
    priority: 10,
    weight: 0.01,
    visemes: [{ frame: 0, shape: "m" }],
  };
  const state = evaluateCharacterActors(CharacterSceneProps.parse(input), 110).customer!;
  assert.equal(state.face.viseme, "a");
  assert.ok(state.face.mouthOpen > 0.9);
});

test("zero-weight semantic actions cannot reveal props or override speech and emotion", () => {
  const input = structuredClone(fixture());
  input.actionsById.phone!.weight = 0;
  input.actionOrder.splice(5, 0, "mutedTalk");
  input.actionsById.mutedTalk = {
    type: "talk",
    actorId: "customer",
    startFrame: 100,
    durationFrames: 80,
    weight: 0,
    emotion: "shocked",
    visemes: [{ frame: 0, shape: "a" }],
  };
  const props = CharacterSceneProps.parse(input);
  const state = evaluateCharacterActors(props, 120).customer!;
  const markup = renderToStaticMarkup(createElement(CharacterScene, { props, frame: 120 }));
  assert.equal(state.emotion, "neutral");
  assert.equal(state.face.viseme, "rest");
  assert.doesNotMatch(markup, /aria-label="Phone"/);
});
