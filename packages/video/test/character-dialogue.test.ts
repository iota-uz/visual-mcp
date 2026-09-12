import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterSceneProps } from "../src/character.js";
import {
  CharacterDialoguePlan,
  compileCharacterDialogue,
  normalizeElevenLabsAlignment,
} from "../src/character-dialogue.js";
import { builtInCharacterPacks } from "../src/character-packs.js";

const hash = "a".repeat(64);
const alignment = (text: string, step = 0.08) => ({
  original: {
    characters: [...text],
    character_start_times_seconds: [...text].map((_, index) => index * step),
    character_end_times_seconds: [...text].map((_, index) => (index + 1) * step),
  },
  normalized: null,
  language: "ru" as const,
});
const voice = (id: string, text: string, durationFrames = 90) => ({
  asset: { assetId: `audio_${id}`, revisionId: "1" },
  sha256: hash,
  mimeType: "audio/mpeg" as const,
  durationFrames,
  alignment: {
    asset: { assetId: `alignment_${id}`, revisionId: "1" },
    sha256: hash,
    provider: "elevenlabs" as const,
    timingBasis: "provider_supplied" as const,
    artifact: alignment(text),
  },
});
const line = (
  id: string,
  actorId: string,
  text: string,
  startFrame: number,
  targetActor: string,
) => ({
  id,
  sceneId: "sceneOne",
  actorId,
  text,
  startFrame,
  target: { kind: "actor" as const, actorId: targetActor },
  emotion: "confident" as const,
  gesture: "explain" as const,
  voice: voice(id, text),
  listenersByActorId: {},
});

test("Cyrillic and Uzbek Latin provider timings normalize deterministically to the six renderer visemes", () => {
  for (const text of ["Привет, дўст!", "Oʻzbek tili"]) {
    const artifact = alignment(text);
    artifact.language = text.startsWith("O") ? "uz" : "ru";
    const first = normalizeElevenLabsAlignment({
      artifact,
      text,
      durationFrames: 90,
      timebase: { numerator: 30, denominator: 1 },
    });
    const second = normalizeElevenLabsAlignment({
      artifact,
      text,
      durationFrames: 90,
      timebase: { numerator: 30, denominator: 1 },
    });
    assert.deepEqual(first, second);
    assert.ok(first.words.length >= 2);
    assert.ok(
      first.visemes.every((entry) => ["rest", "a", "e", "o", "u", "m"].includes(entry.shape)),
    );
    assert.equal(first.visemes.at(-1)?.shape, "rest");
  }
});

test("normalization preserves long silence as rest and separate ducking windows", () => {
  const text = "Ha yoʻq";
  const artifact = alignment(text);
  artifact.original.character_start_times_seconds = [0.2, 0.28, 0.36, 1.2, 1.28, 1.36, 1.44];
  artifact.original.character_end_times_seconds = [0.28, 0.36, 0.44, 1.28, 1.36, 1.44, 1.52];
  const result = normalizeElevenLabsAlignment({
    artifact,
    text,
    durationFrames: 60,
    timebase: { numerator: 30, denominator: 1 },
  });
  assert.equal(result.speechWindows.length, 2);
  assert.ok(result.visemes.some((entry) => entry.shape === "rest" && entry.frame > 0));
  assert.ok(result.visemes.every((entry) => entry.frame >= 0 && entry.frame < 60));
});

test("normalization falls back to exact original text when provider normalized timing adds padding", () => {
  const text = "Привет";
  const artifact = alignment(text);
  artifact.normalized = {
    characters: [" ", ...artifact.original.characters, " "],
    character_start_times_seconds: [
      0,
      ...artifact.original.character_start_times_seconds.map((time) => time + 0.08),
      0.64,
    ],
    character_end_times_seconds: [
      0.08,
      ...artifact.original.character_end_times_seconds.map((time) => time + 0.08),
      0.72,
    ],
  };
  assert.equal(
    normalizeElevenLabsAlignment({
      artifact,
      text,
      durationFrames: 30,
      timebase: { numerator: 30, denominator: 1 },
    }).words[0]?.text,
    text,
  );
});

test("long provider alignment is compacted to the talk-action limit without invented timestamps", () => {
  const text = "абомеу ".repeat(50).trim();
  const artifact = alignment(text, 0.04);
  const inputFrames = new Set(
    artifact.original.character_start_times_seconds.map((seconds) => Math.round(seconds * 30)),
  );
  for (const seconds of artifact.original.character_end_times_seconds)
    inputFrames.add(Math.round(seconds * 30));
  inputFrames.add(0);

  const first = normalizeElevenLabsAlignment({
    artifact,
    text,
    durationFrames: 600,
    timebase: { numerator: 30, denominator: 1 },
  });
  const second = normalizeElevenLabsAlignment({
    artifact,
    text,
    durationFrames: 600,
    timebase: { numerator: 30, denominator: 1 },
  });

  assert.deepEqual(first, second, "compaction must be deterministic");
  assert.equal(first.visemes.length, 128);
  assert.equal(first.visemes[0]?.frame, 0);
  assert.equal(first.visemes.at(-1)?.frame, Math.round(text.length * 0.04 * 30));
  assert.ok(first.visemes.every(({ frame }) => inputFrames.has(frame)));

  const compiled = compileCharacterDialogue({
    timebase: { numerator: 30, denominator: 1 },
    durationFrames: 600,
    lineOrder: ["long"],
    linesById: {
      long: {
        ...line("long", "farq", text, 0, "customer"),
        voice: {
          ...voice("long", text, 600),
          alignment: {
            ...voice("long", text, 600).alignment,
            artifact,
          },
        },
      },
    },
  });
  assert.equal(compiled.actionsById["dialogue-0-talk"]?.type, "talk");
});

