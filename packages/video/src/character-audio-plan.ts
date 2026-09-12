import { z } from "zod";
import { CharacterDialoguePlan, compileCharacterDialogue } from "./character-dialogue.js";
import { Timeline } from "./contracts.js";
import { MediaOperation } from "./operations.js";
import { AssetRef } from "./refs.js";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const AudioClip = z
  .object({
    id: Key,
    asset: AssetRef,
    sha256: Hash,
    mimeType: z.enum(["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]),
    sourceDurationFrames: z.number().int().min(1).max(72000),
    startFrame: z.number().int().min(0).max(72000),
    trimStartFrame: z.number().int().min(0).max(72000).default(0),
    trimEndFrame: z.number().int().min(1).max(72000).optional(),
    gainDb: z.number().min(-60).max(12),
    fadeInFrames: z.number().int().min(0).max(600).default(0),
    fadeOutFrames: z.number().int().min(0).max(600).default(0),
  })
  .strict();
export const CharacterAudioPlan = z
  .object({
    dialogue: CharacterDialoguePlan,
    music: z.array(AudioClip).max(16).default([]),
    sfx: z.array(AudioClip).max(32).default([]),
    ducking: z
      .object({
        reductionDb: z.number().min(0).max(30),
        attackMs: z.number().int().min(1).max(5000),
        releaseMs: z.number().int().min(1).max(10000),
      })
      .strict()
      .optional(),
    mastering: z
      .object({
        sampleRate: z.union([z.literal(44100), z.literal(48000)]),
        targetLufs: z.number().min(-24).max(-10),
        maxTruePeakDb: z.number().min(-9).max(-0.1),
        loudnessRange: z.number().min(1).max(20),
      })
      .strict(),
  })
  .strict();

export function compileCharacterAudioPlan(input: unknown) {
  const plan = CharacterAudioPlan.parse(input);
  const dialogue = compileCharacterDialogue(plan.dialogue);
  const fps = plan.dialogue.timebase.numerator / plan.dialogue.timebase.denominator;
  const ms = (frame: number) => Math.round((frame / fps) * 1000);
  const inputs: Array<{ asset: z.infer<typeof AssetRef>; sha256: string; mimeType: string }> = [];
  const inputIndex = (value: {
    asset: z.infer<typeof AssetRef>;
    sha256: string;
    mimeType: string;
  }) => {
    const found = inputs.findIndex(
      (item) =>
        item.asset.assetId === value.asset.assetId &&
        item.asset.revisionId === value.asset.revisionId &&
        item.sha256 === value.sha256,
    );
    if (found >= 0) return found;
    inputs.push(value);
    return inputs.length - 1;
  };
  const timeline = {
    fps: plan.dialogue.timebase,
    durationFrames: plan.dialogue.durationFrames,
    trackOrder: [] as string[],
    tracksById: {} as Record<string, unknown>,
  };
  const tracks: Array<{
    trackId: string;
    inputIndex: number;
    role: "voice" | "music" | "sfx";
    startMs: number;
    trimStartMs: number;
    trimEndMs: number;
    gainDb: number;
    fadeInMs: number;
    fadeOutMs: number;
  }> = [];
  const usedTrackIds = new Set<string>();
  const addOperationTrack = (track: (typeof tracks)[number]) => {
    if (usedTrackIds.has(track.trackId))
      throw new Error(`Generated audio track ID conflict for ${track.trackId}`);
    usedTrackIds.add(track.trackId);
    tracks.push(track);
  };
  const voiceTriggerIds: string[] = [];
  const addTimelineTrack = (
    id: string,
    kind: "voice" | "music" | "sfx",
    clips: Record<string, unknown>,
    order: string[],
  ) => {
    timeline.trackOrder.push(id);
    timeline.tracksById[id] = { kind, clipOrder: order, clipsById: clips };
  };
  const voiceClips: Record<string, unknown> = {};
  for (const [lineIndex, lineId] of plan.dialogue.lineOrder.entries()) {
    const line = plan.dialogue.linesById[lineId]!;
    const gainDb = 0;
    voiceClips[lineId] = {
      startFrame: line.startFrame,
      durationFrames: line.voice.durationFrames,
      source: { kind: "asset", asset: line.voice.asset },
      audio: { gainDb, fadeInMs: 0, fadeOutMs: 0 },
      ...(line.sceneId ? { sceneId: line.sceneId } : {}),
    };
    const index = inputIndex({
      asset: line.voice.asset,
      sha256: line.voice.sha256,
      mimeType: line.voice.mimeType,
    });
    for (const [windowIndex, window] of dialogue.normalizedByLineId[
      lineId
    ]!.speechWindows.entries()) {
      const trackId = `voice-${lineIndex}-speech-${windowIndex}`;
      voiceTriggerIds.push(trackId);
      addOperationTrack({
        trackId,
        inputIndex: index,
        role: "voice",
        startMs: ms(line.startFrame + window.startFrame),
        trimStartMs: ms(window.startFrame),
        trimEndMs: ms(window.startFrame + window.durationFrames),
        gainDb,
        fadeInMs: 0,
        fadeOutMs: 0,
      });
    }
  }
  addTimelineTrack("dialogueVoice", "voice", voiceClips, [...plan.dialogue.lineOrder]);
  const targetTrackIds: string[] = [];
  for (const [kind, clips] of [
    ["music", plan.music],
    ["sfx", plan.sfx],
  ] as const) {
    if (!clips.length) continue;
    const timelineClips: Record<string, unknown> = {};
    for (const clip of clips) {
      const end = clip.trimEndFrame ?? clip.sourceDurationFrames;
      if (end > clip.sourceDurationFrames || end <= clip.trimStartFrame)
        throw new Error(`${clip.id} has invalid source trim`);
      const duration = end - clip.trimStartFrame;
      if (clip.startFrame + duration > plan.dialogue.durationFrames)
        throw new Error(`${clip.id} exceeds timeline frame bounds`);
      timelineClips[clip.id] = {
        startFrame: clip.startFrame,
        durationFrames: duration,
        source: {
          kind: "asset",
          asset: clip.asset,
          ...(clip.trimStartFrame ? { sourceStartMs: ms(clip.trimStartFrame) } : {}),
          ...(end < clip.sourceDurationFrames ? { sourceEndMs: ms(end) } : {}),
        },
        audio: {
          gainDb: clip.gainDb,
          fadeInMs: ms(clip.fadeInFrames),
          fadeOutMs: ms(clip.fadeOutFrames),
        },
      };
      const trackId = clip.id;
      addOperationTrack({
        trackId,
        inputIndex: inputIndex(clip),
        role: kind,
        startMs: ms(clip.startFrame),
        trimStartMs: ms(clip.trimStartFrame),
        trimEndMs: ms(end),
        gainDb: clip.gainDb,
        fadeInMs: ms(clip.fadeInFrames),
        fadeOutMs: ms(clip.fadeOutFrames),
      });
      if (kind === "music") targetTrackIds.push(trackId);
    }
    addTimelineTrack(
      kind,
      kind,
      timelineClips,
      clips.map((clip) => clip.id),
    );
  }
  const parsedTimeline = Timeline.parse(timeline);
  const operation = MediaOperation.parse({
    kind: "audio_mix",
    durationMs: ms(plan.dialogue.durationFrames),
    tracks,
    ...(plan.ducking && voiceTriggerIds.length && targetTrackIds.length
      ? {
          ducking: {
            mode: "scheduled_voice_windows",
            triggerTrackIds: voiceTriggerIds,
            targetTrackIds,
            ...plan.ducking,
          },
        }
      : {}),
    mastering: plan.mastering,
  });
  return { timeline: parsedTimeline, operation, inputs, dialogue };
}
