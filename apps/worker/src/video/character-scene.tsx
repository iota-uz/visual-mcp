import type {
  CharacterAction,
  CharacterPack,
  CharacterSceneProps,
  CharacterTarget,
} from "@visual-canvas/video/registry";
import React, { type ReactNode } from "react";
import {
  type CharacterFaceState,
  CharacterHandsView,
  CharacterPackView,
  type CharacterPointingState,
  CharacterPropView,
} from "./character-pack-view.js";
import {
  AdvertisingOverlay,
  CameraWorld,
  EnvironmentBase,
  EnvironmentPlane,
  evaluatePresentationCamera,
  type PresentationCamera,
  presentationScreenToWorld,
} from "./character-presentation.js";
import {
  type AnimationTrack,
  compileSemanticActions,
  type EvaluatedRig,
  evaluateActingPhases,
  evaluateIdleMotion,
  evaluateRig,
  inverseMatrix,
  mixAnimationTracks,
  multiplyMatrices,
  type NumericPose,
  type RigNode,
  resolvePersistentPropAttachments,
  resolvePropAttachment,
  solveGaze,
  solveTwoBoneIK,
  transformMatrix,
  transformPoint,
  type Vec2,
} from "./character-runtime.js";

void React;

type Emotion = CharacterSceneProps["actorsById"][string]["initialEmotion"];
type Viseme = CharacterFaceState["viseme"];
type EmotionPoseSignature = {
  expressionMouthOpen: number;
  browPinch: number;
  cheekLift: number;
  eyeScaleY: number;
  mouthWidthScale: number;
  mouthCurveScale: number;
  headRotation: number;
};
/** Extra silhouette cues keep common emotions legible after 320px downscaling. */
export function emotionPoseSignature(emotion: Emotion): EmotionPoseSignature {
  switch (emotion) {
    case "angry":
      return {
        expressionMouthOpen: 0,
        browPinch: 1,
        cheekLift: 0,
        eyeScaleY: 0.48,
        mouthWidthScale: 1.08,
        mouthCurveScale: 1.65,
        headRotation: -3,
      };
    case "neutral":
      return {
        expressionMouthOpen: 0,
        browPinch: 0,
        cheekLift: 0,
        eyeScaleY: 1,
        mouthWidthScale: 0.62,
        mouthCurveScale: 0.35,
        headRotation: 0,
      };
    case "shocked":
      return {
        expressionMouthOpen: 0.72,
        browPinch: -0.55,
        cheekLift: 0,
        eyeScaleY: 1.15,
        mouthWidthScale: 0.62,
        mouthCurveScale: 1,
        headRotation: 0,
      };
    case "sad":
      return {
        expressionMouthOpen: 0,
        browPinch: -0.82,
        cheekLift: 0,
        eyeScaleY: 0.82,
        mouthWidthScale: 0.9,
        mouthCurveScale: 1.15,
        headRotation: 6,
      };
    case "happy":
      return {
        expressionMouthOpen: 0,
        browPinch: -0.18,
        cheekLift: 1,
        eyeScaleY: 0.58,
        mouthWidthScale: 1.42,
        mouthCurveScale: 1.28,
        headRotation: -2,
      };
    default:
      return {
        expressionMouthOpen: 0,
        browPinch: 0,
        cheekLift: 0,
        eyeScaleY: 1,
        mouthWidthScale: 1,
        mouthCurveScale: 1,
        headRotation: 0,
      };
  }
}
export type CharacterActorState = {
  opacity: number;
  emotion: Emotion;
  face: CharacterFaceState;
  pose: NumericPose;
  rig: EvaluatedRig;
  pointing: Partial<Record<"left" | "right", CharacterPointingState>>;
  foregroundArms: Partial<Record<"left" | "right", boolean>>;
  nodeOpacity: Record<string, number>;
};
const stageSize = (props: CharacterSceneProps) => props.stage;
const effectiveFacing = (pack: CharacterPack, requested: "left" | "right") =>
  pack.orientation?.mirror === "fixed" ? pack.orientation.canonicalFacing : requested;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const actionActive = (action: CharacterAction, frame: number) =>
  frame >= action.startFrame && frame < action.startFrame + action.durationFrames;
const actionWeight = (action: CharacterAction, frame: number) => {
  if (!actionActive(action, frame)) return 0;
  const local = frame - action.startFrame;
  const blendIn = action.blendInFrames ? smooth(local / action.blendInFrames) : 1;
  const remaining = action.durationFrames - local;
  const blendOut = action.blendOutFrames ? smooth(remaining / action.blendOutFrames) : 1;
  return action.weight * Math.min(blendIn, blendOut);
};
const propContactFrame = (action: Extract<CharacterAction, { type: "showProp" }>) =>
  action.releaseFrame ??
  (action.acting
    ? Math.min(action.durationFrames - 1, action.acting.accentFrame + action.acting.holdFrames)
    : action.durationFrames - 1);

function propRevealWeight(props: CharacterSceneProps, propId: string, frame: number) {
  const prop = props.propsById[propId];
  if (!prop || prop.initiallyVisible || prop.attachment) return 1;
  const reveal = props.actionOrder
    .map((id) => props.actionsById[id])
    .find(
      (action): action is Extract<CharacterAction, { type: "showProp" }> =>
        action?.type === "showProp" && action.propId === propId && action.weight > 0,
    );
  if (!reveal || frame < reveal.startFrame) return 0;
  const fadeFrames = Math.min(reveal.blendInFrames, reveal.durationFrames);
  return fadeFrames > 0
    ? smooth((frame - reveal.startFrame) / fadeFrames) * reveal.weight
    : reveal.weight;
}

function rigNodes(pack: CharacterPack): RigNode[] {
  const relative = (
    id: keyof CharacterPack["rig"],
    parentId?: keyof CharacterPack["rig"],
  ): RigNode => {
    const point = pack.rig[id],
      parent = parentId ? pack.rig[parentId] : { x: 0, y: 0 };
    return {
      id,
      parentId,
      transform: { x: point.x - parent.x, y: point.y - parent.y },
    };
  };
  return [
    relative("root"),
    relative("body", "root"),
    relative("head", "root"),
    relative("eyes", "head"),
    relative("mouth", "head"),
    relative("leftShoulder", "body"),
    relative("leftElbow", "leftShoulder"),
    relative("leftHand", "leftElbow"),
    relative("rightShoulder", "body"),
    relative("rightElbow", "rightShoulder"),
    relative("rightHand", "rightElbow"),
  ];
}

