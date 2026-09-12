import type {
  CharacterAction,
  CharacterPack,
  CharacterSceneProps,
  CharacterTarget,
} from "@visual-canvas/video/registry";
import type { ReactNode } from "react";
import {
  type CharacterFaceState,
  CharacterHandsView,
  CharacterPackView,
  CharacterPropView,
} from "./character-pack-view.js";
import {
  type AnimationTrack,
  compileSemanticActions,
  type EvaluatedRig,
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

type Emotion = CharacterSceneProps["actorsById"][string]["initialEmotion"];
type Viseme = CharacterFaceState["viseme"];
export type CharacterActorState = {
  opacity: number;
  emotion: Emotion;
  face: CharacterFaceState;
  pose: NumericPose;
  rig: EvaluatedRig;
  pointing: Partial<Record<"left" | "right", Vec2>>;
};
const VIEW_WIDTH = 1080,
  VIEW_HEIGHT = 1920;
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

function rigNodes(pack: CharacterPack): RigNode[] {
  const relative = (
    id: keyof CharacterPack["rig"],
    parentId?: keyof CharacterPack["rig"],
  ): RigNode => {
    const point = pack.rig[id],
      parent = parentId ? pack.rig[parentId] : { x: 0, y: 0 };
    return { id, parentId, transform: { x: point.x - parent.x, y: point.y - parent.y } };
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

function actorWorldPoint(
  props: CharacterSceneProps,
  actorId: string,
  positions: Record<string, Vec2>,
): Vec2 | undefined {
  const position = positions[actorId],
    actor = props.actorsById[actorId];
  const pack = actor && props.characterPacksById[actor.characterPackId];
  if (!position || !actor || !pack) return undefined;
  return {
    x: position.x + pack.rig.head.x * actor.scale * (actor.facing === "left" ? -1 : 1),
    y: position.y + pack.rig.head.y * actor.scale,
  };
}
function targetPoint(
  target: CharacterTarget,
  props: CharacterSceneProps,
  positions: Record<string, Vec2>,
  propsAt: Record<string, Vec2>,
): Vec2 {
  if (target.kind === "camera") return { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 };
  if (target.kind === "point") return { x: target.x * VIEW_WIDTH, y: target.y * VIEW_HEIGHT };
  if (target.kind === "actor")
    return (
      actorWorldPoint(props, target.actorId, positions) ?? { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 }
    );
  if (target.kind === "prop")
    return propsAt[target.propId] ?? { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 };
  const overlay = props.overlaysById[target.overlayId];
  return overlay
    ? { x: overlay.x * VIEW_WIDTH, y: overlay.y * VIEW_HEIGHT }
    : { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 };
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
  return [
    staticTrack(id, action, `${side}Arm.rotation`, solved.shoulderRotation - restUpper),
    staticTrack(id, action, `${side}Forearm.rotation`, solved.elbowRotation - restLower),
  ];
}
function gestureTarget(
  pack: CharacterPack,
  preset: "point" | "explain" | "shrug" | "think",
  side: "left" | "right",
  intensity: number,
): Vec2 {
  const sign = side === "left" ? -1 : 1;
  let point: Vec2;
  if (preset === "point") point = { x: sign * 135 * intensity, y: 180 * intensity };
  else if (preset === "explain") point = { x: sign * 175 * intensity, y: -55 * intensity };
  else if (preset === "shrug") point = { x: sign * 165 * intensity, y: 18 * intensity };
  else
    point =
      side === "right"
        ? { x: pack.rig.mouth.x + 35, y: pack.rig.mouth.y + 32 }
        : { x: -145 * intensity, y: 105 * intensity };
  return { x: point.x - pack.rig.body.x, y: point.y - pack.rig.body.y };
}

function locomotionPose(props: CharacterSceneProps, actorId: string, frame: number): NumericPose {
  const actor = props.actorsById[actorId]!;
  const entrances = props.actionOrder
    .map((id) => [id, props.actionsById[id]] as const)
    .filter(
      (entry): entry is readonly [string, Extract<CharacterAction, { type: "enter" }>] =>
        entry[1]?.type === "enter" && entry[1].actorId === actorId && entry[1].weight > 0,
    );
  const baseX = actor.x * VIEW_WIDTH,
    baseY = actor.y * VIEW_HEIGHT;
  if (entrances.length === 0) return { "root.x": baseX, "root.y": baseY };
  const [id, enter] =
      [...entrances].reverse().find(([, candidate]) => candidate.startFrame <= frame) ??
      entrances[0]!,
    fromX = baseX + (enter.from === "left" ? -0.72 : 0.72) * VIEW_WIDTH;
  const tracks = adaptTracks(
    enter,
    compileSemanticActions([
      {
        id,
        type: "move",
        startFrame: enter.startFrame,
        durationFrames: enter.durationFrames,
        from: { x: fromX, y: baseY },
        to: { x: baseX, y: baseY },
        holdAfter: true,
      },
    ]),
  );
  return mixAnimationTracks({ "root.x": fromX, "root.y": baseY }, tracks, frame);
}
function actorOpacity(props: CharacterSceneProps, actorId: string, frame: number) {
  const entrances = props.actionOrder
    .map((id) => props.actionsById[id])
    .filter(
      (action): action is Extract<CharacterAction, { type: "enter" }> =>
        action?.type === "enter" && action.actorId === actorId && action.weight > 0,
    );
  if (entrances.length === 0) return 1;
  const enter =
    [...entrances].reverse().find((candidate) => candidate.startFrame <= frame) ?? entrances[0]!;
  return frame < enter.startFrame
    ? 0
    : smooth((frame - enter.startFrame) / Math.min(12, enter.durationFrames));
}
function resolveViseme(props: CharacterSceneProps, actorId: string, frame: number) {
  const active = props.actionOrder
    .map((id) => ({ id, action: props.actionsById[id] }))
    .filter((entry): entry is { id: string; action: Extract<CharacterAction, { type: "talk" }> } =>
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
    const envelope = Math.min(smooth((local - current.frame) / 2), smooth((nextFrame - local) / 2));
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
): CharacterActorState {
  const actor = props.actorsById[actorId]!,
    pack = props.characterPacksById[actor.characterPackId]!;
  const locomotion = locomotionPose(props, actorId, frame);
  const idle = evaluateIdleMotion(frame, props.seed, actorId, {
    amplitude: pack.motion.breathingAmplitude / 100,
    frequency: (Math.PI * 2) / pack.motion.breathingPeriodFrames,
    blinkPeriodFrames: pack.motion.blinkIntervalFrames,
  });
  const initial = pack.expressions[actor.initialEmotion];
  const base: NumericPose = {
    ...locomotion,
    "root.rotation": (idle["head.rotation"] ?? 0) * pack.motion.swayDegrees,
    "body.scaleX": idle["body.scaleX"] ?? 1,
    "body.scaleY": idle["body.scaleY"] ?? 1,
    "eyes.open": pack.capabilities.blink ? (idle["eyes.open"] ?? 1) : 1,
    "eyes.x":
      actor.facing === "left" ? -pack.motion.gazeLimit * 0.25 : pack.motion.gazeLimit * 0.25,
    "eyes.y": 0,
    "head.rotation": 0,
    "mouth.open": 0,
    "face.browTilt": initial.browTilt,
    "face.mouthCurve": initial.mouthCurve,
    "face.eyeOpen": initial.eyeOpen,
    "leftArm.rotation": 0,
    "leftForearm.rotation": 0,
    "rightArm.rotation": 0,
    "rightForearm.rotation": 0,
  };
  const actorMatrix = transformMatrix({
    x: locomotion["root.x"]!,
    y: locomotion["root.y"]!,
    rotation: base["root.rotation"]!,
    scaleX: actor.scale * (actor.facing === "left" ? -1 : 1),
    scaleY: actor.scale,
  });
  const toLocal = inverseMatrix(actorMatrix),
    tracks: AnimationTrack[] = [];
  const pointing: Partial<Record<"left" | "right", Vec2>> = {};
  const pointingPriority: Partial<Record<"left" | "right", number>> = {};
  const armRequests: {
    id: string;
    action: CharacterAction;
    side: "left" | "right";
    target: { space: "body" | "world"; point: Vec2 };
  }[] = [];
  let emotion = actor.initialEmotion,
    emotionPriority = -101;
  for (const id of props.actionOrder) {
    const action = props.actionsById[id];
    if (!action || action.actorId !== actorId || action.type === "enter") continue;
    if (
      (action.type === "react" || (action.type === "talk" && action.emotion)) &&
      actionActive(action, frame) &&
      action.weight > 0 &&
      actionOwns(action, "emotion")
    ) {
      const nextEmotion = action.type === "react" ? action.preset : action.emotion!;
      if (action.priority >= emotionPriority) {
        emotionPriority = action.priority;
        emotion = nextEmotion;
      }
      const expression = pack.expressions[nextEmotion];
      tracks.push(
        staticTrack(id, action, "face.browTilt", expression.browTilt),
        staticTrack(id, action, "face.mouthCurve", expression.mouthCurve),
        staticTrack(id, action, "face.eyeOpen", expression.eyeOpen),
      );
    }
    if (action.type === "look") {
      const gaze =
        action.target.kind === "camera"
          ? { gazeX: 0, gazeY: 0, headRotation: 0 }
          : solveGaze({
              origin: pack.rig.eyes,
              target: transformPoint(
                toLocal,
                targetPoint(action.target, props, positions, propsAt),
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
        ),
      );
    } else if (action.type === "gesture") {
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
    } else if (action.type === "point") {
      const point = targetPoint(action.target, props, positions, propsAt);
      armRequests.push({
        id,
        action,
        side: action.hand,
        target: {
          space: "world",
          point,
        },
      });
      if (
        actionActive(action, frame) &&
        actionWeight(action, frame) > 0 &&
        action.priority >= (pointingPriority[action.hand] ?? Number.NEGATIVE_INFINITY)
      ) {
        pointing[action.hand] = point;
        pointingPriority[action.hand] = action.priority;
      }
    } else if (action.type === "showProp") {
      armRequests.push({
        id,
        action,
        side: action.hand,
        target: action.target
          ? { space: "world", point: targetPoint(action.target, props, positions, propsAt) }
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
    tracks.push(...armTracks(request.id, request.action, pack, request.side, target));
  }
  const pose = mixAnimationTracks(base, tracks, frame);
  const rig = evaluateRig(
    rigNodes(pack),
    {
      body: { scaleX: pose["body.scaleX"], scaleY: pose["body.scaleY"] },
      head: { rotation: pose["head.rotation"] },
      leftShoulder: { rotation: pose["leftArm.rotation"] },
      leftElbow: { rotation: pose["leftForearm.rotation"] },
      rightShoulder: { rotation: pose["rightArm.rotation"] },
      rightElbow: { rotation: pose["rightForearm.rotation"] },
    },
    {
      x: pose["root.x"]!,
      y: pose["root.y"]!,
      rotation: pose["root.rotation"]!,
      scaleX: actor.scale * (actor.facing === "left" ? -1 : 1),
      scaleY: actor.scale,
    },
  );
  const speech = resolveViseme(props, actorId, frame);
  return {
    opacity: actorOpacity(props, actorId, frame),
    emotion,
    pose,
    rig,
    pointing,
    face: {
      gazeX: pose["eyes.x"]!,
      gazeY: pose["eyes.y"]!,
      eyeOpen: pose["eyes.open"]! * pose["face.eyeOpen"]!,
      browTilt: pose["face.browTilt"]!,
      mouthCurve: pose["face.mouthCurve"]!,
      viseme: speech.viseme,
      mouthOpen: speech.mouthOpen,
    },
  };
}

export function evaluateCharacterActors(
  props: CharacterSceneProps,
  frame: number,
): Record<string, CharacterActorState> {
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
      { x: props.propsById[id]!.x * VIEW_WIDTH, y: props.propsById[id]!.y * VIEW_HEIGHT },
    ]),
  );
  let states = Object.fromEntries(
    props.actorOrder.map((id) => [id, evaluateActor(props, id, frame, positions, propsAt)]),
  );
  for (const [id, attachment] of Object.entries(attached)) {
    const hand = attachment && states[attachment.actorId]?.rig[`${attachment.hand}Hand`];
    if (hand) propsAt[id] = hand.origin;
  }
  states = Object.fromEntries(
    props.actorOrder.map((id) => [id, evaluateActor(props, id, frame, positions, propsAt)]),
  );
  return states;
}

function Overlay({
  overlay,
  frame,
}: {
  overlay: CharacterSceneProps["overlaysById"][string];
  frame: number;
}) {
  if (frame < overlay.startFrame || frame >= overlay.endFrame) return null;
  const enter = smooth((frame - overlay.startFrame) / 10),
    exit = smooth((overlay.endFrame - frame) / 8),
    opacity = Math.min(enter, exit);
  const styles: Record<
    typeof overlay.style,
    { fill: string; color: string; width: number; height: number; size: number }
  > = {
    caption: { fill: "#211108", color: "#fff8ee", width: 820, height: 112, size: 48 },
    "price-old": { fill: "#fff8ee", color: "#8a3d1b", width: 410, height: 140, size: 52 },
    "price-new": { fill: "#ff7a1a", color: "#211108", width: 410, height: 140, size: 52 },
    cta: { fill: "#ff7a1a", color: "#211108", width: 760, height: 126, size: 44 },
  };
  const style = styles[overlay.style];
  return (
    <g
      transform={`translate(${overlay.x * VIEW_WIDTH} ${overlay.y * VIEW_HEIGHT}) scale(${0.92 + enter * 0.08})`}
      opacity={opacity}
    >
      <rect
        x={-style.width / 2}
        y={-style.height / 2}
        width={style.width}
        height={style.height}
        rx="28"
        fill={style.fill}
      />
      <text
        y={style.size * 0.34}
        textAnchor="middle"
        fill={style.color}
        fontFamily="DejaVu Sans"
        fontWeight="700"
        fontSize={style.size}
      >
        {overlay.text}
      </text>
    </g>
  );
}

export function CharacterScene({ props, frame }: { props: CharacterSceneProps; frame: number }) {
  const states = evaluateCharacterActors(props, frame),
    attachments = resolvePersistentPropAttachments(props, frame);
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
        renderHands={false}
      />
    ) : null;
  });
  const renderedProps = props.propOrder.map((id) => {
    const prop = props.propsById[id]!,
      attachment = attachments[id],
      hand = attachment && states[attachment.actorId]?.rig[`${attachment.hand}Hand`];
    const matrix = hand
      ? resolvePropAttachment(hand.matrix, prop.grip, {
          x: attachment.offset.x,
          y: attachment.offset.y,
          rotation: attachment.rotation + prop.rotation,
          scaleX: prop.scale,
          scaleY: prop.scale,
        })
      : multiplyMatrices(
          transformMatrix({
            x: prop.x * VIEW_WIDTH,
            y: prop.y * VIEW_HEIGHT,
            rotation: prop.rotation,
            scaleX: prop.scale,
            scaleY: prop.scale,
          }),
          transformMatrix({ x: -prop.grip.x, y: -prop.grip.y, rotation: 0, scaleX: 1, scaleY: 1 }),
        );
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
    const opacity = attachment ? (states[attachment.actorId]?.opacity ?? 1) : 1;
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
        opacity={state.opacity}
      />
    ) : null;
  });
  return (
    <svg
      viewBox="0 0 1080 1920"
      width="100%"
      height="100%"
      role="img"
      aria-label={props.caption ?? "Farq character animation"}
    >
      <rect width="1080" height="1920" fill={props.background} />
      <circle cx="890" cy="235" r="205" fill="#ff7a1a" opacity="0.12" />
      <path d="M0 1320 C280 1210 410 1390 670 1280 S920 1240 1080 1350 V1920 H0Z" fill="#2b1710" />
      {actors}
      {renderedProps}
      {hands}
      {props.overlayOrder.map((id) => {
        const overlay = props.overlaysById[id];
        return overlay ? <Overlay key={id} overlay={overlay} frame={frame} /> : null;
      })}
    </svg>
  );
}
