import assert from "node:assert/strict";
import { test } from "node:test";
import {
  builtInCharacterPacks,
  type CharacterSceneProps,
  phoneCharacterProp,
} from "@visual-canvas/video/registry";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdvertisingOverlay,
  EnvironmentPlane,
  evaluatePresentationCamera,
  presentationScreenToWorld,
} from "../src/video/character-presentation.js";

function fixture(layout: CharacterSceneProps["staging"]["layout"] = "two-shot") {
  return {
    stage: { aspect: "9:16", width: 1080, height: 1920 },
    cameraSequence: [],
    effects: [],
    timebase: { numerator: 30, denominator: 1 },
    seed: 17,
    staging: {
      layout,
      focalActorId: "customer",
      productPropId: "phone",
    },
    camera: {
      movement: "push-in",
      startFrame: 20,
      durationFrames: 40,
      holdFrames: 30,
      intensity: 0.8,
    },
    environment: {
      background: "#17100d",
      horizonY: 0.68,
      ground: "#2b1710",
      accent: "#ff7a1a",
      layers: [
        {
          id: "sun",
          plane: "background",
          shape: "orb",
          x: 0.78,
          y: 0.2,
          width: 0.34,
          height: 0.2,
          color: "#ff7a1a",
          opacity: 0.2,
          parallax: 0.15,
        },
        {
          id: "counter",
          plane: "foreground",
          shape: "panel",
          x: 0.5,
          y: 0.92,
          width: 1.1,
          height: 0.2,
          color: "#4b291d",
          opacity: 1,
          parallax: 0.9,
        },
      ],
    },
    characterPacksById: structuredClone(builtInCharacterPacks),
    actorOrder: ["customer", "mascot"],
    actorsById: {
      customer: {
        characterPackId: "customer",
        x: 0.26,
        y: 0.73,
        scale: 1.25,
        facing: "right",
        initialEmotion: "neutral",
      },
      mascot: {
        characterPackId: "farq-mascot",
        x: 0.72,
        y: 0.68,
        scale: 0.72,
        facing: "left",
        initialEmotion: "happy",
      },
    },
    propOrder: ["phone"],
    propsById: { phone: structuredClone(phoneCharacterProp) },
    actionOrder: [],
    actionsById: {},
    overlayOrder: [],
    overlaysById: {},
  } as CharacterSceneProps;
}

test("camera motion eases deterministically into a stable hold and uses authored pack bounds", () => {
  const props = fixture("reaction-closeup");
  const before = evaluatePresentationCamera(props, 10);
  const middle = evaluatePresentationCamera(props, 40);
  const held = evaluatePresentationCamera(props, 70);
  assert.equal(before.phase, "waiting");
  assert.equal(middle.phase, "moving");
  assert.equal(held.phase, "holding");
  assert.ok(middle.scale > before.scale);
  const settled = evaluatePresentationCamera(props, 180);
  assert.equal(settled.phase, "settled");
  assert.equal(settled.scale, 1);

  const largerPack = structuredClone(props);
  largerPack.characterPacksById.customer!.viewBox.height *= 1.5;
  assert.ok(
    evaluatePresentationCamera(largerPack, 70).scale < held.scale,
    "a larger authored character should receive a wider closeup",
  );
});

test("inverse camera mapping keeps screen overlay targets aligned", () => {
  const props = fixture();
  const camera = evaluatePresentationCamera(props, 60);
  const screen = { x: 810, y: 420 };
  const world = presentationScreenToWorld(camera, screen, props.stage);
  assert.ok(Math.abs((world.x - camera.targetX) * camera.scale + 540 - screen.x) < 1e-9);
  assert.ok(Math.abs((world.y - camera.targetY) * camera.scale + 960 - screen.y) < 1e-9);
});

test("sequenced non-cut shots continue from the preceding shot endpoint", () => {
  const props = fixture();
  props.cameraSequence = [
    {
      id: "first",
      startFrame: 10,
      durationFrames: 10,
      type: "pan",
      x: 0.25,
      y: 0.5,
      intensity: 1,
    },
    {
      id: "second",
      startFrame: 20,
      durationFrames: 10,
      type: "pan",
      x: 0.75,
      y: 0.5,
      intensity: 1,
    },
  ];

  const firstEndpoint = evaluatePresentationCamera(props, 19);
  const secondStart = evaluatePresentationCamera(props, 20);
  assert.equal(secondStart.targetX, firstEndpoint.targetX);
  assert.equal(secondStart.targetY, firstEndpoint.targetY);
  assert.equal(secondStart.scale, firstEndpoint.scale);
  assert.ok(evaluatePresentationCamera(props, 29).targetX > secondStart.targetX);
});

test("an unparameterized hold preserves the preceding shot endpoint", () => {
  const props = fixture();
  props.cameraSequence = [
    {
      id: "pan",
      startFrame: 10,
      durationFrames: 10,
      type: "pan",
      x: 0.25,
      y: 0.35,
      zoom: 1.2,
      intensity: 1,
    },
    {
      id: "hold",
      startFrame: 20,
      durationFrames: 10,
      type: "hold",
      intensity: 1,
    },
  ];

  const endpoint = evaluatePresentationCamera(props, 19);
  for (const frame of [20, 24, 29]) {
    const held = evaluatePresentationCamera(props, frame);
    assert.equal(held.targetX, endpoint.targetX);
    assert.equal(held.targetY, endpoint.targetY);
    assert.equal(held.scale, endpoint.scale);
  }
});

