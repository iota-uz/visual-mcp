import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnimationTrack, Vec2 } from "../src/video/character-runtime.js";
import {
  compileSemanticActions,
  evaluateActingPhases,
  evaluateFollowThrough,
  evaluateIdleMotion,
  evaluateRig,
  inverseMatrix,
  mixAnimationTracks,
  resolvePersistentPropAttachments,
  resolvePropAttachment,
  solveGaze,
  solveTwoBoneIK,
  transformMatrix,
  transformPoint,
} from "../src/video/character-runtime.js";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const nearPoint = (actual: Vec2, expected: Vec2) => {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
};

test("normalized rig resolves unordered hierarchy, scale, facing and joint limits", () => {
  const result = evaluateRig(
    [
      { id: "hand", parentId: "arm", transform: { x: 5 } },
      { id: "root", transform: { x: 10, y: 20 } },
      { id: "arm", parentId: "root", transform: { rotation: 90 }, rotationLimits: [-90, 90] },
    ],
    { arm: { rotation: 120 } },
    { scaleX: -2, scaleY: 2 },
  );
  nearPoint(result.hand!.origin, { x: -20, y: 50 });
  near(result.arm!.local.rotation, 90);
  assert.throws(
    () =>
      evaluateRig([
        { id: "arm", parentId: "hand", transform: {} },
        { id: "hand", parentId: "arm", transform: {} },
      ]),
    /cycle/,
  );
  assert.throws(() => evaluateRig([{ id: "hand", parentId: "missing", transform: {} }]), /Missing/);
});

test("IK reaches targets using both bend directions without changing bone lengths", () => {
  for (const bend of [-1, 1] as const) {
    const result = solveTwoBoneIK({
      shoulder: { x: 10, y: 15 },
      target: { x: 70, y: 50 },
      upperLength: 50,
      lowerLength: 40,
      bend,
    });
    assert.equal(result.reachable, true);
    nearPoint(result.hand, { x: 70, y: 50 });
    near(Math.hypot(result.elbow.x - 10, result.elbow.y - 15), 50);
    near(Math.hypot(result.hand.x - result.elbow.x, result.hand.y - result.elbow.y), 40);
    assert.equal(Math.sign(result.elbowRotation), bend);
  }
});

test("IK clamps unreachable targets and respects authored rotation limits", () => {
  const extended = solveTwoBoneIK({
    shoulder: { x: 0, y: 0 },
    target: { x: 1000, y: 0 },
    upperLength: 30,
    lowerLength: 20,
  });
  assert.equal(extended.reachable, false);
  nearPoint(extended.hand, { x: 50, y: 0 });
  const folded = solveTwoBoneIK({
    shoulder: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
    upperLength: 30,
    lowerLength: 30,
  });
  assert.equal(folded.reachable, true);
  assert.ok(Object.values(folded.hand).every(Number.isFinite));
  const constrained = solveTwoBoneIK({
    shoulder: { x: 0, y: 0 },
    target: { x: 0, y: 50 },
    upperLength: 30,
    lowerLength: 30,
    shoulderLimits: [-20, 20],
    elbowLimits: [-45, 45],
  });
  assert.ok(Math.abs(constrained.shoulderRotation) <= 20);
  assert.ok(Math.abs(constrained.elbowRotation) <= 45);
  assert.equal(constrained.reachable, false);
});

test("gaze clamps offsets and stays finite at a coincident target", () => {
  const gaze = solveGaze({
    origin: { x: 0, y: 0 },
    target: { x: 100, y: -200 },
    responseDistance: 20,
    maxEyeOffsetX: 4,
    maxEyeOffsetY: 3,
  });
  assert.equal(gaze.gazeX, 4);
  assert.equal(gaze.gazeY, -3);
  assert.deepEqual(solveGaze({ origin: { x: 1, y: 1 }, target: { x: 1, y: 1 } }), {
    gazeX: 0,
    gazeY: 0,
    headRotation: 0,
  });
});

test("horizontal gaze drives a bounded head turn independent of target height", () => {
  const level = solveGaze({
    origin: { x: 0, y: 0 },
    target: { x: 50, y: 0 },
    responseDistance: 100,
    maxHeadRotation: 18,
  });
  const above = solveGaze({
    origin: { x: 0, y: 0 },
    target: { x: 50, y: -200 },
    responseDistance: 100,
    maxHeadRotation: 18,
  });
  const left = solveGaze({
    origin: { x: 0, y: 0 },
    target: { x: -1_000, y: 0 },
    responseDistance: 100,
    maxHeadRotation: 18,
  });
  near(level.headRotation, 9);
  near(above.headRotation, level.headRotation);
  near(left.headRotation, -18);
});

