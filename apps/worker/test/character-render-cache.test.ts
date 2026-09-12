import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  characterRenderCacheKey,
  readCharacterRenderCache,
  writeCharacterRenderCache,
} from "../src/video/character-render-cache.js";

test("cache key ignores transport credentials but changes with seed, input hash, range and build", () => {
  const base = {
    timeline: { seed: 1 },
    format: { width: 1080 },
    range: { start: 0, end: 30 },
    inputs: [{ sha256: "a".repeat(64), url: "https://secret" }],
    engine: { workerBuildSha: "b".repeat(40) },
  };
  assert.equal(
    characterRenderCacheKey(base),
    characterRenderCacheKey({ ...base, jobId: "other", outputs: { video: { url: "secret" } } }),
  );
  for (const changed of [
    { ...base, timeline: { seed: 2 } },
    { ...base, inputs: [{ sha256: "c".repeat(64) }] },
    { ...base, range: { start: 1, end: 30 } },
    { ...base, engine: { workerBuildSha: "d".repeat(40) } },
  ])
    assert.notEqual(characterRenderCacheKey(base), characterRenderCacheKey(changed));
  for (const id of ["url", "outputs", "jobId", "fence"])
    assert.notEqual(
      characterRenderCacheKey({ ...base, timeline: { actorsById: { [id]: { x: 0.2 } } } }),
      characterRenderCacheKey({ ...base, timeline: { actorsById: { [id]: { x: 0.8 } } } }),
    );
});

test("immutable cache reuses verified bytes and treats corruption as a miss", async () => {
  const root = await mkdtemp(join(tmpdir(), "character-cache-test-"));
  try {
    const source = join(root, "source.mp4"),
      destination = join(root, "destination.mp4"),
      key = "a".repeat(64);
    await writeFile(source, Buffer.from("video-one"));
    assert.equal(
      await writeCharacterRenderCache(root, key, source, {
        maxEntryBytes: 100,
        maxTotalBytes: 1000,
        maxEntries: 4,
      }),
      true,
    );
    assert.equal(
      await readCharacterRenderCache(root, key, destination, { ttlMs: 60_000, maxEntryBytes: 100 }),
      true,
    );
    assert.equal((await readFile(destination)).toString(), "video-one");
    // Eviction must never touch unrelated files in the configured cache directory.
    assert.equal((await readFile(source)).toString(), "video-one");
    await writeFile(join(root, `${key}.mp4`), Buffer.from("corrupt"));
    assert.equal(
      await readCharacterRenderCache(root, key, destination, { ttlMs: 60_000, maxEntryBytes: 100 }),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