test("camera actor targets use the supplied frame-exact runtime resolver", () => {
  const props = fixture();
  props.cameraSequence = [
    {
      id: "follow",
      startFrame: 10,
      durationFrames: 20,
      type: "follow",
      target: { kind: "actor", actorId: "customer" },
      intensity: 1,
    },
  ];
  const calls: number[] = [];
  const camera = evaluatePresentationCamera(props, 29, undefined, (target, atFrame) => {
    assert.deepEqual(target, { kind: "actor", actorId: "customer" });
    calls.push(atFrame);
    return { x: 900, y: 700 };
  });

  assert.deepEqual(calls, [29]);
  assert.equal(camera.targetX, 900);
  assert.equal(camera.targetY, 700);
});

test("single-product camera keeps staged actor bounds visible while following an attached product", () => {
  const props = fixture("single-product");
  props.actorOrder = ["customer"];
  props.actorsById = { customer: props.actorsById.customer! };
  props.actorsById.customer!.x = 0.5;
  props.actorsById.customer!.y = 0.69;
  props.camera.startFrame = 0;
  props.camera.durationFrames = 1;
  props.camera.holdFrames = 0;
  props.camera.intensity = 1;
  const pack = props.characterPacksById.customer!;
  const actor = props.actorsById.customer!;
  const halfWidth = (pack.viewBox.width * actor.scale) / 2;
  const halfHeight = (pack.viewBox.height * actor.scale) / 2;
  const project = (
    camera: ReturnType<typeof evaluatePresentationCamera>,
    x: number,
    y: number,
  ) => ({
    x: 540 + (x - camera.targetX) * camera.scale,
    y: 960 + (y - camera.targetY) * camera.scale,
  });

  for (const productWorldPoint of [
    { x: 180, y: 1220 },
    { x: 900, y: 1220 },
  ]) {
    const camera = evaluatePresentationCamera(props, 1, { productWorldPoint });
    const topLeft = project(camera, actor.x * 1080 - halfWidth, actor.y * 1920 - halfHeight);
    const bottomRight = project(camera, actor.x * 1080 + halfWidth, actor.y * 1920 + halfHeight);
    assert.ok(topLeft.x >= 24, `left actor edge must remain visible: ${topLeft.x}`);
    assert.ok(bottomRight.x <= 1056, `right actor edge must remain visible: ${bottomRight.x}`);
    assert.ok(topLeft.y >= 300, `actor must stay below the reserved offer corridor: ${topLeft.y}`);
    assert.ok(bottomRight.y <= 1896, `actor bottom must remain visible: ${bottomRight.y}`);
  }
});

test("environment planes are bounded, filtered and retain authored depth", () => {
  const props = fixture();
  const camera = evaluatePresentationCamera(props, 45);
  const background = renderToStaticMarkup(
    createElement(EnvironmentPlane, {
      environment: props.environment,
      plane: "background",
      camera,
      stage: props.stage,
    }),
  );
  assert.match(background, /environment-background/);
  assert.match(background, /<ellipse/);
  assert.doesNotMatch(background, /<rect/);
  assert.match(background, /translate\(/);

  const backgroundLayer = props.environment.layers[0]!;
  const foregroundLayer = props.environment.layers[1]!;
  const backgroundTravel = (camera.targetX - 540) * (1 - backgroundLayer.parallax);
  const foregroundTravel = (camera.targetX - 540) * (1 - foregroundLayer.parallax);
  const cameraDisplacement = (worldX: number, localTravel: number) =>
    540 + camera.scale * (worldX + localTravel - camera.targetX);
  assert.ok(
    Math.abs(cameraDisplacement(540, backgroundTravel) - 540) <
      Math.abs(cameraDisplacement(540, foregroundTravel) - 540),
    "background must move less on screen than foreground",
  );
});

test("advertising typography renders price hierarchy, savings and restrained entry FX", () => {
  const price = renderToStaticMarkup(
    createElement(AdvertisingOverlay, {
      frame: 12,
      stage: { aspect: "9:16", width: 1080, height: 1920 },
      overlay: {
        text: "899 000",
        x: 0.5,
        y: 0.25,
        startFrame: 10,
        endFrame: 80,
        style: "price-new",
        accent: "#ff7a1a",
      },
    }),
  );
  assert.match(price, /overlay-price-new/);
  assert.match(price, /<line/);
  assert.match(price, />899 000</);
  assert.match(price, /textLength=/);
  assert.match(price, /font-family="DejaVu Sans, Arial, Helvetica, sans-serif"/);

  const savings = renderToStaticMarkup(
    createElement(AdvertisingOverlay, {
      frame: 30,
      stage: { aspect: "9:16", width: 1080, height: 1920 },
      overlay: {
        text: "200 000 saved",
        emphasis: "Save",
        x: 0.5,
        y: 0.35,
        startFrame: 10,
        endFrame: 80,
        style: "savings",
      },
    }),
  );
  assert.match(savings, />SAVE</);
  assert.match(savings, />200 000 saved</);
  assert.match(savings, /fill="#ff7a1a"/);

  const longCallout = renderToStaticMarkup(
    createElement(AdvertisingOverlay, {
      frame: 30,
      stage: { aspect: "9:16", width: 1080, height: 1920 },
      overlay: {
        text: "A deliberately long authored advertising callout that must stay within its card",
        x: 0.5,
        y: 0.35,
        startFrame: 10,
        endFrame: 80,
        style: "callout",
      },
    }),
  );
  assert.ok((longCallout.match(/<tspan/g) ?? []).length > 1);
  assert.doesNotMatch(longCallout, /textLength="[7-9][0-9][0-9]"/);
});
