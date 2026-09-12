/** Renderer-independent, frame-addressable character animation primitives. */
export type Vec2 = { x: number; y: number };
export type Transform2D = Vec2 & { rotation: number; scaleX: number; scaleY: number };
/** SVG-compatible affine matrix; rotations in this module are degrees. */
export type Matrix2D = readonly [number, number, number, number, number, number];
export type RigNode = {
  id: string;
  parentId?: string;
  transform: Partial<Transform2D>;
  rotationLimits?: readonly [number, number];
};
export type RigPose = Record<string, Partial<Transform2D>>;
export type EvaluatedRig = Record<string, { local: Transform2D; matrix: Matrix2D; origin: Vec2 }>;
const RAD = Math.PI / 180;
const clamp = (x: number, min = 0, max = 1) => Math.max(min, Math.min(max, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
const identity: Transform2D = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
export function transformMatrix(t: Transform2D): Matrix2D {
  const c = Math.cos(t.rotation * RAD),
    s = Math.sin(t.rotation * RAD);
  return [c * t.scaleX, s * t.scaleX, -s * t.scaleY, c * t.scaleY, t.x, t.y];
}
export function multiplyMatrices(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function transformPoint(matrix: Matrix2D, p: Vec2): Vec2 {
  return {
    x: matrix[0] * p.x + matrix[2] * p.y + matrix[4],
    y: matrix[1] * p.x + matrix[3] * p.y + matrix[5],
  };
}
export function inverseMatrix(m: Matrix2D): Matrix2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) throw new Error("Cannot invert a singular rig transform");
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** Parent order is irrelevant. Missing parents and cycles fail before rendering. */
export function evaluateRig(
  nodes: readonly RigNode[],
  pose: RigPose = {},
  world: Partial<Transform2D> = {},
): EvaluatedRig {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error("Duplicate rig node");
  const result: EvaluatedRig = {};
  const visiting = new Set<string>();
  const worldMatrix = transformMatrix({ ...identity, ...world });
  const visit = (id: string): EvaluatedRig[string] => {
    if (result[id]) return result[id];
    const node = byId.get(id);
    if (!node) throw new Error(`Missing rig node: ${id}`);
    if (visiting.has(id)) throw new Error(`Rig parent cycle: ${id}`);
    visiting.add(id);
    const local = { ...identity, ...node.transform, ...pose[id] };
    if (node.rotationLimits) local.rotation = clamp(local.rotation, ...node.rotationLimits);
    const parent = node.parentId ? visit(node.parentId).matrix : worldMatrix;
    const matrix = multiplyMatrices(parent, transformMatrix(local));
    const evaluated = { local, matrix, origin: transformPoint(matrix, { x: 0, y: 0 }) };
    result[id] = evaluated;
    visiting.delete(id);
    return evaluated;
  };
  for (const node of nodes) visit(node.id);
  return result;
}

export type AnimationKeyframe = {
  frame: number;
  value: number;
  easing?: "linear" | "smooth" | "step";
};
export type AnimationTrack = {
  id: string;
  /** A channel is a stable dotted path, e.g. rightArm.rotation or face.smile. */
  channel: string;
  layer: string;
  priority: number;
  mode: "override" | "additive";
  startFrame: number;
  durationFrames: number;
  keyframes: readonly AnimationKeyframe[];
  weight?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  /** Prefix mask; `rightArm` matches rightArm.rotation but not rightArmature.x. */
  bodyMask?: readonly string[];
  holdBefore?: boolean;
  holdAfter?: boolean;
};
export type NumericPose = Record<string, number>;
export function sampleTrack(track: AnimationTrack, frame: number): number | undefined {
  if (!track.keyframes.length) return undefined;
  const local = frame - track.startFrame;
  if (local < 0 && !track.holdBefore) return undefined;
  if (local >= track.durationFrames && !track.holdAfter) return undefined;
  const first = track.keyframes[0]!;
  if (local <= first.frame) return first.value;
  for (let index = 1; index < track.keyframes.length; index++) {
    const right = track.keyframes[index]!;
    const left = track.keyframes[index - 1]!;
    if (local <= right.frame) {
      const fraction = clamp((local - left.frame) / Math.max(1e-9, right.frame - left.frame));
      const progress =
        right.easing === "step"
          ? local < right.frame
            ? 0
            : 1
          : right.easing === "smooth"
            ? smooth(fraction)
            : fraction;
      return left.value + (right.value - left.value) * progress;
    }
  }
  return track.keyframes[track.keyframes.length - 1]!.value;
}
/** Stable tie-break by ID makes output independent of input iteration order. */
export function mixAnimationTracks(
  base: NumericPose,
  tracks: readonly AnimationTrack[],
  frame: number,
): NumericPose {
  const result = { ...base };
  for (const track of [...tracks].sort(
    (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    if (
      track.bodyMask &&
      !track.bodyMask.some((part) => track.channel === part || track.channel.startsWith(`${part}.`))
    )
      continue;
    const value = sampleTrack(track, frame);
    if (value === undefined) continue;
    const local = frame - track.startFrame;
    let weight = clamp(track.weight ?? 1);
    if (track.fadeInFrames && local >= 0) weight *= smooth(local / track.fadeInFrames);
    if (track.fadeOutFrames && !track.holdAfter)
      weight *= smooth((track.durationFrames - local) / track.fadeOutFrames);
    const previous = result[track.channel] ?? 0;
    result[track.channel] =
      track.mode === "additive"
        ? previous + value * weight
        : previous + (value - previous) * weight;
  }
  return result;
}

export type IKResult = {
  elbow: Vec2;
  hand: Vec2;
  shoulderRotation: number;
  elbowRotation: number;
  reachable: boolean;
  error: number;
};
/** Solves in a single coordinate space. Rest bones point along positive X. */
export function solveTwoBoneIK(input: {
  shoulder: Vec2;
  target: Vec2;
  upperLength: number;
  lowerLength: number;
  bend?: 1 | -1;
  shoulderLimits?: readonly [number, number];
  elbowLimits?: readonly [number, number];
}): IKResult {
  const { shoulder, target, upperLength: a, lowerLength: b } = input;
  if (
    !(a > 0) ||
    !(b > 0) ||
    !Number.isFinite(a + b + shoulder.x + shoulder.y + target.x + target.y)
  ) {
    throw new Error("IK requires positive finite bone lengths and finite coordinates");
  }
  const dx = target.x - shoulder.x,
    dy = target.y - shoulder.y;
  const requestedDistance = Math.hypot(dx, dy);
  const distance = clamp(requestedDistance, Math.abs(a - b) + 1e-9, a + b);
  const targetAngle = Math.atan2(dy, dx);
  const bend = input.bend ?? 1;
  let elbowRotation =
    (bend * Math.acos(clamp((distance * distance - a * a - b * b) / (2 * a * b), -1, 1))) / RAD;
  let shoulderRotation =
    (targetAngle -
      Math.atan2(b * Math.sin(elbowRotation * RAD), a + b * Math.cos(elbowRotation * RAD))) /
    RAD;
  if (input.shoulderLimits) shoulderRotation = clamp(shoulderRotation, ...input.shoulderLimits);
  if (input.elbowLimits) elbowRotation = clamp(elbowRotation, ...input.elbowLimits);
  const elbow = {
    x: shoulder.x + a * Math.cos(shoulderRotation * RAD),
    y: shoulder.y + a * Math.sin(shoulderRotation * RAD),
  };
  const hand = {
    x: elbow.x + b * Math.cos((shoulderRotation + elbowRotation) * RAD),
    y: elbow.y + b * Math.sin((shoulderRotation + elbowRotation) * RAD),
  };
  const error = Math.hypot(hand.x - target.x, hand.y - target.y);
  return { elbow, hand, shoulderRotation, elbowRotation, reachable: error < 1e-6, error };
}

export function solveGaze(input: {
  origin: Vec2;
  target: Vec2;
  maxEyeOffsetX?: number;
  maxEyeOffsetY?: number;
  maxHeadRotation?: number;
  responseDistance?: number;
}): { gazeX: number; gazeY: number; headRotation: number } {
  const dx = input.target.x - input.origin.x,
    dy = input.target.y - input.origin.y;
  const distance = Math.max(1e-6, input.responseDistance ?? 1);
  const gazeX = clamp(dx / distance, -1, 1),
    gazeY = clamp(dy / distance, -1, 1);
  return {
    gazeX: gazeX * (input.maxEyeOffsetX ?? 1),
    gazeY: gazeY * (input.maxEyeOffsetY ?? 1),
    headRotation: clamp(
      gazeX * gazeY * (input.maxHeadRotation ?? 12),
      -(input.maxHeadRotation ?? 12),
      input.maxHeadRotation ?? 12,
    ),
  };
}

/** The prop's grip anchor, rather than its top-left corner, coincides with the hand. */
export function resolvePropAttachment(
  hand: Matrix2D,
  grip: Vec2,
  offset: Partial<Transform2D> = {},
): Matrix2D {
  return multiplyMatrices(multiplyMatrices(hand, transformMatrix({ ...identity, ...offset })), [
    1,
    0,
    0,
    1,
    -grip.x,
    -grip.y,
  ]);
}

export type PropAttachment = {
  actorId: string;
  hand: "left" | "right";
  offset: Vec2;
  rotation: number;
};
/** Attachments are state changes, while presentation gestures are temporary tracks. */
export function resolvePersistentPropAttachments(
  scene: {
    propsById: Record<string, { attachment?: PropAttachment }>;
    actionOrder: readonly string[];
    actionsById: Record<
      string,
      {
        type: string;
        startFrame: number;
        actorId: string;
        weight?: number;
        propId?: string;
        hand?: "left" | "right" | "both";
      }
    >;
  },
  frame: number,
): Record<string, PropAttachment | undefined> {
  const attachments: Record<string, PropAttachment | undefined> = {};
  for (const [id, prop] of Object.entries(scene.propsById))
    attachments[id] = prop.attachment
      ? {
          ...prop.attachment,
          offset: { ...prop.attachment.offset },
        }
      : undefined;
  for (const id of scene.actionOrder) {
    const action = scene.actionsById[id];
    if (
      !action ||
      action.type !== "showProp" ||
      action.startFrame > frame ||
      action.weight === 0 ||
      !action.propId ||
      (action.hand !== "left" && action.hand !== "right")
    )
      continue;
    const previous = attachments[action.propId];
    if (previous?.actorId === action.actorId && previous.hand === action.hand) continue;
    attachments[action.propId] = {
      actorId: action.actorId,
      hand: action.hand,
      offset: { x: 0, y: 0 },
      rotation: 0,
    };
  }
  return attachments;
}

/** A decaying response sampled from time, never integrated from the previous frame. */
export function evaluateFollowThrough(
  frame: number,
  startFrame: number,
  options: {
    amplitude: number;
    frequency?: number;
    decayFrames?: number;
    delayFrames?: number;
  },
): number {
  const t = frame - startFrame - (options.delayFrames ?? 0);
  if (t <= 0) return 0;
  return (
    options.amplitude *
    Math.exp(-t / Math.max(1, options.decayFrames ?? 12)) *
    Math.sin(t * (options.frequency ?? 0.24))
  );
}

export function evaluateIdleMotion(
  frame: number,
  seed: number,
  actorId: string,
  options: {
    amplitude?: number;
    frequency?: number;
    blinkPeriodFrames?: number;
  } = {},
): NumericPose {
  let hash = seed >>> 0;
  for (const letter of actorId) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
  const phase = (hash % 10000) / 10000;
  const breathe = Math.sin(frame * (options.frequency ?? 0.075) + phase * Math.PI * 2);
  const amplitude = options.amplitude ?? 0.012;
  const blinkPeriod = Math.max(12, options.blinkPeriodFrames ?? 118);
  const blinkFrame =
    (((frame + Math.floor(phase * blinkPeriod)) % blinkPeriod) + blinkPeriod) % blinkPeriod;
  return {
    "body.scaleX": 1 + breathe * amplitude,
    "body.scaleY": 1 - breathe * amplitude,
    "head.rotation": breathe * amplitude * 70,
    "eyes.open": blinkFrame < 6 ? Math.max(0.05, Math.abs(blinkFrame - 3) / 3) : 1,
  };
}

type ActionTiming = {
  id: string;
  startFrame: number;
  durationFrames: number;
  priority?: number;
  fadeFrames?: number;
};
export type SemanticRuntimeAction = ActionTiming &
  (
    | { type: "pose"; values: NumericPose; mask?: readonly string[]; additive?: boolean }
    | { type: "move"; from: Vec2; to: Vec2; holdAfter?: boolean }
    | { type: "look"; origin: Vec2; target: Vec2; responseDistance?: number }
    | {
        type: "reach";
        arm: "leftArm" | "rightArm";
        shoulder: Vec2;
        target: Vec2;
        upperLength: number;
        lowerLength: number;
        bend?: 1 | -1;
      }
    | { type: "blink" }
    | { type: "squash"; intensity: number }
  );
/** Semantic intent compiles once to serializable, inspectable scalar tracks. */
export function compileSemanticActions(
  actions: readonly SemanticRuntimeAction[],
): AnimationTrack[] {
  const tracks: AnimationTrack[] = [];
  for (const action of actions) {
    const add = (
      channel: string,
      layer: string,
      keyframes: AnimationKeyframe[],
      options: Partial<AnimationTrack> = {},
    ) => {
      tracks.push({
        id: `${action.id}:${channel}`,
        channel,
        layer,
        priority: action.priority ?? 50,
        mode: "override",
        startFrame: action.startFrame,
        durationFrames: action.durationFrames,
        fadeInFrames: action.fadeFrames ?? Math.min(6, action.durationFrames / 4),
        fadeOutFrames: action.fadeFrames ?? Math.min(6, action.durationFrames / 4),
        keyframes,
        ...options,
      });
    };
    const constant = (
      channel: string,
      layer: string,
      value: number,
      options: Partial<AnimationTrack> = {},
    ) => add(channel, layer, [{ frame: 0, value }], options);
    if (action.type === "pose") {
      for (const [channel, value] of Object.entries(action.values))
        constant(channel, "pose", value, {
          bodyMask: action.mask,
          mode: action.additive ? "additive" : "override",
        });
    } else if (action.type === "move") {
      for (const axis of ["x", "y"] as const)
        add(
          `root.${axis}`,
          "locomotion",
          [
            { frame: 0, value: action.from[axis] },
            { frame: action.durationFrames - 1, value: action.to[axis], easing: "smooth" },
          ],
          { holdAfter: action.holdAfter ?? true, fadeInFrames: 0, fadeOutFrames: 0 },
        );
    } else if (action.type === "look") {
      const gaze = solveGaze(action);
      constant("eyes.x", "gaze", gaze.gazeX);
      constant("eyes.y", "gaze", gaze.gazeY);
      constant("head.rotation", "gaze", gaze.headRotation, { mode: "additive" });
    } else if (action.type === "reach") {
      const ik = solveTwoBoneIK(action);
      constant(`${action.arm}.rotation`, "gesture", ik.shoulderRotation);
      constant(
        action.arm === "leftArm" ? "leftForearm.rotation" : "rightForearm.rotation",
        "gesture",
        ik.elbowRotation,
      );
    } else if (action.type === "blink") {
      add(
        "eyes.open",
        "blink",
        [
          { frame: 0, value: 1 },
          { frame: action.durationFrames / 2, value: 0.05, easing: "smooth" },
          { frame: action.durationFrames - 1, value: 1, easing: "smooth" },
        ],
        { fadeInFrames: 0, fadeOutFrames: 0 },
      );
    } else {
      const amplitude = clamp(action.intensity, -0.4, 0.4);
      for (const [channel, value] of [
        ["body.scaleX", amplitude],
        ["body.scaleY", -amplitude],
      ] as const) {
        add(
          channel,
          "secondary",
          [
            { frame: 0, value: 0 },
            { frame: action.durationFrames / 2, value, easing: "smooth" },
            { frame: action.durationFrames - 1, value: 0, easing: "smooth" },
          ],
          { mode: "additive", fadeInFrames: 0, fadeOutFrames: 0 },
        );
      }
    }
  }
  return tracks;
}
