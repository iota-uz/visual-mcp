import { z } from "zod";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const Frame = z.number().int().min(0).max(72000);
const Unit = z.number().min(0).max(1);
const DurationFrames = z.number().int().min(1).max(72000);
const PhaseFrames = z.number().int().min(0).max(600);
export const VideoTimebase = z
  .object({
    numerator: z.number().int().min(1).max(60000),
    denominator: z.number().int().min(1).max(1001),
  })
  .strict();
export const CharacterEmotion = z.enum(["neutral", "happy", "shocked", "thinking"]);
export const CharacterGesture = z.enum(["point", "explain", "shrug", "think"]);
export const CharacterChannel = z.enum([
  "transform",
  "body",
  "head",
  "gaze",
  "eyes",
  "mouth",
  "emotion",
  "leftArm",
  "rightArm",
]);
export const RigPoint = z
  .object({
    x: z.number().min(-2000).max(2000),
    y: z.number().min(-2000).max(2000),
  })
  .strict();
const RigNode = z.enum([
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
]);

/** Artwork is declarative vector data; no markup, scripts, URLs or executable expressions. */
export const CharacterShape = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ellipse"),
      x: z.number().min(-2000).max(2000),
      y: z.number().min(-2000).max(2000),
      rx: z.number().positive().max(2000),
      ry: z.number().positive().max(2000),
      fill: Color,
      stroke: Color.optional(),
      strokeWidth: z.number().min(0).max(100).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rect"),
      x: z.number().min(-2000).max(2000),
      y: z.number().min(-2000).max(2000),
      width: z.number().positive().max(4000),
      height: z.number().positive().max(4000),
      radius: z.number().min(0).max(1000).default(0),
      fill: Color,
      stroke: Color.optional(),
      strokeWidth: z.number().min(0).max(100).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("path"),
      d: z
        .string()
        .min(1)
        .max(16000)
        .regex(/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/),
      fill: Color,
      stroke: Color.optional(),
      strokeWidth: z.number().min(0).max(100).default(0),
    })
    .strict(),
]);
const Expression = z
  .object({
    browTilt: z.number().min(-1).max(1),
    mouthCurve: z.number().min(-1).max(1),
    eyeOpen: z.number().min(0.1).max(2),
  })
  .strict();
