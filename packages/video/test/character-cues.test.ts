import assert from "node:assert/strict";
import { test } from "node:test";
import { CharacterCueSheet, compileCharacterCues } from "../src/character-cues.js";
import { Timeline } from "../src/contracts.js";

const sheet = () =>
  CharacterCueSheet.parse({
    timebase: { numerator: 30, denominator: 1 },
    soundOrder: ["pop"],
    soundsById: {
      pop: {
        asset: { assetId: "asset_sfx_pop", revisionId: "3" },
        durationFrames: 12,
        gainDb: -3,
        fadeInFrames: 0,
        fadeOutFrames: 3,
      },
    },
    cueOrder: ["priceCue"],
    cuesById: {
      priceCue: { eventId: "priceReveal", soundId: "pop", offsetFrames: -2 },
    },
  });

test("semantic character cues compile to pinned timeline SFX clips at exact beat frames", () => {
  const compiled = compileCharacterCues({
    sheet: sheet(),
    eventsById: { priceReveal: { frame: 62 } },
    timeline: { timebase: { numerator: 30, denominator: 1 }, durationFrames: 120 },
  });
  assert.deepEqual(compiled.clipOrder, ["priceCue"]);
  assert.deepEqual(compiled.clipsById.priceCue, {
    startFrame: 60,
    durationFrames: 12,
    source: {
      kind: "asset",
      asset: { assetId: "asset_sfx_pop", revisionId: "3" },
    },
    audio: { gainDb: -3, fadeInMs: 0, fadeOutMs: 100 },
  });
  assert.deepEqual(compiled.eventIdsByClipId, { priceCue: "priceReveal" });
  assert.equal(
    Timeline.safeParse({
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 120,
      trackOrder: ["sfx"],
      tracksById: { sfx: { kind: "sfx", ...compiled } },
    }).success,
    false,
    "event metadata is deliberately separate from strict Timeline track data",
  );
  const { eventIdsByClipId: _metadata, ...track } = compiled;
  assert.equal(
    Timeline.safeParse({
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 120,
      trackOrder: ["sfx"],
      tracksById: { sfx: { kind: "sfx", ...track } },
    }).success,
    true,
  );
});

test("cue authoring rejects missing pinned sounds and missing semantic events", () => {
  const invalid = structuredClone(sheet());
  invalid.cuesById.priceCue!.soundId = "missing";
  assert.equal(CharacterCueSheet.safeParse(invalid).success, false);
  assert.throws(
    () =>
      compileCharacterCues({
        sheet: sheet(),
        eventsById: {},
        timeline: { timebase: { numerator: 30, denominator: 1 }, durationFrames: 120 },
      }),
    /missing event/,
  );
});

test("cue compilation rejects timebase mismatches and clips outside timeline bounds", () => {
  assert.throws(
    () =>
      compileCharacterCues({
        sheet: sheet(),
        eventsById: { priceReveal: { frame: 62 } },
        timeline: { timebase: { numerator: 24, denominator: 1 }, durationFrames: 120 },
      }),
    /timebase/,
  );
  assert.throws(
    () =>
      compileCharacterCues({
        sheet: sheet(),
        eventsById: { priceReveal: { frame: 116 } },
        timeline: { timebase: { numerator: 30, denominator: 1 }, durationFrames: 120 },
      }),
    /frame bounds/,
  );
  assert.throws(() =>
    compileCharacterCues({
      sheet: sheet(),
      eventsById: { priceReveal: { frame: 62 } },
      timeline: {
        timebase: { numerator: 30, denominator: 1 },
        durationFrames: Number.NaN,
      },
    }),
  );
});