function bodyMask(action: CharacterAction) {
  return action.mask?.flatMap((part) => {
    if (part === "transform") return ["root"];
    if (part === "gaze") return ["eyes"];
    if (part === "emotion") return ["face"];
    if (part === "leftArm" || part === "rightArm") return [part, part.replace("Arm", "Forearm")];
    return [part];
  });
}
function actionOwns(action: CharacterAction, channel: "mouth" | "emotion") {
  return !action.mask || action.mask.includes(channel);
}
function adaptTracks(action: CharacterAction, tracks: AnimationTrack[]): AnimationTrack[] {
  return tracks.map((track) => ({
    ...track,
    priority: action.priority,
    weight: action.weight,
    fadeInFrames: action.blendInFrames,
    fadeOutFrames: action.blendOutFrames,
    bodyMask: bodyMask(action),
  }));
}
function staticTrack(
  id: string,
  action: CharacterAction,
  channel: string,
  value: number,
  mode: AnimationTrack["mode"] = "override",
): AnimationTrack {
  return {
    id: `${id}:${channel}`,
    channel,
    layer: action.type,
    priority: action.priority,
    mode,
    startFrame: action.startFrame,
    durationFrames: action.durationFrames,
    keyframes: [{ frame: 0, value }],
    weight: action.weight,
    fadeInFrames: action.blendInFrames,
    fadeOutFrames: action.blendOutFrames,
    bodyMask: bodyMask(action),
  };
}
function nodePose(pose: NumericPose, node: string) {
  const result: Partial<{
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  }> = {};
  for (const property of ["x", "y", "rotation", "scaleX", "scaleY"] as const) {
    const value = pose[`${node}.${property}`];
    if (value !== undefined) result[property] = value;
  }
  return result;
}

function actorWorldPoint(
  props: CharacterSceneProps,
  actorId: string,
  positions: Record<string, Vec2>,
): Vec2 | undefined {
  const position = positions[actorId],
    actor = props.actorsById[actorId];
  const pack = actor && props.characterPacksById[actor.characterPackId];
  if (!position || !actor || !pack) return undefined;
  const facing = effectiveFacing(pack, actor.facing);
  return {
    x: position.x + pack.rig.head.x * actor.scale * (facing === "left" ? -1 : 1),
    y: position.y + pack.rig.head.y * actor.scale,
  };
}
function targetPoint(
  target: CharacterTarget,
  props: CharacterSceneProps,
  positions: Record<string, Vec2>,
  propsAt: Record<string, Vec2>,
  frame: number,
  camera?: PresentationCamera,
): Vec2 {
  const { width, height } = stageSize(props);
  if (target.kind === "camera") return { x: width / 2, y: height / 2 };
  if (target.kind === "point") return { x: target.x * width, y: target.y * height };
  if (target.kind === "actor")
    return (
      actorWorldPoint(props, target.actorId, positions) ?? {
        x: width / 2,
        y: height / 2,
      }
    );
  if (target.kind === "prop") return propsAt[target.propId] ?? { x: width / 2, y: height / 2 };
  const overlay = props.overlaysById[target.overlayId];
  return overlay
    ? presentationScreenToWorld(
        camera ?? evaluatePresentationCamera(props, frame),
        {
          x: overlay.x * width,
          y: overlay.y * height,
        },
        props.stage,
      )
    : { x: width / 2, y: height / 2 };
}
function limbLengths(pack: CharacterPack, side: "left" | "right") {
  const shoulder = pack.rig[`${side}Shoulder`],
    elbow = pack.rig[`${side}Elbow`],
    hand = pack.rig[`${side}Hand`];
  return {
    upperLength: Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y),
    lowerLength: Math.hypot(hand.x - elbow.x, hand.y - elbow.y),
  };
}
function armTracks(
  id: string,
  action: CharacterAction,
  pack: CharacterPack,
  side: "left" | "right",
  localTarget: Vec2,
  fps: number,
): AnimationTrack[] {
  const absoluteShoulder = pack.rig[`${side}Shoulder`],
    elbow = pack.rig[`${side}Elbow`],
    hand = pack.rig[`${side}Hand`];
  const shoulder = {
    x: absoluteShoulder.x - pack.rig.body.x,
    y: absoluteShoulder.y - pack.rig.body.y,
  };
  const solved = solveTwoBoneIK({
    shoulder,
    target: localTarget,
    ...limbLengths(pack, side),
    bend:
      pack.motion.elbowBend === "outward" ? (side === "left" ? -1 : 1) : side === "left" ? 1 : -1,
  });
  const restUpper =
    (Math.atan2(elbow.y - absoluteShoulder.y, elbow.x - absoluteShoulder.x) * 180) / Math.PI;
  const restLower = (Math.atan2(hand.y - elbow.y, hand.x - elbow.x) * 180) / Math.PI - restUpper;
  const anticipation = Math.min(
    action.acting?.anticipationFrames ?? Math.round(0.16 * fps),
    action.durationFrames - 1,
  );
  const accent = Math.min(
    action.acting?.accentFrame ?? anticipation + Math.round(0.1 * fps),
    action.durationFrames - 1,
  );
  const actingTrack = (channel: string, value: number) => ({
    ...staticTrack(id, action, channel, value),
    keyframes: action.acting
      ? [
          { frame: 0, value: 0 },
          { frame: anticipation, value: value * -0.16, easing: "smooth" as const },
          { frame: accent, value, easing: "smooth" as const },
          {
            frame: Math.min(action.durationFrames - 1, accent + action.acting.holdFrames),
            value,
          },
          {
            frame: Math.min(
              action.durationFrames - 1,
              accent + action.acting.holdFrames + action.acting.settleFrames,
            ),
            value: 0,
            easing: "smooth" as const,
          },
          { frame: action.durationFrames - 1, value: 0 },
        ]
      : [
          { frame: 0, value: 0 },
          { frame: anticipation, value: value * -0.16, easing: "smooth" as const },
          { frame: accent, value, easing: "smooth" as const },
          { frame: action.durationFrames - 1, value },
        ],
  });
  return [
    actingTrack(`${side}Arm.rotation`, solved.shoulderRotation - restUpper),
    actingTrack(`${side}Forearm.rotation`, solved.elbowRotation - restLower),
  ];
}

function actingPhases(props: CharacterSceneProps, action: CharacterAction, frame: number) {
  const fps = props.timebase.numerator / props.timebase.denominator;
  return evaluateActingPhases({
    frame,
    startFrame: action.startFrame,
    durationFrames: action.durationFrames,
    fps,
    intensity: 1,
    stillness: action.acting?.stillness,
    anticipationFrames: action.acting?.anticipationFrames,
    accentFrame: action.acting?.accentFrame,
    holdFrames: action.acting?.holdFrames,
    settleFrames: action.acting?.settleFrames,
    gazeLeadFrames: action.acting?.gazeLeadFrames,
    secondaryDelayFrames: action.acting?.secondaryDelayFrames,
  });
}
function gestureTarget(
  pack: CharacterPack,
  preset: CharacterPack["capabilities"]["gestures"][number],
  side: "left" | "right",
  intensity: number,
): Vec2 {
  const sign = side === "left" ? -1 : 1;
  let authoredTarget: Vec2;
  if (["point", "present", "emphasize", "count"].includes(preset))
    authoredTarget = { x: sign * 150, y: 125 };
  else if (["explain", "wave", "greet", "beckon", "applaud", "celebrate"].includes(preset))
    authoredTarget = { x: sign * 175, y: -55 };
  else if (["shrug", "surprised", "agree", "disagree", "nod", "shake"].includes(preset))
    authoredTarget = { x: sign * 165, y: 18 };
  else if (["hands-on-hips", "confident", "thumbs-up", "thumbs-down", "dismiss"].includes(preset))
    authoredTarget = { x: sign * 120, y: 145 };
  else
    authoredTarget =
      side === "right"
        ? { x: pack.rig.mouth.x + 35, y: pack.rig.mouth.y + 32 }
        : { x: -145, y: 105 };
  const rest = pack.rig[`${side}Hand`];
  const amount = clamp(intensity);
  const variant = pack.capabilities.gestures.indexOf(preset);
  authoredTarget = {
    x: authoredTarget.x + sign * ((variant % 5) - 2) * 9,
    y: authoredTarget.y + (Math.floor(variant / 5) - 2) * 8,
  };
  return {
    x: rest.x + (authoredTarget.x - rest.x) * amount - pack.rig.body.x,
    y: rest.y + (authoredTarget.y - rest.y) * amount - pack.rig.body.y,
  };
}

