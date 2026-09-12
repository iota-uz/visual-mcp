import { z } from "zod";
import { CharacterAction, CharacterEmotion, CharacterTarget, VideoTimebase } from "./character.js";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const BeatKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,51}$/);
const Frame = z.number().int().min(0).max(72000);
const Duration = z.number().int().min(1).max(72000);
const Unit = z.number().min(0).max(1);
const Hand = z.enum(["left", "right"]);

export const ActingPhaseTiming = z
  .object({
    anticipationFrames: Frame.max(600).optional(),
    accentFrame: Frame.max(600).optional(),
    holdFrames: Frame.max(600).optional(),
    settleFrames: Frame.max(600).optional(),
    gazeLeadFrames: Frame.max(600).optional(),
    secondaryDelayFrames: Frame.max(600).optional(),
  })
  .strict();

const BeatBase = {
  id: BeatKey,
  actorId: Key,
  startFrame: Frame,
  durationFrames: Duration,
  intensity: Unit.default(1),
  stillness: Unit.default(0.35),
  timing: ActingPhaseTiming.optional(),
};

export const CharacterActingBeat = z.discriminatedUnion("type", [
  z
    .object({
      ...BeatBase,
      type: z.literal("notice"),
      target: CharacterTarget,
      emotion: CharacterEmotion.exclude(["neutral"]).default("shocked"),
    })
    .strict(),
  z
    .object({
      ...BeatBase,
      type: z.literal("explain"),
      target: CharacterTarget.optional(),
      hand: z.enum(["left", "right", "both"]).default("both"),
      emotion: CharacterEmotion.optional(),
    })
    .strict(),
  z
    .object({
      ...BeatBase,
      type: z.literal("point"),
      target: CharacterTarget,
      hand: Hand.default("right"),
      emotion: CharacterEmotion.optional(),
    })
    .strict(),
  z
    .object({
      ...BeatBase,
      type: z.literal("react"),
      emotion: CharacterEmotion.exclude(["neutral"]),
      target: CharacterTarget.optional(),
    })
    .strict(),
  z
    .object({
      ...BeatBase,
      type: z.literal("show_prop"),
      propId: Key,
      hand: Hand.default("right"),
      target: CharacterTarget.optional(),
      interaction: z.enum(["reveal", "pickUp", "place", "release"]).default("reveal"),
      releaseFrame: Frame.optional(),
      emotion: CharacterEmotion.optional(),
    })
    .strict(),
  z
    .object({
      ...BeatBase,
      type: z.literal("face"),
      browTilt: z.number().min(-1).max(1).optional(),
      eyeOpen: z.number().min(0.02).max(2).optional(),
      mouthCurve: z.number().min(-1).max(1).optional(),
      headTilt: z.number().min(-30).max(30).optional(),
    })
    .strict()
    .refine(
      (beat) =>
        beat.browTilt !== undefined ||
        beat.eyeOpen !== undefined ||
        beat.mouthCurve !== undefined ||
        beat.headTilt !== undefined,
      { message: "Face beat requires at least one numeric override" },
    ),
]);

export type CharacterActingBeat = z.infer<typeof CharacterActingBeat>;
export type ActingPhaseTiming = z.infer<typeof ActingPhaseTiming>;

export const CharacterActingPlan = z
  .object({
    timebase: VideoTimebase,
    beats: z.array(CharacterActingBeat).min(1).max(100),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (new Set(plan.beats.map((beat) => beat.id)).size !== plan.beats.length)
      ctx.addIssue({ code: "custom", path: ["beats"], message: "Acting beat IDs must be unique" });
    for (const [index, beat] of plan.beats.entries()) {
      if (beat.type === "point" && beat.target.kind === "camera")
        ctx.addIssue({
          code: "custom",
          path: ["beats", index, "target"],
          message: "Point requires a spatial target",
        });
      if (
        beat.type === "show_prop" &&
        beat.interaction === "release" &&
        beat.releaseFrame === undefined
      )
        ctx.addIssue({
          code: "custom",
          path: ["beats", index, "releaseFrame"],
          message: "release interaction requires releaseFrame",
        });
      if (
        beat.type === "show_prop" &&
        beat.releaseFrame !== undefined &&
        beat.releaseFrame >= beat.durationFrames
      )
        ctx.addIssue({
          code: "custom",
          path: ["beats", index, "releaseFrame"],
          message: "releaseFrame must fit inside the beat",
        });
      const timing = beat.timing;
      if (timing) {
        const anticipation = timing.anticipationFrames ?? 0;
        const accent = timing.accentFrame;
        if (accent !== undefined && accent < anticipation)
          ctx.addIssue({
            code: "custom",
            path: ["beats", index, "timing", "accentFrame"],
            message: "accentFrame must not precede anticipation",
          });
        if (
          accent !== undefined &&
          accent + (timing.holdFrames ?? 0) + (timing.settleFrames ?? 0) > beat.durationFrames
        )
          ctx.addIssue({
            code: "custom",
            path: ["beats", index, "timing"],
            message: "Accent, hold and settle must fit inside the beat",
          });
      }
    }
  });

export type CharacterActingPlan = z.infer<typeof CharacterActingPlan>;

export type CompiledCharacterActing = {
  timebase: z.infer<typeof VideoTimebase>;
  actionOrder: string[];
  actionsById: Record<string, CharacterAction>;
};

