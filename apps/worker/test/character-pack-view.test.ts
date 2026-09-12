import assert from "node:assert/strict";
import { test } from "node:test";
import type { CharacterPack, CharacterProp } from "@visual-canvas/video/registry";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type CharacterFaceState,
  CharacterPackView,
  CharacterPropView,
} from "../src/video/character-pack-view.js";
import {
  evaluateRig,
  resolvePropAttachment,
  transformPoint,
} from "../src/video/character-runtime.js";

function fixture(): CharacterPack {
  return {
    version: 1,
    id: "newRobot",
    label: "Custom <Robot>",
    viewBox: { width: 400, height: 500 },
    rig: {
      root: { x: 0, y: 0 },
      body: { x: 0, y: 50 },
      head: { x: 0, y: -40 },
      eyes: { x: 0, y: -50 },
      mouth: { x: 0, y: -15 },
      leftShoulder: { x: -50, y: 20 },
      leftElbow: { x: -80, y: 55 },
      leftHand: { x: -90, y: 95 },
      rightShoulder: { x: 50, y: 20 },
      rightElbow: { x: 80, y: 55 },
      rightHand: { x: 90, y: 95 },
    },
    capabilities: {
      arms: true,
      gaze: true,
      blink: true,
      talk: true,
      emotions: ["neutral"],
      gestures: ["point"],
    },
    layers: [
      {
        id: "robotBody",
        node: "body",
        shapes: [
          {
            kind: "rect",
            x: -40,
            y: -30,
            width: 80,
            height: 60,
            radius: 10,
            fill: "#112233",
            strokeWidth: 0,
          },
        ],
      },
      {
        id: "robotHead",
        node: "head",
        shapes: [{ kind: "ellipse", x: 0, y: 0, rx: 60, ry: 50, fill: "#445566", strokeWidth: 0 }],
      },
      {
        id: "antenna",
        node: "head",
        shapes: [
          {
            kind: "path",
            d: "M0 -50 L0 -80",
            fill: "#00000000",
            stroke: "#778899",
            strokeWidth: 5,
          },
        ],
      },
    ],
    style: {
      limbColor: "#aabbcc",
      limbWidth: 10,
      handRadius: 8,
      eyeColor: "#000000",
      eyeWhite: "#ffffff",
      eyeRadius: 15,
      eyeSpacing: 40,
      mouthColor: "#223344",
      mouthWidth: 35,
    },
    expressions: {
      neutral: { browTilt: 0, mouthCurve: 0.1, eyeOpen: 1 },
      happy: { browTilt: 0, mouthCurve: 0.8, eyeOpen: 1 },
      thinking: { browTilt: 0.5, mouthCurve: -0.3, eyeOpen: 0.8 },
      shocked: { browTilt: -1, mouthCurve: 0, eyeOpen: 1.5 },
    },
    motion: {
      breathingAmplitude: 1,
      breathingPeriodFrames: 90,
      blinkIntervalFrames: 100,
      swayDegrees: 1,
      gazeLimit: 9,
      headTurnDegrees: 12,
      elbowBend: "outward",
      armStretch: 1,
    },
  };
}

const face: CharacterFaceState = {
  gazeX: 4,
  gazeY: -2,
  eyeOpen: 0.6,
  browTilt: 0.2,
  mouthCurve: 0.4,
  viseme: "rest",
  mouthOpen: 0,
};
function evaluated(pack: CharacterPack) {
  return evaluateRig(
    Object.entries(pack.rig).map(([id, point]) => ({ id, transform: point })),
    {},
    { x: 250, y: 400, scaleX: 2, scaleY: 2 },
  );
}

test("a previously unknown pack renders all declared artwork at evaluated nodes without ID-specific branches", () => {
  const pack = fixture();
  const markup = renderToStaticMarkup(
    createElement(CharacterPackView, { pack, rig: evaluated(pack), face }),
  );
  assert.match(markup, /aria-label="Custom &lt;Robot&gt;"/);
  assert.match(markup, /data-layer="robotBody" transform="matrix\(2 0 0 2 250 500\)"/);
  assert.match(markup, /data-layer="robotHead" transform="matrix\(2 0 0 2 250 320\)"/);
  assert.match(markup, /fill="#112233"/);
  assert.match(markup, /d="M0 -50 L0 -80"/);
  assert.match(markup, /data-arm="right" d="M50 -30 L80 5 L90 45"/);
  assert.match(markup, /data-hand="right" transform="matrix\(2 0 0 2 430 590\)"/);
  assert.match(markup, /scale\(1 0.6\)/);
  assert.match(markup, /cx="4" cy="-2"/);
});

test("continuous mouth envelope affects visemes while disabled capabilities suppress procedural motion", () => {
  const pack = fixture(),
    rig = evaluated(pack);
  const small = renderToStaticMarkup(
    createElement(CharacterPackView, { pack, rig, face: { ...face, viseme: "o", mouthOpen: 0.2 } }),
  );
  const wide = renderToStaticMarkup(
    createElement(CharacterPackView, { pack, rig, face: { ...face, viseme: "o", mouthOpen: 1 } }),
  );
  assert.notEqual(small, wide);
  assert.match(wide, /data-viseme="o"/);
  pack.capabilities = { ...pack.capabilities, arms: false, gaze: false, talk: false };
  const disabled = renderToStaticMarkup(
    createElement(CharacterPackView, { pack, rig, face: { ...face, viseme: "o", mouthOpen: 1 } }),
  );
  assert.doesNotMatch(disabled, /data-arm=/);
  assert.doesNotMatch(disabled, /data-hand=/);
  assert.match(disabled, /data-viseme="rest"/);
  assert.match(disabled, /cx="0" cy="0"/);
});

test("prop artwork follows the supplied grip-resolved affine matrix, including rotation and scale", () => {
  const prop: CharacterProp = {
    label: "Tablet",
    width: 80,
    height: 120,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    grip: { x: 12, y: 90 },
    shapes: [
      {
        kind: "rect",
        x: 0,
        y: 0,
        width: 80,
        height: 120,
        radius: 8,
        fill: "#000000",
        strokeWidth: 0,
      },
    ],
  };
  const matrix = resolvePropAttachment([0, 2, -2, 0, 300, 500], prop.grip);
  assert.deepEqual(transformPoint(matrix, prop.grip), { x: 300, y: 500 });
  const markup = renderToStaticMarkup(createElement(CharacterPropView, { prop, matrix }));
  assert.match(markup, /transform="matrix\(0 2 -2 0 480 476\)"/);
  assert.match(markup, /width="80" height="120"/);
});
