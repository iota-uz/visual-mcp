import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { VideoRenderRequest } from "@visual-canvas/video/media";
import { downloadSource, fileIdentity, validateTransferUrl } from "../src/video/media.js";
import {
  handleVideoRender,
  renderSourceExtension,
  renderSourceNeedsProbe,
  sourceTrimFits,
  VideoWorkerError,
} from "../src/video/render.js";
import { captionsVtt, frameAligned, renderRange } from "../src/video/timing.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  return VideoRenderRequest.parse({
    jobId: "offline",
    fence: 1,
    version: { projectId: "p", versionId: "v", language: "ru" },
    format: { width: 360, height: 640, fps: { numerator: 30, denominator: 1 } },
    script: {
      language: "ru",
      writingSystem: "cyrillic",
      title: "Fixture",
      premise: "",
      sceneOrder: [],
      scenesById: {},
    },
    timeline: {
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 90,
      trackOrder: ["captions"],
      tracksById: {
        captions: {
          kind: "caption",
          clipOrder: ["first"],
          clipsById: {
            first: {
              startFrame: 15,
              durationFrames: 45,
              source: { kind: "text", text: "A < B & C" },
            },
          },
        },
      },
    },
    inputs: [],
    outputs: Object.fromEntries(
      ["video", "poster", "captions"].map((key) => [
        key,
        { url: `https://storage.example/${key}`, method: "PUT" },
      ]),
    ),
  });
}
test("partial VTT uses range-relative real time and escapes caption markup", () => {
  const request = fixture();
  request.range = { startFrame: 30, endFrame: 75 };
  assert.deepEqual(renderRange(request), { start: 30, end: 75, frames: 45, partial: true });
  const vtt = captionsVtt(request);
  assert.match(vtt, /00:00:00\.000 --> 00:00:01\.000/);
  assert.match(vtt, /A &lt; B &amp; C/);
});
test("range and non-frame-aligned source trim fail without rounding", () => {
  assert.equal(frameAligned(1000, 30), 30);
  assert.throws(() => frameAligned(1000, 30000 / 1001));
  const request = fixture();
  request.range = { startFrame: 50, endFrame: 91 };
  assert.throws(() => renderRange(request));
});
test("already cancelled render never starts a compiler or browser", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    handleVideoRender(fixture(), controller.signal),
    (error: unknown) => error instanceof VideoWorkerError && error.effect === "not_applied",
  );
});
test("transfer URLs reject credentials and unsafe protocols", () => {
  assert.throws(() => validateTransferUrl("file:///etc/passwd"));
  assert.throws(() => validateTransferUrl("https://secret:secret@storage.example/a"));
});
test("trusted SVG image inputs are preserved for the browser without ffprobe", () => {
  assert.equal(renderSourceExtension("image/svg+xml"), "svg");
  assert.equal(renderSourceNeedsProbe("image/svg+xml"), false);
  assert.equal(renderSourceNeedsProbe("image/png"), true);
  assert.throws(() => renderSourceExtension("text/html"), /Unsupported source MIME/);
});
test("container duration may differ from a clip by at most one frame", () => {
  assert.equal(sourceTrimFits(0, 21968.98, 21968.98, 660, 30), true);
  assert.equal(sourceTrimFits(0, 21900, 21900, 660, 30), false);
  assert.equal(sourceTrimFits(0, 22034, 22000, 660, 30), false);
});
test("streaming ingestion validates actual bytes and checksum", async () => {
  const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, "video-test-"));
  const bytes = Buffer.from("pinned media fixture");
  const server = createServer((_request, response) => {
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const input = {
    url: `http://127.0.0.1:${address.port}/asset`,
    sizeBytes: bytes.length,
    sha256: hash(bytes),
  };
  try {
    const path = join(scratch, "asset");
    await downloadSource(input, path, new AbortController().signal);
    assert.deepEqual(await fileIdentity(path), { sha256: hash(bytes), sizeBytes: bytes.length });
    assert.deepEqual(await readFile(path), bytes);
    await assert.rejects(
      downloadSource(
        { ...input, sizeBytes: 2 },
        join(scratch, "oversize"),
        new AbortController().signal,
      ),
    );
    await assert.rejects(
      downloadSource(
        { ...input, sha256: "0".repeat(64) },
        join(scratch, "wrong-hash"),
        new AbortController().signal,
      ),
    );
  } finally {
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