test("prop grip remains on hand under facing, scale and rotation", () => {
  const hand = transformMatrix({ x: 130, y: 250, rotation: 37, scaleX: -1.4, scaleY: 1.4 });
  const grip = { x: 20, y: 80 };
  const prop = resolvePropAttachment(hand, grip, { rotation: -20 });
  nearPoint(transformPoint(prop, grip), { x: 130, y: 250 });
  const worldPoint = transformPoint(prop, { x: 15, y: 34 });
  nearPoint(transformPoint(inverseMatrix(prop), worldPoint), { x: 15, y: 34 });
});

const track = (
  id: string,
  channel: string,
  value: number,
  options: Partial<AnimationTrack> = {},
): AnimationTrack => ({
  id,
  channel,
  layer: "test",
  priority: 0,
  startFrame: 0,
  durationFrames: 20,
  keyframes: [{ frame: 0, value }],
  mode: "override",
  ...options,
});
test("mixer allows locomotion, gesture, gaze and speech simultaneously with priority and masks", () => {
  const tracks = [
    track("locomotion", "root.x", 100),
    track("gesture", "rightArm.rotation", 45),
    track("gaze", "eyes.x", -1),
    track("speech", "mouth.open", 0.8),
    track("high-priority", "rightArm.rotation", 90, { priority: 10, weight: 0.5 }),
    track("invalid-mask", "root.x", 999, { priority: 100, bodyMask: ["rightArm"] }),
    track("secondary", "rightArm.rotation", 2, { priority: 20, mode: "additive" }),
  ];
  const actual = mixAnimationTracks({}, tracks, 10);
  assert.deepEqual(actual, {
    "root.x": 100,
    "rightArm.rotation": 69.5,
    "eyes.x": -1,
    "mouth.open": 0.8,
  });
  assert.deepEqual(actual, mixAnimationTracks({}, tracks.toReversed(), 10));
});

test("track transitions blend into and out of base pose, movement retains its destination", () => {
  const transition = track("pose", "head.rotation", 40, { fadeInFrames: 4, fadeOutFrames: 4 });
  near(mixAnimationTracks({ "head.rotation": 0 }, [transition], 0)["head.rotation"]!, 0);
  near(mixAnimationTracks({ "head.rotation": 0 }, [transition], 2)["head.rotation"]!, 20);
  near(mixAnimationTracks({ "head.rotation": 0 }, [transition], 18)["head.rotation"]!, 20);
  near(mixAnimationTracks({ "head.rotation": 0 }, [transition], 20)["head.rotation"]!, 0);
  const move = compileSemanticActions([
    {
      id: "move",
      type: "move",
      startFrame: 10,
      durationFrames: 20,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 20 },
    },
  ]);
  near(mixAnimationTracks({}, move, 500)["root.x"]!, 100);
});

test("adjacent same-channel tracks crossfade directly without a rest-pose dip", () => {
  const outgoing = track("a", "head.rotation", 40, {
    startFrame: 0,
    durationFrames: 20,
    fadeOutFrames: 6,
  });
  const incoming = track("b", "head.rotation", -20, {
    startFrame: 20,
    durationFrames: 20,
    fadeInFrames: 6,
  });
  near(mixAnimationTracks({ "head.rotation": 0 }, [outgoing, incoming], 19)["head.rotation"]!, 40);
  near(mixAnimationTracks({ "head.rotation": 0 }, [outgoing, incoming], 20)["head.rotation"]!, 40);
  const middle = mixAnimationTracks({ "head.rotation": 0 }, [outgoing, incoming], 23)[
    "head.rotation"
  ]!;
  assert.ok(middle < 40 && middle > -20);
  near(mixAnimationTracks({ "head.rotation": 0 }, [incoming, outgoing], 26)["head.rotation"]!, -20);
  const disabled = { ...incoming, id: "disabled", weight: 0 };
  const faded = mixAnimationTracks({ "head.rotation": 0 }, [outgoing, disabled], 19)[
    "head.rotation"
  ]!;
  assert.ok(faded > 2 && faded < 4);
});