test("missing, mismatched, and out-of-duration alignment fail instead of fabricating timing", () => {
  assert.equal(
    CharacterDialoguePlan.safeParse({
      timebase: { numerator: 30, denominator: 1 },
      durationFrames: 100,
      lineOrder: ["one"],
      linesById: {
        one: {
          ...line("one", "farq", "Salom", 0, "client"),
          voice: {
            ...voice("one", "Salom"),
            alignment: {
              ...voice("one", "Salom").alignment,
              artifact: { original: null, normalized: null, language: "uz" },
            },
          },
        },
      },
    }).success,
    false,
  );
  assert.throws(
    () =>
      normalizeElevenLabsAlignment({
        artifact: alignment("Boshqa"),
        text: "Salom",
        durationFrames: 30,
        timebase: { numerator: 30, denominator: 1 },
      }),
    /exactly match/,
  );
  assert.throws(
    () =>
      normalizeElevenLabsAlignment({
        artifact: alignment("Долго", 0.5),
        text: "Долго",
        durationFrames: 30,
        timebase: { numerator: 30, denominator: 1 },
      }),
    /duration/,
  );
});

test("two-speaker dialogue maps talk, speaker gaze, gestures, listener gaze and delayed reactions", () => {
  const plan = {
    timebase: { numerator: 30, denominator: 1 },
    durationFrames: 240,
    lineOrder: ["question", "answer"],
    linesById: {
      question: line("question", "customer", "Бу қанча?", 0, "farq"),
      answer: {
        ...line("answer", "farq", "Bu arzon.", 100, "customer"),
        listenersByActorId: { customer: { reaction: null } },
      },
    },
  };
  const first = compileCharacterDialogue(plan);
  assert.deepEqual(first, compileCharacterDialogue(plan), "compilation must be repeatable");
  assert.equal(first.actionsById["dialogue-0-talk"]?.type, "talk");
  const listeningGaze = first.actionsById["dialogue-0-listener-0-gaze"];
  assert.equal(listeningGaze?.type, "look");
  assert.equal(listeningGaze?.actorId, "farq");
  assert.deepEqual(listeningGaze && "target" in listeningGaze ? listeningGaze.target : null, {
    kind: "actor",
    actorId: "customer",
  });
  assert.equal(first.actionsById["dialogue-0-listener-0-reaction"]?.type, "react");
  assert.equal(
    first.actionsById["dialogue-1-listener-0-reaction"],
    undefined,
    "explicit null suppresses microreaction",
  );
  assert.deepEqual(Object.keys(first.normalizedByLineId), ["question", "answer"]);
  assert.equal(first.lineIdByActionId["dialogue-1-talk"], "answer");
  assert.equal(first.sceneIdByActionId["dialogue-1-talk"], "sceneOne");
});

test("speaker overlap and explicit listener/speaker conflicts are rejected", () => {
  assert.throws(
    () =>
      compileCharacterDialogue({
        timebase: { numerator: 30, denominator: 1 },
        durationFrames: 200,
        lineOrder: ["a", "b"],
        linesById: {
          a: line("a", "farq", "A", 0, "customer"),
          b: line("b", "farq", "B", 20, "customer"),
        },
      }),
    /overlapping/,
  );
  assert.throws(
    () =>
      compileCharacterDialogue({
        timebase: { numerator: 30, denominator: 1 },
        durationFrames: 200,
        lineOrder: ["a", "b"],
        linesById: {
          a: {
            ...line("a", "farq", "A", 0, "customer"),
            listenersByActorId: { customer: { reaction: "happy" } },
          },
          b: line("b", "customer", "B", 20, "farq"),
        },
      }),
    /conflicts with its own speech/,
  );
});

test("maximum authored IDs compile to bounded action keys that assemble into a strict scene", () => {
  const lineId = `L${"x".repeat(63)}`,
    speaker = `S${"x".repeat(63)}`,
    listener = `R${"x".repeat(63)}`;
  const compiled = compileCharacterDialogue({
    timebase: { numerator: 30, denominator: 1 },
    durationFrames: 120,
    lineOrder: [lineId],
    linesById: {
      [lineId]: {
        ...line(lineId, speaker, "Salom", 0, listener),
        listenersByActorId: { [listener]: { reaction: "happy" } },
      },
    },
  });
  assert.ok(compiled.actionOrder.every((id) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)));
  assert.doesNotThrow(() =>
    CharacterSceneProps.parse({
      stage: { aspect: "9:16", width: 1080, height: 1920 },
      timebase: compiled.timebase,
      seed: 1,
      staging: { layout: "two-shot", focalActorId: speaker },
      camera: { movement: "locked", startFrame: 0, durationFrames: 120 },
      cameraSequence: [],
      effects: [],
      environment: {
        background: "#000000",
        horizonY: 0.6,
        ground: "#111111",
        accent: "#ffffff",
        layers: [],
      },
      characterPacksById: { customer: builtInCharacterPacks.customer },
      actorOrder: [speaker, listener],
      actorsById: {
        [speaker]: {
          characterPackId: "customer",
          x: 0.3,
          y: 0.6,
          scale: 1,
          facing: "right",
          initialEmotion: "neutral",
        },
        [listener]: {
          characterPackId: "customer",
          x: 0.7,
          y: 0.6,
          scale: 1,
          facing: "left",
          initialEmotion: "neutral",
        },
      },
      propOrder: [],
      propsById: {},
      actionOrder: compiled.actionOrder,
      actionsById: compiled.actionsById,
      overlayOrder: [],
      overlaysById: {},
    }),
  );
});