function frames(seconds: number, timebase: z.infer<typeof VideoTimebase>) {
  return Math.max(0, Math.round((seconds * timebase.numerator) / timebase.denominator));
}

function resolvedTiming(beat: CharacterActingBeat, timebase: z.infer<typeof VideoTimebase>) {
  const bounded = (value: number, share = 1) =>
    Math.min(600, Math.floor(beat.durationFrames * share), value);
  const anticipationFrames =
    beat.timing?.anticipationFrames ?? bounded(frames(0.16, timebase), 0.2);
  const travelFrames = bounded(frames(0.12, timebase), 0.2);
  const accentFrame = beat.timing?.accentFrame ?? anticipationFrames + travelFrames;
  const remaining = Math.max(0, beat.durationFrames - accentFrame);
  const holdFrames =
    beat.timing?.holdFrames ??
    Math.min(bounded(frames(0.24, timebase)), Math.floor(remaining * 0.55));
  const settleFrames =
    beat.timing?.settleFrames ?? Math.min(bounded(frames(0.2, timebase)), remaining - holdFrames);
  const gazeLeadFrames = beat.timing?.gazeLeadFrames ?? frames(0.1, timebase);
  const secondaryDelayFrames = beat.timing?.secondaryDelayFrames ?? frames(0.08, timebase);
  const local = (value: number) => Math.min(600, beat.durationFrames - 1, value);
  return {
    anticipationFrames: local(anticipationFrames),
    accentFrame: local(accentFrame),
    holdFrames: local(holdFrames),
    settleFrames: local(settleFrames),
    gazeLeadFrames: local(gazeLeadFrames),
    secondaryDelayFrames: local(secondaryDelayFrames),
    stillness: beat.stillness,
  };
}

/** Compiles semantic acting direction into seek-safe frame actions with no ambient clock. */
export function compileCharacterActing(input: unknown): CompiledCharacterActing {
  const plan = CharacterActingPlan.parse(input);
  const actionsById: Record<string, CharacterAction> = {};
  const actionOrder: string[] = [];
  const add = (id: string, action: z.input<typeof CharacterAction>) => {
    actionOrder.push(id);
    actionsById[id] = CharacterAction.parse(action);
  };
  for (const beat of plan.beats) {
    const acting = resolvedTiming(beat, plan.timebase);
    const base = {
      actorId: beat.actorId,
      startFrame: beat.startFrame,
      durationFrames: beat.durationFrames,
      acting,
    };
    const gazeStart = Math.max(0, beat.startFrame - acting.gazeLeadFrames);
    const gazeBase = {
      actorId: beat.actorId,
      startFrame: gazeStart,
      durationFrames: beat.durationFrames + beat.startFrame - gazeStart,
      acting,
    };
    if ("target" in beat && beat.target)
      add(`${beat.id}-gaze`, { type: "look", ...gazeBase, target: beat.target });
    if (beat.type === "notice")
      add(`${beat.id}-reaction`, {
        type: "react",
        ...base,
        preset: beat.emotion,
        intensity: beat.intensity,
      });
    if (beat.type === "explain")
      add(`${beat.id}-gesture`, {
        type: "gesture",
        ...base,
        preset: "explain",
        hand: beat.hand,
        intensity: beat.intensity,
      });
    if (beat.type === "point")
      add(`${beat.id}-point`, { type: "point", ...base, target: beat.target, hand: beat.hand });
    if (beat.type === "react")
      add(`${beat.id}-reaction`, {
        type: "react",
        ...base,
        preset: beat.emotion,
        intensity: beat.intensity,
      });
    if (beat.type === "show_prop")
      add(`${beat.id}-prop`, {
        type: "showProp",
        ...base,
        propId: beat.propId,
        hand: beat.hand,
        target: beat.target,
        interaction: beat.interaction,
        releaseFrame: beat.releaseFrame,
      });
    if (beat.type === "face")
      add(`${beat.id}-face`, {
        type: "face",
        ...base,
        browTilt: beat.browTilt,
        eyeOpen: beat.eyeOpen,
        mouthCurve: beat.mouthCurve,
        headTilt: beat.headTilt,
      });
    if (
      "emotion" in beat &&
      beat.emotion &&
      beat.emotion !== "neutral" &&
      beat.type !== "notice" &&
      beat.type !== "react"
    )
      add(`${beat.id}-face`, {
        type: "react",
        ...base,
        preset: beat.emotion,
        intensity: beat.intensity,
      });
  }
  const startFrameOf = (id: string) => {
    const action = actionsById[id];
    if (!action) throw new Error(`Compiler lost generated action ${id}`);
    return action.startFrame;
  };
  actionOrder.sort((left, right) => startFrameOf(left) - startFrameOf(right));
  const lastGazeByActor = new Map<string, CharacterAction>();
  for (const id of actionOrder) {
    const action = actionsById[id];
    if (!action) throw new Error(`Compiler lost generated action ${id}`);
    if (action.type !== "look") continue;
    const previous = lastGazeByActor.get(action.actorId);
    if (previous && previous.startFrame + previous.durationFrames > action.startFrame)
      previous.durationFrames = Math.max(1, action.startFrame - previous.startFrame);
    lastGazeByActor.set(action.actorId, action);
  }
  return { timebase: plan.timebase, actionOrder, actionsById };
}
