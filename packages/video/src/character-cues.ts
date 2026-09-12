import { z } from "zod";
import { AssetRef } from "./refs.js";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Frame = z.number().int().min(0).max(72000);
const Timebase = z
  .object({
    numerator: z.number().int().min(1).max(60000),
    denominator: z.number().int().min(1).max(1001),
  })
  .strict();

const PinnedSound = z
  .object({
    asset: AssetRef,
    durationFrames: z.number().int().min(1).max(72000),
    gainDb: z.number().min(-60).max(18).default(0),
    fadeInFrames: Frame.default(0),
    fadeOutFrames: Frame.default(0),
  })
  .strict()
  .refine((sound) => sound.fadeInFrames + sound.fadeOutFrames <= sound.durationFrames, {
    message: "Sound fades must fit within its durationFrames",
  });

export const CharacterCueSheet = z
  .object({
    timebase: Timebase,
    soundOrder: z.array(Key).max(64),
    soundsById: z.record(Key, PinnedSound),
    cueOrder: z.array(Key).max(200),
    cuesById: z.record(
      Key,
      z
        .object({
          eventId: Key,
          soundId: Key,
          offsetFrames: z.number().int().min(-600).max(600).default(0),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((sheet, ctx) => {
    const ordered = (order: string[], record: Record<string, unknown>, path: string) => {
      if (
        new Set(order).size !== order.length ||
        order.length !== Object.keys(record).length ||
        order.some((id) => !Object.hasOwn(record, id))
      )
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: "Order must contain every stable ID exactly once",
        });
    };
    ordered(sheet.soundOrder, sheet.soundsById, "soundOrder");
    ordered(sheet.cueOrder, sheet.cuesById, "cueOrder");
    for (const [id, cue] of Object.entries(sheet.cuesById))
      if (!Object.hasOwn(sheet.soundsById, cue.soundId))
        ctx.addIssue({
          code: "custom",
          path: ["cuesById", id, "soundId"],
          message: "Cue must reference a pinned sound",
        });
  });

export type CharacterCueSheet = z.infer<typeof CharacterCueSheet>;

export type SemanticCueEvent = { frame: number };

export type CompiledCharacterCue = {
  startFrame: number;
  durationFrames: number;
  source: { kind: "asset"; asset: z.infer<typeof AssetRef> };
  audio: { gainDb: number; fadeInMs: number; fadeOutMs: number };
};

/** Resolves semantic beats into ordinary pinned timeline SFX clips. */
export function compileCharacterCues(input: {
  sheet: CharacterCueSheet;
  eventsById: Record<string, SemanticCueEvent>;
  timeline: {
    timebase: z.infer<typeof Timebase>;
    durationFrames: number;
  };
}) {
  const sheet = CharacterCueSheet.parse(input.sheet);
  const timeline = z
    .object({
      timebase: Timebase,
      durationFrames: z.number().int().min(1).max(72000),
    })
    .strict()
    .parse(input.timeline);
  if (
    sheet.timebase.numerator !== timeline.timebase.numerator ||
    sheet.timebase.denominator !== timeline.timebase.denominator
  )
    throw new Error("Character cue sheet timebase must match the timeline");
  const fps = sheet.timebase.numerator / sheet.timebase.denominator;
  const clipsById: Record<string, CompiledCharacterCue> = {};
  for (const cueId of sheet.cueOrder) {
    const cue = sheet.cuesById[cueId]!;
    const event = input.eventsById[cue.eventId];
    if (!event) throw new Error(`Character cue ${cueId} references missing event ${cue.eventId}`);
    const sound = sheet.soundsById[cue.soundId]!;
    const startFrame = event.frame + cue.offsetFrames;
    if (
      !Number.isInteger(event.frame) ||
      startFrame < 0 ||
      startFrame + sound.durationFrames > timeline.durationFrames
    )
      throw new Error(`Character cue ${cueId} exceeds timeline frame bounds`);
    clipsById[cueId] = {
      startFrame,
      durationFrames: sound.durationFrames,
      source: { kind: "asset", asset: sound.asset },
      audio: {
        gainDb: sound.gainDb,
        fadeInMs: Math.round((sound.fadeInFrames / fps) * 1000),
        fadeOutMs: Math.round((sound.fadeOutFrames / fps) * 1000),
      },
    };
  }
  return {
    clipOrder: [...sheet.cueOrder],
    clipsById,
    eventIdsByClipId: Object.fromEntries(
      sheet.cueOrder.map((cueId) => [cueId, sheet.cuesById[cueId]!.eventId]),
    ),
  };
}