export const CharacterPack = z
  .object({
    version: z.literal(1),
    id: Key,
    label: z.string().trim().min(1).max(120),
    sourceAsset: z
      .object({
        assetRef: z
          .string()
          .regex(/^asset:\/\/(shared|workspace\/[a-z0-9-]+)\/[a-z0-9-]+@[1-9][0-9]*$/),
        revisionId: z.string().min(1).max(128),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        mimeType: z.literal("image/svg+xml"),
      })
      .strict()
      .optional(),
    orientation: z
      .object({
        canonicalFacing: z.enum(["left", "right"]),
        mirror: z.enum(["allowed", "fixed"]),
      })
      .strict()
      .optional(),
    viewBox: z
      .object({
        width: z.number().positive().max(4000),
        height: z.number().positive().max(4000),
      })
      .strict(),
    rig: z.record(RigNode, RigPoint),
    capabilities: z
      .object({
        arms: z.boolean(),
        gaze: z.boolean(),
        blink: z.boolean(),
        talk: z.boolean(),
        emotions: z.array(CharacterEmotion).min(1).max(4),
        gestures: z.array(CharacterGesture).max(4),
      })
      .strict(),
    layers: z
      .array(
        z
          .object({
            id: Key,
            node: RigNode,
            shapes: z.array(CharacterShape).min(1).max(32),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    style: z
      .object({
        limbColor: Color,
        limbWidth: z.number().positive().max(100),
        handRadius: z.number().positive().max(100),
        handColor: Color.optional(),
        handStroke: Color.optional(),
        handStrokeWidth: z.number().min(0).max(100).optional(),
        handRenderer: z.enum(["circle", "artwork"]).optional(),
        eyeColor: Color,
        eyeWhite: Color,
        eyeRadius: z.number().positive().max(100),
        eyeSpacing: z.number().positive().max(300),
        eyeAspectRatio: z.number().positive().max(3).optional(),
        pupilScale: z.number().positive().max(1).optional(),
        eyeHighlightColor: Color.optional(),
        eyeHighlightRadius: z.number().positive().max(50).optional(),
        eyeHighlightX: z.number().min(-100).max(100).optional(),
        eyeHighlightY: z.number().min(-100).max(100).optional(),
        browWidth: z.number().positive().max(300).optional(),
        browStrokeWidth: z.number().positive().max(100).optional(),
        mouthColor: Color,
        mouthWidth: z.number().positive().max(300),
        mouthRestOpen: Unit.optional(),
        tongueColor: Color.optional(),
      })
      .strict(),
    expressions: z.record(CharacterEmotion, Expression),
    motion: z
      .object({
        breathingAmplitude: z.number().min(0).max(20),
        breathingPeriodFrames: z.number().int().min(15).max(600),
        blinkIntervalFrames: z.number().int().min(30).max(900),
        swayDegrees: z.number().min(0).max(10),
        gazeLimit: z.number().positive().max(50),
        headTurnDegrees: z.number().min(0).max(45),
        elbowBend: z.enum(["outward", "inward"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((pack, ctx) => {
    if (new Set(pack.layers.map((layer) => layer.id)).size !== pack.layers.length)
      ctx.addIssue({
        code: "custom",
        path: ["layers"],
        message: "Layer IDs must be unique",
      });
    for (const name of ["emotions", "gestures"] as const)
      if (new Set(pack.capabilities[name]).size !== pack.capabilities[name].length)
        ctx.addIssue({
          code: "custom",
          path: ["capabilities", name],
          message: "Capabilities must be unique",
        });
    if (pack.capabilities.arms)
      for (const side of ["left", "right"] as const) {
        const shoulder = pack.rig[`${side}Shoulder`],
          elbow = pack.rig[`${side}Elbow`],
          hand = pack.rig[`${side}Hand`];
        if (
          Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y) < 1 ||
          Math.hypot(hand.x - elbow.x, hand.y - elbow.y) < 1
        )
          ctx.addIssue({
            code: "custom",
            path: ["rig", `${side}Elbow`],
            message: "Enabled arms require nonzero upper and lower bones",
          });
      }
  });

export const CharacterTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("camera") }).strict(),
  z.object({ kind: z.literal("point"), x: Unit, y: Unit }).strict(),
  z.object({ kind: z.literal("actor"), actorId: Key }).strict(),
  z.object({ kind: z.literal("prop"), propId: Key }).strict(),
  z.object({ kind: z.literal("overlay"), overlayId: Key }).strict(),
]);
const ActionBase = {
  actorId: Key,
  startFrame: Frame,
  durationFrames: DurationFrames,
  priority: z.number().int().min(-100).max(100).default(0),
  weight: Unit.default(1),
  blendInFrames: z.number().int().min(0).max(600).default(6),
  blendOutFrames: z.number().int().min(0).max(600).default(6),
  mask: z.array(CharacterChannel).min(1).max(9).optional(),
  acting: z
    .object({
      anticipationFrames: PhaseFrames,
      accentFrame: PhaseFrames,
      holdFrames: PhaseFrames,
      settleFrames: PhaseFrames,
      gazeLeadFrames: PhaseFrames,
      secondaryDelayFrames: PhaseFrames,
      stillness: Unit,
    })
    .strict()
    .optional(),
};
const Hand = z.enum(["left", "right"]);
export const CharacterAction = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("enter"),
      ...ActionBase,
      from: z.enum(["left", "right"]),
    })
    .strict(),
  z.object({ type: z.literal("look"), ...ActionBase, target: CharacterTarget }).strict(),
  z.object({ type: z.literal("blink"), ...ActionBase }).strict(),
  z
    .object({
      type: z.literal("talk"),
      ...ActionBase,
      emotion: CharacterEmotion.optional(),
      visemes: z
        .array(
          z
            .object({
              frame: Frame,
              shape: z.enum(["rest", "a", "e", "o", "u", "m"]),
            })
            .strict(),
        )
        .min(1)
        .max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("gesture"),
      ...ActionBase,
      preset: CharacterGesture,
      hand: z.enum(["left", "right", "both"]).default("both"),
      intensity: Unit.default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("react"),
      ...ActionBase,
      preset: CharacterEmotion.exclude(["neutral"]),
      intensity: Unit.default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("point"),
      ...ActionBase,
      target: CharacterTarget,
      hand: Hand.default("right"),
    })
    .strict(),
  z
    .object({
      type: z.literal("showProp"),
      ...ActionBase,
      propId: Key,
      hand: Hand.default("right"),
      target: CharacterTarget.optional(),
      interaction: z.enum(["reveal", "pickUp", "place", "release"]).default("reveal"),
      releaseFrame: Frame.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("face"),
      ...ActionBase,
      browTilt: z.number().min(-1).max(1).optional(),
      eyeOpen: z.number().min(0.02).max(2).optional(),
      mouthCurve: z.number().min(-1).max(1).optional(),
      headTilt: z.number().min(-30).max(30).optional(),
    })
    .strict()
    .refine(
      (action) =>
        action.browTilt !== undefined ||
        action.eyeOpen !== undefined ||
        action.mouthCurve !== undefined ||
        action.headTilt !== undefined,
      { message: "Face action requires at least one numeric override" },
    ),
]);
export type CharacterAction = z.infer<typeof CharacterAction>;
export type CharacterChannel = z.infer<typeof CharacterChannel>;
/** Shared compiler/validator ownership, before an optional body mask. */
export function characterActionChannels(action: CharacterAction): CharacterChannel[] {
  const arms =
    "hand" in action && action.hand !== "both"
      ? [`${action.hand}Arm` as const]
      : (["leftArm", "rightArm"] as const);
  let channels: CharacterChannel[];
  switch (action.type) {
    case "enter":
      channels = ["transform"];
      break;
    case "look":
      channels = ["gaze", "head"];
      break;
    case "blink":
      channels = ["eyes"];
      break;
    case "talk":
      channels = action.emotion ? ["mouth", "emotion"] : ["mouth"];
      break;
    case "gesture":
      channels = [...arms];
      break;
    case "react":
      channels = ["emotion", "body"];
      break;
    case "point":
      channels = [...arms];
      break;
    case "showProp":
      channels = [...arms];
      break;
    case "face":
      channels = ["emotion", "head"];
      break;
  }
  return channels;
}