function locomotionPose(props: CharacterSceneProps, actorId: string, frame: number): NumericPose {
  const actor = props.actorsById[actorId]!;
  const pack = props.characterPacksById[actor.characterPackId]!;
  const { width, height } = stageSize(props);
  const baseX = actor.x * width,
    baseY = actor.y * height;
  type Movement =
    | Extract<CharacterAction, { type: "enter" }>
    | Extract<CharacterAction, { type: "move" }>
    | Extract<CharacterAction, { type: "exit" }>;
  const allMovement = props.actionOrder
    .map((id, authoredOrder) => [id, props.actionsById[id], authoredOrder] as const)
    .filter((entry): entry is readonly [string, Movement, number] =>
      Boolean(
        entry[1] &&
          entry[1].actorId === actorId &&
          ["enter", "move", "exit"].includes(entry[1].type) &&
          entry[1].weight > 0,
      ),
    )
    .sort((a, b) => a[1].startFrame - b[1].startFrame || a[2] - b[2]);
  if (allMovement.length === 0) return { "root.x": baseX, "root.y": baseY };
  const halfWidth = (pack.viewBox.width * actor.scale) / 2;
  const margin = Math.max(32, halfWidth * 0.12);
  const memo = new Map<string, Vec2>();
  const sample = (atFrame: number, limit: number): Vec2 => {
    const memoKey = `${atFrame}:${limit}`;
    const memoized = memo.get(memoKey);
    if (memoized) return memoized;
    let current = { x: baseX, y: baseY };
    let active: { priority: number; order: number; point: Vec2 } | undefined;
    for (let order = 0; order < limit; order += 1) {
      const action = allMovement[order]![1];
      const from =
        action.type === "enter"
          ? {
              x: action.from === "left" ? -halfWidth - margin : width + halfWidth + margin,
              y: baseY,
            }
          : sample(action.startFrame, order);
      const to =
        action.type === "exit"
          ? {
              x: action.to === "left" ? -halfWidth - margin : width + halfWidth + margin,
              y: from.y,
            }
          : action.type === "move"
            ? { x: action.to.x * width, y: action.to.y * height }
            : { x: baseX, y: baseY };
      if (atFrame < action.startFrame) {
        if (action.type === "enter" && !active && current.x === baseX && current.y === baseY)
          current = from;
        break;
      }
      const weightedTo = {
        x: from.x + (to.x - from.x) * action.weight,
        y: from.y + (to.y - from.y) * action.weight,
      };
      if (atFrame < action.startFrame + action.durationFrames) {
        const local = atFrame - action.startFrame;
        const duration = Math.max(1, action.durationFrames - 1);
        const linear = clamp(local / duration);
        const blendIn = Math.min(action.blendInFrames, duration);
        const blendOut = Math.min(action.blendOutFrames, duration);
        const progress =
          blendIn > 0 && local < blendIn
            ? smooth(local / blendIn) * (blendIn / duration)
            : blendOut > 0 && duration - local < blendOut
              ? 1 - smooth((duration - local) / blendOut) * (blendOut / duration)
              : linear;
        const bounce =
          action.type === "move" && action.style === "bounce"
            ? -Math.sin(Math.PI * progress) * Math.max(16, pack.viewBox.height * actor.scale * 0.06)
            : 0;
        const point = {
          x: from.x + (weightedTo.x - from.x) * progress,
          y: from.y + (weightedTo.y - from.y) * progress + bounce * action.weight,
        };
        if (
          !active ||
          action.priority > active.priority ||
          (action.priority === active.priority && order > active.order)
        )
          active = { priority: action.priority, order, point };
        continue;
      }
      current = weightedTo;
    }
    const result = active?.point ?? current;
    memo.set(memoKey, result);
    return result;
  };
  const point = sample(frame, allMovement.length);
  return { "root.x": point.x, "root.y": point.y };
}
function actorOpacity(props: CharacterSceneProps, actorId: string, frame: number) {
  const entrances = props.actionOrder
    .map((id) => props.actionsById[id])
    .filter(
      (action): action is Extract<CharacterAction, { type: "enter" }> =>
        action?.type === "enter" && action.actorId === actorId && action.weight > 0,
    );
  const exit = [...props.actionOrder]
    .reverse()
    .map((id) => props.actionsById[id])
    .find(
      (action): action is Extract<CharacterAction, { type: "exit" }> =>
        action?.type === "exit" &&
        action.actorId === actorId &&
        action.weight > 0 &&
        action.startFrame <= frame,
    );
  if (exit) {
    const progress = clamp((frame - exit.startFrame) / Math.max(1, exit.durationFrames - 1));
    return 1 - smooth(progress) * exit.weight;
  }
  if (entrances.length === 0) return 1;
  const enter =
    [...entrances].reverse().find((candidate) => candidate.startFrame <= frame) ?? entrances[0]!;
  return frame < enter.startFrame
    ? 0
    : enter.weight * smooth((frame - enter.startFrame) / Math.min(12, enter.durationFrames));
}
function resolveViseme(props: CharacterSceneProps, actorId: string, frame: number) {
  const active = props.actionOrder
    .map((id) => ({ id, action: props.actionsById[id] }))
    .filter(
      (
        entry,
      ): entry is {
        id: string;
        action: Extract<CharacterAction, { type: "talk" }>;
      } =>
        Boolean(
          entry.action?.type === "talk" &&
            entry.action.actorId === actorId &&
            actionActive(entry.action, frame) &&
            entry.action.weight > 0 &&
            actionOwns(entry.action, "mouth"),
        ),
    );
  if (active.length === 0) return { viseme: "rest" as Viseme, mouthOpen: 0 };
  const samples = active.map(({ id, action }) => {
    const local = frame - action.startFrame;
    let current = action.visemes[0]!,
      nextFrame = action.durationFrames;
    for (const candidate of action.visemes) {
      if (candidate.frame > local) {
        nextFrame = candidate.frame;
        break;
      }
      current = candidate;
    }
    const transitionFrames = Math.max(
      1,
      Math.round((props.timebase.numerator / props.timebase.denominator) * 0.05),
    );
    const envelope = Math.min(
      smooth((local - current.frame) / transitionFrames),
      smooth((nextFrame - local) / transitionFrames),
    );
    return {
      id,
      priority: action.priority,
      weight: clamp(actionWeight(action, frame)),
      viseme: current.shape,
      open: current.shape === "rest" || current.shape === "m" ? 0 : 0.45 + 0.55 * envelope,
    };
  });
  const groups = new Map<number, typeof samples>();
  for (const sample of samples) {
    const group = groups.get(sample.priority) ?? [];
    group.push(sample);
    groups.set(sample.priority, group);
  }
  let mouthOpen = 0;
  for (const priority of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(priority)!;
    const total = group.reduce((sum, sample) => sum + sample.weight, 0);
    if (total <= 0) continue;
    const alpha = clamp(total);
    const groupOpen = group.reduce((sum, sample) => sum + sample.open * sample.weight, 0) / total;
    mouthOpen = mouthOpen * (1 - alpha) + groupOpen * alpha;
  }
  let remaining = 1;
  const contributions = [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .map(([priority, group]) => {
      const total = group.reduce((sum, sample) => sum + sample.weight, 0);
      const alpha = clamp(total);
      const selected = [...group].sort(
        (a, b) => b.weight - a.weight || a.id.localeCompare(b.id),
      )[0]!;
      const contribution = remaining * alpha;
      remaining *= 1 - alpha;
      return { priority, selected, contribution };
    });
  const visible = [...contributions].sort(
    (a, b) =>
      b.contribution - a.contribution ||
      b.priority - a.priority ||
      a.selected.id.localeCompare(b.selected.id),
  )[0];
  return {
    viseme: visible ? visible.selected.viseme : ("rest" as Viseme),
    mouthOpen,
  };
}

function evaluateActor(
  props: CharacterSceneProps,
  actorId: string,
  frame: number,
  positions: Record<string, Vec2>,
  propsAt: Record<string, Vec2>,
  camera?: PresentationCamera,
): CharacterActorState {
  const actor = props.actorsById[actorId]!,
    pack = props.characterPacksById[actor.characterPackId]!;
  const facing = effectiveFacing(pack, actor.facing);
  const locomotion = locomotionPose(props, actorId, frame);
  // Pack motion periods are authored against the engine's 30fps reference
  // timebase; resampling keeps ambient motion at the same real-time speed.
  const idleFrame = frame * (30 / (props.timebase.numerator / props.timebase.denominator));
  const idle = evaluateIdleMotion(idleFrame, props.seed, actorId, {
    amplitude: pack.motion.breathingAmplitude / 100,
    frequency: (Math.PI * 2) / pack.motion.breathingPeriodFrames,
    blinkPeriodFrames: pack.motion.blinkIntervalFrames,
  });
  const initial = pack.expressions[actor.initialEmotion];
  const initialSignature = emotionPoseSignature(actor.initialEmotion);
  const base: NumericPose = {
    ...locomotion,
    "root.rotation": (idle["head.rotation"] ?? 0) * pack.motion.swayDegrees,
    "body.scaleX": idle["body.scaleX"] ?? 1,
    "body.scaleY": idle["body.scaleY"] ?? 1,
    "eyes.open": pack.capabilities.blink ? (idle["eyes.open"] ?? 1) : 1,
    "eyes.x": facing === "left" ? -pack.motion.gazeLimit * 0.25 : pack.motion.gazeLimit * 0.25,
    "eyes.y": 0,
    "head.rotation": initialSignature.headRotation,
    "mouth.open": 0,
    "face.browTilt": initial.browTilt,
    "face.mouthCurve": initial.mouthCurve,
    "face.eyeOpen": initial.eyeOpen,
    "face.expressionMouthOpen": initialSignature.expressionMouthOpen,
    "face.browPinch": initialSignature.browPinch,
    "face.cheekLift": initialSignature.cheekLift,
    "face.eyeScaleY": initialSignature.eyeScaleY,
    "face.mouthWidthScale": initialSignature.mouthWidthScale,
    "face.mouthCurveScale": initialSignature.mouthCurveScale,
    "leftArm.rotation": 0,
    "leftForearm.rotation": 0,
    "rightArm.rotation": 0,
    "rightForearm.rotation": 0,
  };
  for (const node of [
    "root",
    "body",
    "head",
    "eyes",
    "mouth",
    "leftShoulder",
    "leftElbow",
    "leftHand",
    "rightShoulder",
    "rightElbow",
    "rightHand",
  ]) {
    base[`${node}.scaleX`] ??= 1;
    base[`${node}.scaleY`] ??= 1;
    base[`${node}.opacity`] ??= 1;
  }
  const actorMatrix = transformMatrix({
    x: locomotion["root.x"]!,
    y: locomotion["root.y"]!,
    rotation: base["root.rotation"]!,
    scaleX: actor.scale * (facing === "left" ? -1 : 1),
    scaleY: actor.scale,
  });
  const toLocal = inverseMatrix(actorMatrix),
    tracks: AnimationTrack[] = [];
  const pointing: Partial<Record<"left" | "right", CharacterPointingState>> = {};
  const foregroundArms: Partial<Record<"left" | "right", boolean>> = {};
  const pointingPriority: Partial<Record<"left" | "right", number>> = {};
  const armRequests: {
    id: string;
    action: CharacterAction;
    side: "left" | "right";
    target: { space: "body" | "world"; point: Vec2 };
  }[] = [];
  const emotionCandidates = new Set<Emotion>([actor.initialEmotion]);
  let emotion = actor.initialEmotion,
    emotionPriority = -101;
  for (const id of props.actionOrder) {
    const action = props.actionsById[id];
    if (!action || action.actorId !== actorId || ["enter", "move", "exit"].includes(action.type))
      continue;
    if (action.type === "animate") {
      for (const [index, authored] of action.tracks.entries()) {
        const node =
          authored.node === "leftElbow"
            ? "leftForearm"
            : authored.node === "rightElbow"
              ? "rightForearm"
              : authored.node;
        tracks.push({
          id: `${id}:animate:${index}`,
          channel: `${node}.${authored.property}`,
          layer: "animate",
          priority: action.priority,
          mode: authored.mode,
          startFrame: action.startFrame,
          durationFrames: action.durationFrames,
          keyframes: authored.keyframes,
          weight: action.weight,
          fadeInFrames: action.blendInFrames,
          fadeOutFrames: action.blendOutFrames,
          bodyMask: bodyMask(action),
        });
      }
      continue;
    }
    if (
      action.type === "gesture" ||
      action.type === "point" ||
      action.type === "showProp" ||
      action.type === "react"
    ) {
      const secondary = actingPhases(props, action, frame).secondary;
      const side = "hand" in action && action.hand === "left" ? -1 : 1;
      tracks.push(
        staticTrack(`${id}:secondary`, action, "head.rotation", secondary * side * 3, "additive"),
      );
    }
    if (
      (action.type === "react" || (action.type === "talk" && action.emotion)) &&
      actionActive(action, frame) &&
      action.weight > 0 &&
      actionOwns(action, "emotion")
    ) {
      const nextEmotion = action.type === "react" ? action.preset : action.emotion!;
      emotionCandidates.add(nextEmotion);
      if (action.priority >= emotionPriority) {
        emotionPriority = action.priority;
        emotion = nextEmotion;
      }
      const expression = pack.expressions[nextEmotion];
      const signature = emotionPoseSignature(nextEmotion);
      tracks.push(
        staticTrack(id, action, "face.browTilt", expression.browTilt),
        staticTrack(id, action, "face.mouthCurve", expression.mouthCurve),
        staticTrack(id, action, "face.eyeOpen", expression.eyeOpen),
        staticTrack(id, action, "face.expressionMouthOpen", signature.expressionMouthOpen),
        staticTrack(id, action, "face.browPinch", signature.browPinch),
        staticTrack(id, action, "face.cheekLift", signature.cheekLift),
        staticTrack(id, action, "face.eyeScaleY", signature.eyeScaleY),
        staticTrack(id, action, "face.mouthWidthScale", signature.mouthWidthScale),
        staticTrack(id, action, "face.mouthCurveScale", signature.mouthCurveScale),
        staticTrack(
          `${id}:emotion-posture`,
          action,
          "head.rotation",
          signature.headRotation - initialSignature.headRotation,
          "additive",
        ),
      );
    }
    if (action.type === "face") {
      if (action.browTilt !== undefined)
        tracks.push(staticTrack(id, action, "face.browTilt", action.browTilt));
      if (action.eyeOpen !== undefined)
        tracks.push(staticTrack(id, action, "face.eyeOpen", action.eyeOpen));
      if (action.mouthCurve !== undefined)
        tracks.push(staticTrack(id, action, "face.mouthCurve", action.mouthCurve));
      if (action.headTilt !== undefined)
        tracks.push(staticTrack(id, action, "head.rotation", action.headTilt, "additive"));
    } else if (action.type === "look") {
      const gaze =
        action.target.kind === "camera"
          ? { gazeX: 0, gazeY: 0, headRotation: 0 }
          : solveGaze({
              origin: pack.rig.eyes,
              target: transformPoint(
                toLocal,
                targetPoint(action.target, props, positions, propsAt, frame, camera),
              ),
              responseDistance: Math.max(pack.viewBox.width, pack.viewBox.height) * 0.5,
              maxEyeOffsetX: pack.motion.gazeLimit,
              maxEyeOffsetY: pack.motion.gazeLimit * 0.75,
              maxHeadRotation: pack.motion.headTurnDegrees,
            });
      tracks.push(
        staticTrack(id, action, "eyes.x", gaze.gazeX),
        staticTrack(id, action, "eyes.y", gaze.gazeY),
        staticTrack(id, action, "head.rotation", gaze.headRotation, "additive"),
      );
    } else if (action.type === "blink") {
      tracks.push(
        ...adaptTracks(
          action,
          compileSemanticActions([
            {
              id,
              type: "blink",
              startFrame: action.startFrame,
              durationFrames: action.durationFrames,
            },
          ]),
        ).map((track) => ({
          ...track,
          // The blink keyframes already own close/open easing. Applying the
          // action's default blend a second time prevents the midpoint from
          // ever reaching the authored closed value.
          fadeInFrames: 0,
          fadeOutFrames: 0,
        })),
      );
    } else if (action.type === "gesture") {
      if (action.preset === "nod" || action.preset === "agree")
        tracks.push({
          ...staticTrack(`${id}:nod`, action, "head.rotation", 0, "additive"),
          keyframes: [
            { frame: 0, value: 0 },
            { frame: Math.floor(action.durationFrames * 0.3), value: 8 * action.intensity },
            { frame: Math.floor(action.durationFrames * 0.65), value: -3 * action.intensity },
            { frame: action.durationFrames - 1, value: 0 },
          ],
        });
      if (action.preset === "shake" || action.preset === "disagree")
        tracks.push({
          ...staticTrack(`${id}:shake`, action, "head.rotation", 0, "additive"),
          keyframes: [
            { frame: 0, value: 0 },
            { frame: Math.floor(action.durationFrames * 0.25), value: 10 * action.intensity },
            { frame: Math.floor(action.durationFrames * 0.5), value: -10 * action.intensity },
            { frame: Math.floor(action.durationFrames * 0.75), value: 7 * action.intensity },
            { frame: action.durationFrames - 1, value: 0 },
          ],
        });
      const sides =
        action.hand === "both" ? (["left", "right"] as const) : ([action.hand] as const);
      for (const side of sides)
        armRequests.push({
          id,
          action,
          side,
          target: {
            space: "body",
            point: gestureTarget(pack, action.preset, side, action.intensity),
          },
        });
      if (
        action.preset === "think" &&
        actionActive(action, frame) &&
        actionWeight(action, frame) > 0
      )
        for (const side of sides) foregroundArms[side] = true;
    } else if (action.type === "point") {
      const point = targetPoint(action.target, props, positions, propsAt, frame, camera);
      armRequests.push({
        id,
        action,
        side: action.hand,
        target: {
          space: "world",
          point,
        },
      });
      const gaze = solveGaze({
        origin: pack.rig.eyes,
        target: transformPoint(toLocal, point),
        responseDistance: Math.max(pack.viewBox.width, pack.viewBox.height) * 0.5,
        maxEyeOffsetX: pack.motion.gazeLimit,
        maxEyeOffsetY: pack.motion.gazeLimit * 0.75,
        maxHeadRotation: pack.motion.headTurnDegrees,
      });
      const gazeAction = {
        ...action,
        startFrame:
          action.startFrame -
          (action.acting?.gazeLeadFrames ??
            Math.round((props.timebase.numerator / props.timebase.denominator) * 0.12)),
        durationFrames:
          action.durationFrames +
          (action.acting?.gazeLeadFrames ??
            Math.round((props.timebase.numerator / props.timebase.denominator) * 0.12)),
      };
      tracks.push(
        staticTrack(`${id}:attention`, gazeAction, "eyes.x", gaze.gazeX),
        staticTrack(`${id}:attention`, gazeAction, "eyes.y", gaze.gazeY),
        staticTrack(`${id}:attention`, gazeAction, "head.rotation", gaze.headRotation, "additive"),
      );
      if (
        actionActive(action, frame) &&
        actionWeight(action, frame) > 0 &&
        action.priority >= (pointingPriority[action.hand] ?? Number.NEGATIVE_INFINITY)
      ) {
        pointing[action.hand] = {
          target: point,
          weight: clamp(actionWeight(action, frame)),
        };
        pointingPriority[action.hand] = action.priority;
      }
    } else if (action.type === "showProp") {
      const pickupTarget = propsAt[action.propId] ?? {
        x: props.propsById[action.propId]!.x * props.stage.width,
        y: props.propsById[action.propId]!.y * props.stage.height,
      };
      armRequests.push({
        id,
        action,
        side: action.hand,
        target: action.target
          ? {
              space: "world",
              point: targetPoint(action.target, props, positions, propsAt, frame, camera),
            }
          : action.interaction === "pickUp"
            ? { space: "world", point: pickupTarget }
            : {
                space: "body",
                point: {
                  x:
                    (action.hand === "left" ? -1 : 1) * Math.min(145, pack.viewBox.width * 0.4) -
                    pack.rig.body.x,
                  y: 24 - pack.rig.body.y,
                },
              },
      });
    } else if (action.type === "react") {
      const intensity = action.intensity * (action.preset === "shocked" ? 0.18 : 0.07);
      tracks.push(
        ...adaptTracks(
          action,
          compileSemanticActions([
            {
              id,
              type: "squash",
              startFrame: action.startFrame,
              durationFrames: action.durationFrames,
              intensity,
            },
          ]),
        ),
      );
    }
  }
  const poseWithoutArms = mixAnimationTracks(base, tracks, frame);
  const bodyMatrix = multiplyMatrices(
    actorMatrix,
    transformMatrix({
      x: pack.rig.body.x,
      y: pack.rig.body.y,
      rotation: 0,
      scaleX: poseWithoutArms["body.scaleX"] ?? 1,
      scaleY: poseWithoutArms["body.scaleY"] ?? 1,
    }),
  );
  const worldToBody = inverseMatrix(bodyMatrix);
  for (const request of armRequests) {
    const target =
      request.target.space === "world"
        ? transformPoint(worldToBody, request.target.point)
        : request.target.point;
    const shoulder = pack.rig[`${request.side}Shoulder`];
    const shoulderPoint = {
      x: shoulder.x - pack.rig.body.x,
      y: shoulder.y - pack.rig.body.y,
    };
    const eyes = {
      x: pack.rig.eyes.x - pack.rig.body.x,
      y: pack.rig.eyes.y - pack.rig.body.y,
    };
    const headClearance =
      pack.style.eyeSpacing / 2 + pack.style.eyeRadius + pack.style.handRadius * 1.5;
    const aboveFace = target.y < eyes.y + pack.style.eyeRadius * 3;
    const sideSign = request.side === "left" ? -1 : 1;
    const sameSideX =
      request.side === "left"
        ? Math.min(target.x, shoulderPoint.x - 40)
        : Math.max(target.x, shoulderPoint.x + 40);
    const lengths = limbLengths(pack, request.side);
    const safeReach = (lengths.upperLength + lengths.lowerLength) * 0.94;
    const desiredWristX = eyes.x + sideSign * headClearance;
    const wristX =
      Math.abs(desiredWristX - shoulderPoint.x) <= safeReach
        ? desiredWristX
        : shoulderPoint.x + sideSign * safeReach * 0.86;
    const remainingYReach = Math.sqrt(
      Math.max(0, safeReach ** 2 - (wristX - shoulderPoint.x) ** 2),
    );
    const wristY = clamp(
      target.y,
      Math.max(shoulderPoint.y - remainingYReach, eyes.y - pack.style.eyeRadius * 1.5),
      Math.min(shoulderPoint.y + remainingYReach, eyes.y + pack.style.eyeRadius * 2.5),
    );
    const routedTarget =
      request.action.type === "point"
        ? {
            ...target,
            // A distant semantic target remains the finger direction. The IK
            // wrist itself uses a reachable side anchor so arm normalization
            // cannot drag the glove back across the face.
            x: aboveFace ? wristX : sameSideX,
            y: aboveFace ? wristY : target.y,
          }
        : target;
    tracks.push(
      ...armTracks(
        request.id,
        request.action,
        pack,
        request.side,
        routedTarget,
        props.timebase.numerator / props.timebase.denominator,
      ),
    );
  }
  const pose = mixAnimationTracks(base, tracks, frame);
  emotion = [...emotionCandidates].sort().reduce((best, candidate) => {
    const distance = (name: Emotion) => {
      const expression = pack.expressions[name];
      return (
        (pose["face.browTilt"]! - expression.browTilt) ** 2 +
        (pose["face.mouthCurve"]! - expression.mouthCurve) ** 2 +
        (pose["face.eyeOpen"]! - expression.eyeOpen) ** 2
      );
    };
    return distance(candidate) < distance(best) ? candidate : best;
  }, actor.initialEmotion);
  const rig = evaluateRig(
    rigNodes(pack),
    {
      body: nodePose(pose, "body"),
      head: nodePose(pose, "head"),
      eyes: nodePose(pose, "eyes"),
      mouth: nodePose(pose, "mouth"),
      leftShoulder: { ...nodePose(pose, "leftArm"), ...nodePose(pose, "leftShoulder") },
      leftElbow: { ...nodePose(pose, "leftForearm"), ...nodePose(pose, "leftElbow") },
      leftHand: nodePose(pose, "leftHand"),
      rightShoulder: { ...nodePose(pose, "rightArm"), ...nodePose(pose, "rightShoulder") },
      rightElbow: { ...nodePose(pose, "rightForearm"), ...nodePose(pose, "rightElbow") },
      rightHand: nodePose(pose, "rightHand"),
    },
    {
      x: pose["root.x"]!,
      y: pose["root.y"]!,
      rotation: pose["root.rotation"]!,
      scaleX: actor.scale * (facing === "left" ? -1 : 1) * (pose["root.scaleX"] ?? 1),
      scaleY: actor.scale * (pose["root.scaleY"] ?? 1),
    },
  );
  const speech = resolveViseme(props, actorId, frame);
  return {
    opacity: actorOpacity(props, actorId, frame) * (pose["root.opacity"] ?? 1),
    emotion,
    pose,
    rig,
    pointing,
    foregroundArms,
    nodeOpacity: Object.fromEntries(
      [
        "body",
        "head",
        "eyes",
        "mouth",
        "leftShoulder",
        "leftElbow",
        "leftHand",
        "rightShoulder",
        "rightElbow",
        "rightHand",
      ].map((node) => [
        node,
        clamp(
          pose[`${node}.opacity`] ??
            pose[
              `${node === "leftShoulder" ? "leftArm" : node === "rightShoulder" ? "rightArm" : node === "leftElbow" ? "leftForearm" : node === "rightElbow" ? "rightForearm" : node}.opacity`
            ] ??
            1,
        ),
      ]),
    ),
    face: {
      gazeX: pose["eyes.x"]!,
      gazeY: pose["eyes.y"]!,
      eyeOpen: pose["eyes.open"]! * pose["face.eyeOpen"]!,
      browTilt: pose["face.browTilt"]!,
      mouthCurve: pose["face.mouthCurve"]!,
      expressionMouthOpen: pose["face.expressionMouthOpen"]!,
      browPinch: pose["face.browPinch"]!,
      cheekLift: pose["face.cheekLift"]!,
      eyeScaleY: pose["face.eyeScaleY"]!,
      mouthWidthScale: pose["face.mouthWidthScale"]!,
      mouthCurveScale: pose["face.mouthCurveScale"]!,
      viseme: speech.viseme,
      mouthOpen: speech.mouthOpen,
    },
  };
}

export function evaluateCharacterActors(
  props: CharacterSceneProps,
  frame: number,
  camera?: PresentationCamera,
): Record<string, CharacterActorState> {
  for (const id of props.actionOrder) {
    const action = props.actionsById[id];
    if (action?.type !== "showProp" || action.interaction !== "pickUp" || action.weight === 0)
      continue;
    const actor = props.actorsById[action.actorId]!;
    const pack = props.characterPacksById[actor.characterPackId]!;
    const prop = props.propsById[action.propId]!;
    const facing = effectiveFacing(pack, actor.facing) === "left" ? -1 : 1;
    const shoulder = pack.rig[`${action.hand}Shoulder`];
    const shoulderWorld = {
      x: actor.x * props.stage.width + shoulder.x * actor.scale * facing,
      y: actor.y * props.stage.height + shoulder.y * actor.scale,
    };
    const lengths = limbLengths(pack, action.hand);
    const reach = (lengths.upperLength + lengths.lowerLength) * actor.scale;
    const distance = Math.hypot(
      prop.x * props.stage.width - shoulderWorld.x,
      prop.y * props.stage.height - shoulderWorld.y,
    );
    if (distance > reach + Math.max(prop.width, prop.height) * prop.scale * 0.1)
      throw new Error(`Unreachable pickup contact: ${action.propId}`);
  }
  const positions = Object.fromEntries(
    props.actorOrder.map((id) => {
      const p = locomotionPose(props, id, frame);
      return [id, { x: p["root.x"]!, y: p["root.y"]! }];
    }),
  );
  const attached = resolvePersistentPropAttachments(props, frame);
  const propsAt: Record<string, Vec2> = Object.fromEntries(
    props.propOrder.map((id) => [
      id,
      {
        x: props.propsById[id]!.x * props.stage.width,
        y: props.propsById[id]!.y * props.stage.height,
      },
    ]),
  );
  for (const id of props.propOrder) {
    const released = props.actionOrder
      .map((actionId) => props.actionsById[actionId])
      .filter((action): action is Extract<CharacterAction, { type: "showProp" }> =>
        Boolean(
          action?.type === "showProp" &&
            action.weight > 0 &&
            action.propId === id &&
            (action.interaction === "place" || action.interaction === "release") &&
            frame >= action.startFrame + propContactFrame(action),
        ),
      )
      .at(-1);
    if (!released) continue;
    const contactFrame = released.startFrame + propContactFrame(released) - 1;
    const contactPositions = Object.fromEntries(
      props.actorOrder.map((actorId) => {
        const pose = locomotionPose(props, actorId, contactFrame);
        return [actorId, { x: pose["root.x"]!, y: pose["root.y"]! }];
      }),
    );
    const contactPropsAt = Object.fromEntries(
      props.propOrder.map((propId) => [
        propId,
        {
          x: props.propsById[propId]!.x * props.stage.width,
          y: props.propsById[propId]!.y * props.stage.height,
        },
      ]),
    );
    const contactState = evaluateActor(
      props,
      released.actorId,
      contactFrame,
      contactPositions,
      contactPropsAt,
    );
    const hand = contactState.rig[`${released.hand}Hand`];
    if (hand) propsAt[id] = hand.origin;
  }
  let states = Object.fromEntries(
    props.actorOrder.map((id) => [id, evaluateActor(props, id, frame, positions, propsAt, camera)]),
  );
  for (const [id, attachment] of Object.entries(attached)) {
    const hand = attachment && states[attachment.actorId]?.rig[`${attachment.hand}Hand`];
    if (hand) propsAt[id] = hand.origin;
  }
  states = Object.fromEntries(
    props.actorOrder.map((id) => [id, evaluateActor(props, id, frame, positions, propsAt, camera)]),
  );
  return states;
}

export function CharacterScene({ props, frame }: { props: CharacterSceneProps; frame: number }) {
  const attachments = resolvePersistentPropAttachments(props, frame);
  let states = evaluateCharacterActors(props, frame);
  const productId = props.staging.productPropId;
  const productAttachment = productId ? attachments[productId] : undefined;
  const productHand =
    productAttachment && states[productAttachment.actorId]?.rig[`${productAttachment.hand}Hand`];
  const product = productId ? props.propsById[productId] : undefined;
  const productWorldPoint =
    productHand?.origin ??
    (product ? { x: product.x * props.stage.width, y: product.y * props.stage.height } : undefined);
  const camera = evaluatePresentationCamera(
    props,
    frame,
    { productWorldPoint },
    (target, atFrame) => resolveDynamicTarget(props, target, atFrame),
  );
  // A second pure pass makes screen-space gaze/point targets use the same
  // camera that follows an attached product. No state is integrated.
  states = evaluateCharacterActors(props, frame, camera);
  const actors: ReactNode[] = props.actorOrder.map((id) => {
    const actor = props.actorsById[id],
      state = states[id],
      pack = actor && props.characterPacksById[actor.characterPackId];
    return state && pack ? (
      <CharacterPackView
        key={id}
        pack={pack}
        rig={state.rig}
        face={state.face}
        opacity={state.opacity}
        nodeOpacity={state.nodeOpacity}
        renderHands={false}
      />
    ) : null;
  });
  const renderedProps = props.propOrder.map((id) => {
    const prop = props.propsById[id]!,
      attachment = attachments[id],
      hand = attachment && states[attachment.actorId]?.rig[`${attachment.hand}Hand`];
    const released = props.actionOrder
      .map((actionId) => props.actionsById[actionId])
      .filter((action): action is Extract<CharacterAction, { type: "showProp" }> =>
        Boolean(
          action?.type === "showProp" &&
            action.propId === id &&
            (action.interaction === "place" || action.interaction === "release") &&
            frame >= action.startFrame + propContactFrame(action),
        ),
      )
      .at(-1);
    let releasedMatrix: ReturnType<typeof resolvePropAttachment> | undefined;
    if (released) {
      const contactFrame = released.startFrame + propContactFrame(released) - 1;
      const contact = evaluateCharacterActors(props, contactFrame)[released.actorId]?.rig[
        `${released.hand}Hand`
      ];
      if (contact)
        releasedMatrix = resolvePropAttachment(contact.matrix, prop.grip, {
          rotation: prop.rotation,
          scaleX: prop.scale,
          scaleY: prop.scale,
        });
    }
    const matrix = hand
      ? resolvePropAttachment(hand.matrix, prop.grip, {
          x: attachment.offset.x,
          y: attachment.offset.y,
          rotation: attachment.rotation + prop.rotation,
          scaleX: prop.scale,
          scaleY: prop.scale,
        })
      : (releasedMatrix ??
        multiplyMatrices(
          transformMatrix({
            x: prop.x * props.stage.width,
            y: prop.y * props.stage.height,
            rotation: prop.rotation,
            scaleX: prop.scale,
            scaleY: prop.scale,
          }),
          transformMatrix({
            x: -prop.grip.x,
            y: -prop.grip.y,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          }),
        ));
    const revealed = props.actionOrder.some((actionId) => {
      const action = props.actionsById[actionId];
      return (
        action?.type === "showProp" &&
        action.propId === id &&
        action.weight > 0 &&
        frame >= action.startFrame
      );
    });
    const visible = Boolean(prop.initiallyVisible || attachment || revealed);
    const opacity =
      (attachment ? (states[attachment.actorId]?.opacity ?? 1) : 1) *
      propRevealWeight(props, id, frame);
    return visible ? (
      <CharacterPropView key={id} prop={prop} matrix={matrix} opacity={opacity} />
    ) : null;
  });
  const hands = props.actorOrder.map((id) => {
    const actor = props.actorsById[id],
      state = states[id],
      pack = actor && props.characterPacksById[actor.characterPackId];
    return state && pack ? (
      <CharacterHandsView
        key={id}
        pack={pack}
        rig={state.rig}
        pointing={state.pointing}
        foregroundArms={state.foregroundArms}
        opacity={state.opacity}
        nodeOpacity={state.nodeOpacity}
      />
    ) : null;
  });
  return (
    <svg
      viewBox={`0 0 ${props.stage.width} ${props.stage.height}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={props.caption ?? "Character animation"}
    >
      <EnvironmentBase environment={props.environment} stage={props.stage} />
      <CameraWorld camera={camera}>
        <EnvironmentPlane
          environment={props.environment}
          plane="background"
          camera={camera}
          stage={props.stage}
        />
        <EnvironmentPlane
          environment={props.environment}
          plane="midground"
          camera={camera}
          stage={props.stage}
        />
        {actors}
        {renderedProps}
        {hands}
        <EnvironmentPlane
          environment={props.environment}
          plane="foreground"
          camera={camera}
          stage={props.stage}
        />
        <CharacterEffects
          props={props}
          frame={frame}
          states={states}
          attachments={attachments}
          space="world"
        />
      </CameraWorld>
      <CharacterEffects
        props={props}
        frame={frame}
        states={states}
        attachments={attachments}
        space="screen"
      />
      {props.overlayOrder.map((id) => {
        const overlay = props.overlaysById[id];
        return overlay ? (
          <AdvertisingOverlay key={id} overlay={overlay} frame={frame} stage={props.stage} />
        ) : null;
      })}
    </svg>
  );
}

export function resolveDynamicTarget(
  props: CharacterSceneProps,
  target: CharacterTarget | undefined,
  frame: number,
): Vec2 | undefined {
  if (!target) return undefined;
  if (target.kind === "point")
    return { x: target.x * props.stage.width, y: target.y * props.stage.height };
  if (target.kind === "camera") return { x: props.stage.width / 2, y: props.stage.height / 2 };
  if (target.kind === "overlay") {
    const overlay = props.overlaysById[target.overlayId];
    return overlay
      ? { x: overlay.x * props.stage.width, y: overlay.y * props.stage.height }
      : undefined;
  }
  const states = evaluateCharacterActors(props, frame);
  if (target.kind === "actor") return states[target.actorId]?.rig.root?.origin;
  const attachment = resolvePersistentPropAttachments(props, frame)[target.propId];
  if (attachment) return states[attachment.actorId]?.rig[`${attachment.hand}Hand`]?.origin;
  const prop = props.propsById[target.propId];
  return prop ? { x: prop.x * props.stage.width, y: prop.y * props.stage.height } : undefined;
}

function CharacterEffects({
  props,
  frame,
  states,
  attachments,
  space,
}: {
  props: CharacterSceneProps;
  frame: number;
  states: Record<string, CharacterActorState>;
  attachments: ReturnType<typeof resolvePersistentPropAttachments>;
  space: "world" | "screen";
}) {
  return (
    <g data-character-effects="true">
      {props.effects.map((effect) => {
        const local = frame - effect.startFrame;
        if (local < 0 || local >= effect.durationFrames) return null;
        const effectSpace = effect.target?.kind === "overlay" ? "screen" : "world";
        if (effectSpace !== space) return null;
        const progress = local / Math.max(1, effect.durationFrames - 1),
          fade = Math.sin(Math.PI * progress);
        const target = effect.target;
        const actorPoint =
          target?.kind === "actor" ? states[target.actorId]?.rig.root?.origin : undefined;
        const attachment = target?.kind === "prop" ? attachments[target.propId] : undefined;
        const handPoint = attachment
          ? states[attachment.actorId]?.rig[`${attachment.hand}Hand`]?.origin
          : undefined;
        const anchor = actorPoint
          ? { x: actorPoint.x / props.stage.width, y: actorPoint.y / props.stage.height }
          : handPoint
            ? { x: handPoint.x / props.stage.width, y: handPoint.y / props.stage.height }
            : target?.kind === "actor"
              ? props.actorsById[target.actorId]
              : target?.kind === "prop"
                ? props.propsById[target.propId]
                : target?.kind === "overlay"
                  ? props.overlaysById[target.overlayId]
                  : target?.kind === "point"
                    ? target
                    : undefined;
        const x = (effect.x ?? anchor?.x ?? 0.5) * props.stage.width,
          y = (effect.y ?? anchor?.y ?? 0.5) * props.stage.height;
        const color = effect.color ?? props.environment.accent,
          seed = effect.seed ?? props.seed;
        if (effect.type === "highlight")
          return (
            <ellipse
              key={effect.id}
              cx={x}
              cy={y}
              rx={100 + 80 * effect.intensity * fade}
              ry={100 + 80 * effect.intensity * fade}
              fill="none"
              stroke={color}
              strokeWidth={10}
              opacity={fade}
            />
          );
        if (effect.type === "impact")
          return (
            <g key={effect.id} transform={`translate(${x} ${y})`} opacity={fade}>
              {Array.from({ length: effect.count }, (_, i) => {
                const a = (i / effect.count) * Math.PI * 2,
                  r = 30 + 180 * progress * effect.intensity;
                return (
                  <line
                    key={a}
                    x1={Math.cos(a) * r * 0.45}
                    y1={Math.sin(a) * r * 0.45}
                    x2={Math.cos(a) * r}
                    y2={Math.sin(a) * r}
                    stroke={color}
                    strokeWidth={8}
                  />
                );
              })}
            </g>
          );
        if (effect.type === "speed-lines")
          return (
            <g key={effect.id} opacity={fade}>
              {Array.from({ length: effect.count }, (_, i) => {
                const yy = (((i * 97 + seed) % 1000) / 1000) * props.stage.height;
                return (
                  <line
                    key={yy}
                    x1={-100 + progress * props.stage.width}
                    y1={yy}
                    x2={180 + progress * props.stage.width}
                    y2={yy}
                    stroke={color}
                    strokeWidth={5}
                  />
                );
              })}
            </g>
          );
        return (
          <g key={effect.id} opacity={fade}>
            {Array.from({ length: effect.count }, (_, i) => {
              const a = (((i * 137.5 + seed) % 360) * Math.PI) / 180,
                r = (30 + (i % 7) * 13) * progress * effect.intensity;
              return (
                <circle
                  key={`${a}:${r}`}
                  cx={x + Math.cos(a) * r}
                  cy={y + Math.sin(a) * r - (effect.type === "smoke" ? progress * 120 : 0)}
                  r={(effect.type === "smoke" ? 18 : 7) * (1 - progress * 0.5)}
                  fill={color}
                  opacity={effect.type === "smoke" ? 0.24 : 0.8}
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
