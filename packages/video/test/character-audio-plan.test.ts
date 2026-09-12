import assert from "node:assert/strict";
import { test } from "node:test";
import { compileCharacterAudioPlan } from "../src/character-audio-plan.js";
import { Timeline } from "../src/contracts.js";
import { MediaOperation } from "../src/operations.js";

const sha256 = "b".repeat(64);
const timed = (text: string) => ({
  original: {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, i) => 0.2 + i * 0.08),
    character_end_times_seconds: [...text].map((_, i) => 0.28 + i * 0.08),
  },
  normalized: null,
  language: "uz" as const,
});
const plan = () => ({
  dialogue: {
    timebase: { numerator: 30, denominator: 1 },
    durationFrames: 750,
    lineOrder: ["hello", "reply"],
    linesById: {
      hello: {
        id: "hello",
        sceneId: "intro",
        actorId: "farq",
        text: "Salom",
        startFrame: 30,
        target: { kind: "actor" as const, actorId: "customer" },
        emotion: "happy" as const,
        gesture: "greet" as const,
        listenersByActorId: {},
        voice: {
          asset: { assetId: "voice_one", revisionId: "1" },
          sha256,
          mimeType: "audio/mpeg" as const,
          durationFrames: 60,
          alignment: {
            asset: { assetId: "align_one", revisionId: "1" },
            sha256,
            provider: "elevenlabs" as const,
            timingBasis: "provider_supplied" as const,
            artifact: timed("Salom"),
          },
        },
      },
      reply: {
        id: "reply",
        sceneId: "answer",
        actorId: "customer",
        text: "Раҳмат",
        startFrame: 150,
        target: { kind: "actor" as const, actorId: "farq" },
        emotion: "relieved" as const,
        gesture: null,
        listenersByActorId: {},
        voice: {
          asset: { assetId: "voice_two", revisionId: "2" },
          sha256,
          mimeType: "audio/mpeg" as const,
          durationFrames: 65,
          alignment: {
            asset: { assetId: "align_two", revisionId: "1" },
            sha256,
            provider: "elevenlabs" as const,
            timingBasis: "provider_supplied" as const,
            artifact: { ...timed("Раҳмат"), language: "ru" as const },
          },
        },
      },
    },
  },
  music: [
    {
      id: "bed",
      asset: { assetId: "music", revisionId: "4" },
      sha256,
      mimeType: "audio/wav" as const,
      sourceDurationFrames: 750,
      startFrame: 0,
      trimStartFrame: 0,
      trimEndFrame: 750,
      gainDb: -15,
      fadeInFrames: 15,
      fadeOutFrames: 30,
    },
  ],
  sfx: [
    {
      id: "pop",
      asset: { assetId: "sfx", revisionId: "3" },
      sha256,
      mimeType: "audio/wav" as const,
      sourceDurationFrames: 15,
      startFrame: 400,
      gainDb: -4,
      fadeInFrames: 0,
      fadeOutFrames: 3,
    },
  ],
  ducking: { reductionDb: 8, attackMs: 80, releaseMs: 180 },
  mastering: { sampleRate: 48000 as const, targetLufs: -16, maxTruePeakDb: -1, loudnessRange: 8 },
});

test("20-25 second bilingual fixture compiles pinned voice, music and SFX into real Timeline and audio_mix", () => {
  // Synthetic provider-timing fixture only: this is not listening evidence or a real-voice quality test.
  const result = compileCharacterAudioPlan(plan());
  assert.equal(Timeline.safeParse(result.timeline).success, true);
  assert.equal(MediaOperation.safeParse(result.operation).success, true);
  assert.equal(result.timeline.durationFrames, 750);
  assert.deepEqual(result.timeline.trackOrder, ["dialogueVoice", "music", "sfx"]);
  assert.equal(result.inputs.length, 4);
  assert.equal(result.operation.kind, "audio_mix");
  if (result.operation.kind !== "audio_mix") return;
  assert.deepEqual(result.operation.ducking?.targetTrackIds, ["bed"]);
  assert.ok(result.operation.ducking?.triggerTrackIds.every((id) => id.includes("speech")));
  assert.equal(
    result.operation.tracks.find((track) => track.trackId === "voice-0-speech-0")?.startMs,
    1200,
    "leading provider silence shifts the actual speech window",
  );
  assert.deepEqual(
    result,
    compileCharacterAudioPlan(plan()),
    "timeline and mix compilation are deterministic",
  );
});

test("audio compilation rejects source trim and timeline duration mismatches", () => {
  const badTrim = plan();
  badTrim.sfx[0]!.trimEndFrame = 20;
  assert.throws(() => compileCharacterAudioPlan(badTrim), /invalid source trim/);
  const tooLate = plan();
  tooLate.sfx[0]!.startFrame = 745;
  assert.throws(() => compileCharacterAudioPlan(tooLate), /frame bounds/);
});

test("maximum line IDs produce bounded timeline/mix IDs and explicit collisions fail", () => {
  const value = plan(),
    longId = `L${"x".repeat(63)}`;
  value.dialogue.lineOrder = [longId];
  value.dialogue.linesById = {
    [longId]: {
      ...value.dialogue.linesById.hello!,
      id: longId,
      voice: {
        ...value.dialogue.linesById.hello!.voice,
        asset: { assetId: "long_voice", revisionId: "1" },
      },
    },
  };
  const compiled = compileCharacterAudioPlan(value);
  assert.equal(Timeline.safeParse(compiled.timeline).success, true);
  assert.ok(
    compiled.operation.kind === "audio_mix" &&
      compiled.operation.tracks.every((track) =>
        /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(track.trackId),
      ),
  );
  const collision = plan();
  collision.music[0]!.id = "voice-0-speech-0";
  assert.throws(() => compileCharacterAudioPlan(collision), /track ID conflict/);
});

test("long provider alignment is compacted before audio plan validation", () => {
  const value = plan();
  const text = "абомеу ".repeat(50).trim();
  const characters = [...text];
  value.dialogue.lineOrder = ["hello"];
  value.dialogue.linesById = {
    hello: {
      ...value.dialogue.linesById.hello!,
      text,
      voice: {
        ...value.dialogue.linesById.hello!.voice,
        durationFrames: 600,
        alignment: {
          ...value.dialogue.linesById.hello!.voice.alignment,
          artifact: {
            original: {
              characters,
              character_start_times_seconds: characters.map((_, index) => index * 0.04),
              character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.04),
            },
            normalized: null,
            language: "uz" as const,
          },
        },
      },
    },
  };

  const result = compileCharacterAudioPlan(value);
  const talk = result.dialogue.actionsById["dialogue-0-talk"];
  assert.equal(talk?.type, "talk");
  if (talk?.type === "talk") assert.equal(talk.visemes.length, 128);
});