export const CharacterProp = z
  .object({
    label: z.string().trim().min(1).max(120),
    width: z.number().positive().max(1000),
    height: z.number().positive().max(1000),
    shapes: z.array(CharacterShape).min(1).max(32),
    x: Unit,
    y: Unit,
    scale: z.number().min(0.1).max(3).default(1),
    rotation: z.number().min(-360).max(360).default(0),
    initiallyVisible: z.boolean().default(true),
    grip: RigPoint,
    attachment: z
      .object({
        actorId: Key,
        hand: Hand,
        offset: RigPoint,
        rotation: z.number().min(-360).max(360).default(0),
      })
      .strict()
      .optional(),
  })
  .strict();
const Overlay = z
  .object({
    text: z.string().trim().min(1).max(500),
    x: Unit,
    y: Unit,
    startFrame: Frame,
    endFrame: z.number().int().min(1).max(72000),
    style: z.enum(["caption", "price-old", "price-new", "savings", "callout", "cta"]),
    emphasis: z.string().trim().min(1).max(120).optional(),
    accent: Color.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endFrame <= value.startFrame)
      ctx.addIssue({
        code: "custom",
        path: ["endFrame"],
        message: "Overlay endFrame must be after startFrame",
      });
    if (value.emphasis && !["savings", "callout"].includes(value.style))
      ctx.addIssue({
        code: "custom",
        path: ["emphasis"],
        message: "Emphasis is only valid for savings and callout overlays",
      });
  });
const EnvironmentLayer = z
  .object({
    id: Key,
    plane: z.enum(["background", "midground", "foreground"]),
    shape: z.enum(["orb", "panel", "sweep"]),
    x: Unit,
    y: Unit,
    width: z.number().positive().max(2),
    height: z.number().positive().max(2),
    color: Color,
    opacity: Unit,
    parallax: Unit,
  })
  .strict();
