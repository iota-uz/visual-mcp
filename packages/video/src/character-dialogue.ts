import { z } from "zod";
import {
  CharacterAction,
  CharacterEmotion,
  CharacterGesture,
  CharacterTarget,
  VideoTimebase,
} from "./character.js";
import { AssetRef } from "./refs.js";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Frame = z.number().int().min(0).max(72000);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Timing = z
  .object({
    characters: z.array(z.string().min(1).max(8)).min(1).max(100000),
    character_start_times_seconds: z.array(z.number().finite().nonnegative()).min(1).max(100000),
    character_end_times_seconds: z.array(z.number().finite().nonnegative()).min(1).max(100000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const count = value.characters.length;
    if (
      value.character_start_times_seconds.length !== count ||
      value.character_end_times_seconds.length !== count
    )
      ctx.addIssue({ code: "custom", message: "Alignment arrays must have equal lengths" });
    for (
      let index = 0;
      index < Math.min(count, value.character_end_times_seconds.length);
      index++
    ) {
      const start = value.character_start_times_seconds[index]!;
      const end = value.character_end_times_seconds[index]!;
      if (end < start || (index > 0 && start < value.character_start_times_seconds[index - 1]!))
        ctx.addIssue({
          code: "custom",
          path: ["character_start_times_seconds", index],
          message: "Alignment timing must be ordered and each end must follow its start",
        });
    }
  });

export const ElevenLabsAlignmentArtifact = z
  .object({
    original: Timing.nullable(),
    normalized: Timing.nullable(),
    language: z.enum(["ru", "uz"]),
  })
  .strict()
  .refine((value) => value.normalized !== null || value.original !== null, {
    message: "Required ElevenLabs alignment is missing",
  });

const PinnedArtifact = z.object({ asset: AssetRef, sha256: Hash }).strict();
const PinnedVoice = z
  .object({
    ...PinnedArtifact.shape,
    mimeType: z.enum(["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]),
    durationFrames: z.number().int().min(1).max(72000),
    alignment: z
      .object({
        ...PinnedArtifact.shape,
        provider: z.literal("elevenlabs"),
        timingBasis: z.literal("provider_supplied"),
        artifact: ElevenLabsAlignmentArtifact,
      })
      .strict(),
  })
  .strict();

const ListenerDirection = z
  .object({
    target: CharacterTarget.optional(),
    reaction: CharacterEmotion.exclude(["neutral"]).nullable().optional(),
    reactionDelayFrames: Frame.max(600).optional(),
  })
  .strict();

export const CharacterSay = z
  .object({
    id: Key,
    sceneId: Key.optional(),
    actorId: Key,
    text: z
      .string()
      .min(1)
      .max(5000)
      .refine((text) => text.trim().length > 0, "Dialogue text cannot be blank"),
    startFrame: Frame,
    target: CharacterTarget,
    emotion: CharacterEmotion,
    gesture: CharacterGesture.nullable(),
    voice: PinnedVoice,
    listenersByActorId: z.record(Key, ListenerDirection).default({}),
  })
  .strict();

export const CharacterDialoguePlan = z
  .object({
    timebase: VideoTimebase,
    durationFrames: z.number().int().min(1).max(72000),
    lineOrder: z.array(Key).min(1).max(200),
    linesById: z.record(Key, CharacterSay),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (
      new Set(plan.lineOrder).size !== plan.lineOrder.length ||
      plan.lineOrder.length !== Object.keys(plan.linesById).length ||
      plan.lineOrder.some((id) => !Object.hasOwn(plan.linesById, id))
    )
      ctx.addIssue({
        code: "custom",
        path: ["lineOrder"],
        message: "Line order must contain every line exactly once",
      });
    for (const [id, line] of Object.entries(plan.linesById)) {
      if (line.id !== id)
        ctx.addIssue({
          code: "custom",
          path: ["linesById", id, "id"],
          message: "Line ID must match its record key",
        });
      if (line.startFrame + line.voice.durationFrames > plan.durationFrames)
        ctx.addIssue({
          code: "custom",
          path: ["linesById", id],
          message: "Voice exceeds dialogue frame bounds",
        });
    }
  });

export type CharacterDialoguePlan = z.infer<typeof CharacterDialoguePlan>;
export type ElevenLabsAlignmentArtifact = z.infer<typeof ElevenLabsAlignmentArtifact>;
export type SpeechWindow = { startFrame: number; durationFrames: number };
export type NormalizedDialogueLine = {
  words: Array<{ text: string; startFrame: number; endFrame: number }>;
  speechWindows: SpeechWindow[];
};

const secondsToFrame = (seconds: number, timebase: z.infer<typeof VideoTimebase>) =>
  Math.round((seconds * timebase.numerator) / timebase.denominator);

function viseme(character: string): "rest" | "a" | "e" | "o" | "u" | "m" {
  const value = character.toLocaleLowerCase();
  if (/\s/u.test(value)) return "rest";
  if (/[мбпmɓbp]/u.test(value)) return "m";
  if (/[оөүoʻòó]/u.test(value)) return "o";
  if (/[уўүu]/u.test(value)) return "u";
  if (/[эеёиэeə]/u.test(value)) return "e";
  return "a";
}

/** Normalizes the exact JSON artifact emitted by the existing ElevenLabs adapter. */
export function normalizeElevenLabsAlignment(input: {
  artifact: unknown;
  text: string;
  durationFrames: number;
  timebase: z.infer<typeof VideoTimebase>;
}) {
  const artifact = ElevenLabsAlignmentArtifact.parse(input.artifact);
  const timing =
    artifact.normalized?.characters.join("") === input.text
      ? artifact.normalized
      : artifact.original?.characters.join("") === input.text
        ? artifact.original
        : null;
  if (!timing)
    throw new Error("ElevenLabs alignment characters do not exactly match dialogue text");
  const starts = timing.character_start_times_seconds.map((time) =>
    secondsToFrame(time, input.timebase),
  );
  const ends = timing.character_end_times_seconds.map((time) =>
    secondsToFrame(time, input.timebase),
  );
  if (ends.some((frame) => frame > input.durationFrames))
    throw new Error("ElevenLabs alignment exceeds pinned voice duration");

  const visemes: Array<{ frame: number; shape: ReturnType<typeof viseme> }> = [];
  const addViseme = (frame: number, shape: ReturnType<typeof viseme>) => {
    const bounded = Math.min(input.durationFrames - 1, Math.max(0, frame));
    const last = visemes.at(-1);
    if (last?.frame === bounded) last.shape = shape;
    else if (last?.shape !== shape) visemes.push({ frame: bounded, shape });
  };
  addViseme(0, "rest");
  for (let index = 0; index < timing.characters.length; index++) {
    const start = starts[index]!;
    if (index > 0 && start > ends[index - 1]!) addViseme(ends[index - 1]!, "rest");
    addViseme(start, viseme(timing.characters[index]!));
  }
  const finalEnd = ends.at(-1)!;
  if (finalEnd < input.durationFrames) addViseme(finalEnd, "rest");

  const words: NormalizedDialogueLine["words"] = [];
  let wordStart = -1;
  for (let index = 0; index <= timing.characters.length; index++) {
    const character = timing.characters[index];
    if (character !== undefined && !/\s/u.test(character)) {
      if (wordStart < 0) wordStart = index;
    } else if (wordStart >= 0) {
      words.push({
        text: timing.characters.slice(wordStart, index).join(""),
        startFrame: starts[wordStart]!,
        endFrame: ends[index - 1]!,
      });
      wordStart = -1;
    }
  }

  const speechWindows: SpeechWindow[] = [];
  const maxGap = Math.max(1, secondsToFrame(0.16, input.timebase));
  for (const word of words) {
    const previous = speechWindows.at(-1);
    if (previous && word.startFrame <= previous.startFrame + previous.durationFrames + maxGap)
      previous.durationFrames = word.endFrame - previous.startFrame;
    else
      speechWindows.push({
        startFrame: word.startFrame,
        durationFrames: Math.max(1, word.endFrame - word.startFrame),
      });
  }
  return { visemes, words, speechWindows };
}

export function compileCharacterDialogue(input: unknown) {
  const plan = CharacterDialoguePlan.parse(input);
  const actionOrder: string[] = [];
  const actionsById: Record<string, CharacterAction> = {};
  const lineIdByActionId: Record<string, string> = {};
  const sceneIdByActionId: Record<string, string> = {};
  const normalizedByLineId: Record<string, NormalizedDialogueLine> = {};
  const actors = [...new Set(plan.lineOrder.map((id) => plan.linesById[id]!.actorId))].sort();
  const intervals = plan.lineOrder.map((id) => {
    const line = plan.linesById[id]!;
    return {
      id,
      actorId: line.actorId,
      start: line.startFrame,
      end: line.startFrame + line.voice.durationFrames,
    };
  });
  for (let left = 0; left < intervals.length; left++)
    for (let right = left + 1; right < intervals.length; right++) {
      const a = intervals[left]!,
        b = intervals[right]!;
      if (a.actorId === b.actorId && a.start < b.end && b.start < a.end)
        throw new Error(`Actor ${a.actorId} has overlapping dialogue lines ${a.id} and ${b.id}`);
    }
  const add = (
    id: string,
    lineId: string,
    sceneId: string | undefined,
    value: z.input<typeof CharacterAction>,
  ) => {
    if (actionsById[id]) throw new Error(`Generated action conflict for ${id}`);
    actionsById[id] = CharacterAction.parse(value);
    lineIdByActionId[id] = lineId;
    if (sceneId) sceneIdByActionId[id] = sceneId;
    actionOrder.push(id);
  };
  for (const [lineIndex, lineId] of plan.lineOrder.entries()) {
    const line = plan.linesById[lineId]!;
    const normalized = normalizeElevenLabsAlignment({
      artifact: line.voice.alignment.artifact,
      text: line.text,
      durationFrames: line.voice.durationFrames,
      timebase: plan.timebase,
    });
    normalizedByLineId[lineId] = {
      words: normalized.words,
      speechWindows: normalized.speechWindows,
    };
    const base = {
      actorId: line.actorId,
      startFrame: line.startFrame,
      durationFrames: line.voice.durationFrames,
    };
    const lineKey = `dialogue-${lineIndex}`;
    add(`${lineKey}-talk`, lineId, line.sceneId, {
      type: "talk",
      ...base,
      emotion: line.emotion,
      visemes: normalized.visemes,
    });
    add(`${lineKey}-gaze`, lineId, line.sceneId, { type: "look", ...base, target: line.target });
    if (line.gesture)
      add(`${lineKey}-gesture`, lineId, line.sceneId, {
        type: "gesture",
        ...base,
        preset: line.gesture,
      });
    const listenerIds = [
      ...new Set([
        ...actors.filter((id) => id !== line.actorId),
        ...Object.keys(line.listenersByActorId),
      ]),
    ].sort();
    for (const [listenerIndex, listenerId] of listenerIds.entries()) {
      if (listenerId === line.actorId)
        throw new Error(`Speaker ${listenerId} cannot also listen to line ${lineId}`);
      const overlap = intervals.some(
        (value) =>
          value.actorId === listenerId &&
          value.start < base.startFrame + base.durationFrames &&
          base.startFrame < value.end,
      );
      const explicit = line.listenersByActorId[listenerId];
      if (overlap) {
        if (explicit)
          throw new Error(
            `Explicit listener ${listenerId} conflicts with its own speech during ${lineId}`,
          );
        continue;
      }
      const listenerKey = `${lineKey}-listener-${listenerIndex}`;
      add(`${listenerKey}-gaze`, lineId, line.sceneId, {
        type: "look",
        ...base,
        actorId: listenerId,
        target: explicit?.target ?? { kind: "actor", actorId: line.actorId },
      });
      const reaction = explicit?.reaction === undefined ? "thinking" : explicit.reaction;
      if (reaction) {
        const delay =
          explicit?.reactionDelayFrames ??
          Math.min(base.durationFrames - 1, secondsToFrame(0.18, plan.timebase));
        add(`${listenerKey}-reaction`, lineId, line.sceneId, {
          type: "react",
          actorId: listenerId,
          startFrame: base.startFrame + delay,
          durationFrames: Math.max(1, base.durationFrames - delay),
          preset: reaction,
          intensity: 0.22,
        });
      }
    }
  }
  actionOrder.sort(
    (a, b) => actionsById[a]!.startFrame - actionsById[b]!.startFrame || a.localeCompare(b),
  );
  return {
    timebase: plan.timebase,
    actionOrder,
    actionsById,
    normalizedByLineId,
    lineIdByActionId,
    sceneIdByActionId,
  };
}