test("acting beats retain real-time timing across frame rates and arbitrary seek order", () => {
  const sample = (fps: number, seconds: number) =>
    evaluateActingPhases({
      frame: Math.round(seconds * fps),
      startFrame: 0,
      durationFrames: fps * 2,
      fps,
      intensity: 0.8,
      stillness: 0.25,
    });
  for (const seconds of [0.08, 0.25, 0.8, 1.85]) {
    const at24 = sample(24, seconds);
    const at60 = sample(60, seconds);
    assert.ok(Math.abs(at24.accent - at60.accent) < 0.18);
    assert.ok(Math.abs(at24.gaze - at60.gaze) < 0.18);
  }
  const expected = sample(30, 0.7);
  sample(30, 1.9);
  sample(30, 0.1);
  assert.deepEqual(sample(30, 0.7), expected);
  assert.ok(sample(30, 0.08).gaze > Math.abs(sample(30, 0.08).accent));
  const explicit = (frame: number) =>
    evaluateActingPhases({
      frame,
      startFrame: 0,
      durationFrames: 60,
      fps: 30,
      anticipationFrames: 5,
      accentFrame: 9,
      holdFrames: 7,
      settleFrames: 6,
    });
  assert.equal(explicit(15).hold, 1);
  assert.ok(explicit(18).settle > 0 && explicit(18).settle < 1);
  assert.equal(explicit(22).accent, 0);
  assert.equal(explicit(22).settle, 0);
});

test("semantic compiler emits inspectable deterministic tracks for procedural goals", () => {
  const actions = [
    {
      id: "reach",
      type: "reach" as const,
      arm: "rightArm" as const,
      startFrame: 0,
      durationFrames: 60,
      shoulder: { x: 0, y: 0 },
      target: { x: 50, y: 30 },
      upperLength: 40,
      lowerLength: 40,
    },
    {
      id: "look",
      type: "look" as const,
      startFrame: 0,
      durationFrames: 60,
      origin: { x: 0, y: 0 },
      target: { x: 1, y: -1 },
    },
    { id: "blink", type: "blink" as const, startFrame: 20, durationFrames: 6 },
  ];
  const tracks = compileSemanticActions(actions);
  assert.deepEqual(tracks, JSON.parse(JSON.stringify(compileSemanticActions(actions))));
  const pose = mixAnimationTracks({}, tracks, 23);
  near(pose["eyes.open"]!, 0.05);
  assert.ok(pose["rightArm.rotation"] !== undefined && pose["rightForearm.rotation"] !== undefined);
  near(pose["eyes.x"]!, 1);
  near(pose["eyes.y"]!, -1);
});

test("secondary motion remains reproducible when seeking frames out of order", () => {
  const at42 = evaluateIdleMotion(42, 812, "person");
  evaluateIdleMotion(300, 812, "person");
  assert.deepEqual(evaluateIdleMotion(42, 812, "person"), at42);
  assert.notDeepEqual(evaluateIdleMotion(42, 813, "person"), at42);
  near(evaluateFollowThrough(4, 10, { amplitude: 5 }), 0);
  assert.ok(Math.abs(evaluateFollowThrough(200, 10, { amplitude: 5 })) < 0.001);
});

test("showProp attachment persists beyond gesture and a later owner supersedes it", () => {
  const scene = {
    propsById: { phone: {} },
    actionOrder: ["show", "transfer", "muted"],
    actionsById: {
      show: {
        type: "showProp",
        startFrame: 10,
        actorId: "first",
        propId: "phone",
        hand: "right" as const,
      },
      transfer: {
        type: "showProp",
        startFrame: 100,
        actorId: "second",
        propId: "phone",
        hand: "left" as const,
      },
      muted: {
        type: "showProp",
        startFrame: 120,
        actorId: "third",
        propId: "phone",
        hand: "right" as const,
        weight: 0,
      },
    },
  };
  assert.equal(resolvePersistentPropAttachments(scene, 0).phone, undefined);
  assert.equal(resolvePersistentPropAttachments(scene, 99).phone?.actorId, "first");
  assert.equal(resolvePersistentPropAttachments(scene, 500).phone?.actorId, "second");
  assert.equal(resolvePersistentPropAttachments(scene, 30).phone?.hand, "right");
});

test("pickup and place contacts switch attachment exactly at their authored contact frames", () => {
  const scene = {
    propsById: { box: {} },
    actionOrder: ["pickup", "place"],
    actionsById: {
      pickup: {
        type: "showProp",
        interaction: "pickUp" as const,
        startFrame: 10,
        durationFrames: 20,
        actorId: "actor",
        propId: "box",
        hand: "right" as const,
        acting: { accentFrame: 5 },
      },
      place: {
        type: "showProp",
        interaction: "place" as const,
        startFrame: 30,
        durationFrames: 20,
        releaseFrame: 8,
        actorId: "actor",
        propId: "box",
        hand: "right" as const,
      },
    },
  };
  assert.equal(resolvePersistentPropAttachments(scene, 14).box, undefined);
  assert.equal(resolvePersistentPropAttachments(scene, 15).box?.actorId, "actor");
  assert.equal(resolvePersistentPropAttachments(scene, 37).box?.hand, "right");
  assert.equal(resolvePersistentPropAttachments(scene, 38).box, undefined);
  assert.deepEqual(
    resolvePersistentPropAttachments(scene, 15),
    resolvePersistentPropAttachments(scene, 15),
  );
});