export const CharacterSceneProps = z
  .object({
    timebase: VideoTimebase,
    seed: z.number().int().min(0).max(0xffffffff),
    staging: z
      .object({
        layout: z.enum(["single-product", "two-shot", "reaction-closeup"]),
        focalActorId: Key.optional(),
        productPropId: Key.optional(),
      })
      .strict(),
    camera: z
      .object({
        movement: z.enum(["locked", "push-in", "pan-left", "pan-right", "reframe"]),
        startFrame: Frame,
        durationFrames: DurationFrames,
        holdFrames: Frame.default(0),
        intensity: Unit.default(0.5),
      })
      .strict(),
    environment: z
      .object({
        background: Color,
        horizonY: Unit,
        ground: Color,
        accent: Color,
        layers: z.array(EnvironmentLayer).max(12),
      })
      .strict(),
    characterPacksById: z.record(Key, CharacterPack),
    actorOrder: z.array(Key).min(1).max(8),
    actorsById: z.record(
      Key,
      z
        .object({
          characterPackId: Key,
          x: Unit,
          y: Unit,
          scale: z.number().min(0.1).max(3),
          facing: z.enum(["left", "right"]),
          initialEmotion: CharacterEmotion,
        })
        .strict(),
    ),
    propOrder: z.array(Key).max(32).default([]),
    propsById: z.record(Key, CharacterProp).default({}),
    actionOrder: z.array(Key).max(200),
    actionsById: z.record(Key, CharacterAction),
    overlayOrder: z.array(Key).max(32).default([]),
    overlaysById: z.record(Key, Overlay).default({}),
    caption: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((props, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    const ordered = (order: string[], records: Record<string, unknown>, path: string) => {
      if (
        new Set(order).size !== order.length ||
        order.length !== Object.keys(records).length ||
        order.some((id) => !Object.hasOwn(records, id))
      )
        issue([path], "Order must contain every stable ID exactly once");
    };
    ordered(props.actorOrder, props.actorsById, "actorOrder");
    ordered(props.propOrder, props.propsById, "propOrder");
    ordered(props.actionOrder, props.actionsById, "actionOrder");
    ordered(props.overlayOrder, props.overlaysById, "overlayOrder");
    if (Object.keys(props.characterPacksById).length > 8)
      issue(["characterPacksById"], "At most 8 character packs per scene");
    for (const [id, pack] of Object.entries(props.characterPacksById))
      if (id !== pack.id) issue(["characterPacksById", id, "id"], "Pack ID must match its map key");
    for (const [id, actor] of Object.entries(props.actorsById)) {
      const pack = props.characterPacksById[actor.characterPackId];
      if (!pack)
        issue(["actorsById", id, "characterPackId"], "Actor must reference a scene character pack");
      else if (!pack.capabilities.emotions.includes(actor.initialEmotion))
        issue(
          ["actorsById", id, "initialEmotion"],
          "Initial emotion is not supported by character pack",
        );
    }
    if (props.staging.focalActorId && !Object.hasOwn(props.actorsById, props.staging.focalActorId))
      issue(["staging", "focalActorId"], "Focal actor must reference a scene actor");
    if (props.staging.productPropId && !Object.hasOwn(props.propsById, props.staging.productPropId))
      issue(["staging", "productPropId"], "Product prop must reference a scene prop");
    if (
      new Set(props.environment.layers.map((layer) => layer.id)).size !==
      props.environment.layers.length
    )
      issue(["environment", "layers"], "Environment layer IDs must be unique");
    const targetValid = (
      target: z.infer<typeof CharacterTarget>,
      actorId: string,
      path: (string | number)[],
    ) => {
      if (
        target.kind === "actor" &&
        (!Object.hasOwn(props.actorsById, target.actorId) || target.actorId === actorId)
      )
        issue(path, "Target must reference a different actor in this scene");
      if (target.kind === "prop" && !Object.hasOwn(props.propsById, target.propId))
        issue(path, "Target must reference a scene prop");
      if (target.kind === "overlay" && !Object.hasOwn(props.overlaysById, target.overlayId))
        issue(path, "Target must reference a scene overlay");
    };
    for (const [id, prop] of Object.entries(props.propsById)) {
      if (!prop.attachment) continue;
      const actor = props.actorsById[prop.attachment.actorId];
      if (!actor || !props.characterPacksById[actor.characterPackId]?.capabilities.arms)
        issue(["propsById", id, "attachment"], "Attachment requires a scene actor with arms");
    }
    let previousStart = -1;
    const occupied = new Map<string, { start: number; end: number }[]>();
    const propOwners = new Map<string, { actorId: string; hand: "left" | "right" }>();
    for (const [propId, prop] of Object.entries(props.propsById))
      if (prop.attachment)
        propOwners.set(propId, {
          actorId: prop.attachment.actorId,
          hand: prop.attachment.hand,
        });
    for (const actionId of props.actionOrder) {
      const action = props.actionsById[actionId];
      if (!action) continue;
      const path = ["actionsById", actionId];
      if (action.startFrame < previousStart)
        issue(["actionOrder"], "Actions must be ordered by non-decreasing startFrame");
      previousStart = action.startFrame;
      const actor = props.actorsById[action.actorId],
        pack = actor && props.characterPacksById[actor.characterPackId];
      if (action.acting) {
        const { anticipationFrames, accentFrame, holdFrames, settleFrames } = action.acting;
        if (accentFrame < anticipationFrames)
          issue([...path, "acting", "accentFrame"], "Accent must not precede anticipation");
        if (accentFrame + holdFrames + settleFrames > action.durationFrames)
          issue([...path, "acting"], "Accent, hold and settle must fit inside the action");
      }
      if (!actor) issue([...path, "actorId"], "Action actorId must refer to a scene actor");
      if ("target" in action && action.target)
        targetValid(action.target, action.actorId, [...path, "target"]);
      if (action.type === "point" && action.target.kind === "camera")
        issue([...path, "target"], "Point requires a spatial target");
      if (pack) {
        const needed =
          action.type === "look"
            ? "gaze"
            : action.type === "blink"
              ? "blink"
              : action.type === "talk"
                ? "talk"
                : ["gesture", "point", "showProp"].includes(action.type)
                  ? "arms"
                  : null;
        if (needed && !pack.capabilities[needed])
          issue(path, `Character pack does not support ${needed}`);
        if (action.type === "gesture" && !pack.capabilities.gestures.includes(action.preset))
          issue([...path, "preset"], "Gesture is not supported by character pack");
        const emotion =
          action.type === "react"
            ? action.preset
            : action.type === "talk"
              ? action.emotion
              : undefined;
        if (emotion && !pack.capabilities.emotions.includes(emotion))
          issue(path, "Emotion is not supported by character pack");
      }
      if (action.type === "showProp") {
        const prop = props.propsById[action.propId];
        if (!prop) issue([...path, "propId"], "showProp must reference a scene prop");
        else if (
          prop.attachment &&
          (prop.attachment.actorId !== action.actorId || prop.attachment.hand !== action.hand)
        )
          issue(path, "showProp must use the prop's attached actor and hand");
        if (action.releaseFrame !== undefined && action.releaseFrame >= action.durationFrames)
          issue([...path, "releaseFrame"], "releaseFrame must be local to and inside the action");
        if (action.interaction === "release" && action.releaseFrame === undefined)
          issue([...path, "releaseFrame"], "release interaction requires releaseFrame");
        if (action.weight > 0) {
          const owner = propOwners.get(action.propId);
          if (action.interaction === "place" || action.interaction === "release") {
            if (!owner || owner.actorId !== action.actorId || owner.hand !== action.hand)
              issue(path, `${action.interaction} requires prior ownership by this actor and hand`);
            propOwners.delete(action.propId);
          } else {
            if (action.interaction === "pickUp" && owner)
              issue(path, "pickUp requires an unowned prop");
            propOwners.set(action.propId, { actorId: action.actorId, hand: action.hand });
          }
        }
      }
      if (action.type === "talk")
        for (const [index, viseme] of action.visemes.entries())
          if (
            viseme.frame >= action.durationFrames ||
            (index > 0 && viseme.frame <= (action.visemes[index - 1]?.frame ?? -1))
          )
            issue(
              [...path, "visemes", index, "frame"],
              "Viseme frames must increase and fit within talk action",
            );
      const channels = characterActionChannels(action);
      if (
        action.mask &&
        (new Set(action.mask).size !== action.mask.length ||
          action.mask.some((channel) => !channels.includes(channel)))
      )
        issue([...path, "mask"], "Mask must contain unique channels owned by this action");
      const owners = action.mask ?? channels;
      if (action.type === "showProp" && !owners.includes(`${action.hand}Arm`))
        issue([...path, "mask"], "showProp must own the attaching arm");
      if (action.weight === 0) continue;
      for (const owner of [
        ...owners.map((channel) => `${action.actorId}:${channel}:${action.priority}`),
        ...(action.type === "showProp" ? [`prop:${action.propId}`] : []),
      ]) {
        const windows = occupied.get(owner) ?? [];
        if (
          windows.some(
            (window) =>
              action.startFrame < window.end &&
              window.start < action.startFrame + action.durationFrames,
          )
        )
          issue(
            path,
            `Action conflicts with ${owner} ownership; use distinct priority for actor channel overrides`,
          );
        windows.push({
          start: action.startFrame,
          end: action.startFrame + action.durationFrames,
        });
        occupied.set(owner, windows);
      }
    }
    if (new TextEncoder().encode(JSON.stringify(props)).byteLength > 524288)
      issue([], "Character scene exceeds 512KiB props");
  });
export type CharacterSceneProps = z.infer<typeof CharacterSceneProps>;
export type CharacterPack = z.infer<typeof CharacterPack>;
export type CharacterTarget = z.infer<typeof CharacterTarget>;
export type CharacterProp = z.infer<typeof CharacterProp>;
export type CharacterShape = z.infer<typeof CharacterShape>;
