import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { MediaProcessRequest } from "@visual-canvas/video/operations";
import { handleMediaProcess, MediaProcessError } from "../dist/video/process.js";
import { fileIdentity, probeMedia, safeMediaInput } from "../src/video/media.js";

const run = promisify(execFile);
test("playlist masquerading as MP4 cannot trigger secondary HTTP or file reads", async () => {
  const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "playlist-security-"));
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(200).end("blocked");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const file = join(dir, "malicious.mp4");
    await writeFile(
      file,
      `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttp://127.0.0.1:${address.port}/private\n#EXTINF:2,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n`,
    );
    await assert.rejects(probeMedia(file), /playlists/);
    await assert.rejects(safeMediaInput(file), /playlists/);
    assert.equal(requests, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test("typed frames/proxy/QA create actual pinned-byte artifacts offline", async () => {
  const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, "operations-test-"));
  const input = join(dir, "input.mp4");
  await run("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=mono:sample_rate=48000:duration=1",
    "-filter_complex",
    "[1:a][2:a]concat=n=2:v=0:a=1[a]",
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    "-y",
    input,
  ]);
  const identity = await fileIdentity(input);
  const saved = new Map<string, Buffer>();
  let refuse = false;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-length": identity.sizeBytes });
      createReadStream(input).pipe(res);
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (refuse) {
        res.writeHead(503).end();
        return;
      }
      saved.set(req.url!, Buffer.concat(chunks));
      res.writeHead(200).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const common = {
    jobId: "offline-media",
    fence: 1,
    inputs: [
      {
        asset: { assetId: "fixture", revisionId: "pinned" },
        url: `${base}/source`,
        ...identity,
        mimeType: "video/mp4",
      },
    ],
  };
  try {
    const frames = await handleMediaProcess({
      ...common,
      operation: { kind: "frames", timesMs: [0, 750, 1500], maxWidth: 240, columns: 2 },
      outputs: Object.fromEntries(
        ["frame-0", "frame-1", "frame-2", "contactsheet"].map((name) => [
          name,
          { url: `${base}/${name}`, method: "PUT" },
        ]),
      ),
    });
    assert.equal(frames.outputs.length, 4);
    assert.equal(frames.sourceSha256, identity.sha256);
    assert.equal(frames.outputs.find((o) => o.name === "frame-1")?.requestedMs, 750);
    assert.ok(frames.outputs.find((o) => o.name === "frame-1")!.actualMs! >= 750);
    for (const output of frames.outputs) {
      const actual = saved.get(`/${output.name}`)!;
      assert.equal(createHash("sha256").update(actual).digest("hex"), output.sha256);
      assert.equal(actual.length, output.sizeBytes);
    }
    const comparison = await handleMediaProcess({
      ...common,
      inputs: [
        common.inputs[0],
        { ...common.inputs[0], asset: { assetId: "second", revisionId: "v2" } },
      ],
      operation: {
        kind: "compare",
        timesMs: [0, 750],
        maxWidth: 240,
        labels: ["A <original>", "B & revision"],
      },
      outputs: Object.fromEntries(
        ["contactsheet", "frame-a-0", "frame-b-0", "frame-a-1", "frame-b-1"].map((name) => [
          name,
          { url: `${base}/${name}`, method: "PUT" },
        ]),
      ),
    });
    assert.equal(comparison.sources.length, 2);
    assert.equal(comparison.outputs.find((item) => item.name === "frame-b-1")?.sourceIndex, 1);
    assert.equal(comparison.outputs.find((item) => item.name === "frame-b-1")?.requestedMs, 750);
    assert.equal(comparison.outputs.find((item) => item.name === "contactsheet")?.width, 640);
    for (const output of comparison.outputs)
      assert.equal(
        createHash("sha256")
          .update(saved.get(`/${output.name}`)!)
          .digest("hex"),
        output.sha256,
      );
    const proxy = await handleMediaProcess({
      ...common,
      operation: { kind: "proxy", maxWidth: 160, fps: 4, maxOutputBytes: 1024 * 1024 },
      outputs: { proxy: { url: `${base}/proxy`, method: "PUT" } },
    });
    assert.equal(proxy.outputs[0]?.width, 160);
    assert.ok(proxy.outputs[0]!.sizeBytes <= 1024 * 1024);
    assert.equal(proxy.sampling.fps, 4);
    const qaInput = {
      ...common,
      operation: {
        kind: "qa",
        requiredAudio: true,
        expectedWidth: 320,
        expectedHeight: 240,
        expectedDurationMs: 2000,
      },
      outputs: { report: { url: `${base}/report`, method: "PUT" } },
    };
    const qa = await handleMediaProcess(qaInput);
    assert.equal(qa.checks.find((c) => c.name === "decode")?.outcome, "pass");
    assert.equal(qa.checks.find((c) => c.name === "text_overflow")?.outcome, "not_evaluated");
    const report = JSON.parse(saved.get("/report")!.toString());
    assert.ok(Number.isFinite(report.measurements.peakDb));
    assert.equal(report.outcome, "inconclusive");
    const waveform = await handleMediaProcess({
      ...common,
      operation: {
        kind: "waveform",
        startMs: 250,
        durationMs: 1000,
        width: 640,
        height: 160,
        channel: "mixed",
      },
      outputs: {
        waveform: { url: `${base}/waveform`, method: "PUT" },
        report: { url: `${base}/waveform-report`, method: "PUT" },
      },
    });
    assert.equal(waveform.kind, "waveform");
    assert.deepEqual(waveform.sampling.range, { startMs: 250, endMs: 1250 });
    assert.equal(waveform.outputs.find((output) => output.name === "waveform")?.width, 640);
    assert.ok(
      saved
        .get("/waveform")!
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    );
    const waveformReport = JSON.parse(saved.get("/waveform-report")!.toString());
    assert.equal(waveformReport.channel, "mixed");
    assert.deepEqual(waveformReport.coverage, { startMs: 250, endMs: 1250 });
    assert.equal(waveformReport.rendering.decoder, "ffmpeg");
    const silenceWaveform = await handleMediaProcess({
      ...common,
      operation: {
        kind: "waveform",
        startMs: 1000,
        durationMs: 750,
        width: 640,
        height: 160,
        channel: "mixed",
      },
      outputs: {
        waveform: { url: `${base}/silence-waveform`, method: "PUT" },
        report: { url: `${base}/silence-waveform-report`, method: "PUT" },
      },
    });
    assert.notEqual(
      silenceWaveform.outputs.find((output) => output.name === "waveform")?.sha256,
      waveform.outputs.find((output) => output.name === "waveform")?.sha256,
    );
    await assert.rejects(
      handleMediaProcess({
        ...common,
        operation: {
          kind: "waveform",
          startMs: 1500,
          durationMs: 1000,
          width: 640,
          height: 160,
          channel: "mixed",
        },
        outputs: {
          waveform: { url: `${base}/unused-waveform`, method: "PUT" },
          report: { url: `${base}/unused-waveform-report`, method: "PUT" },
        },
      }),
      (error) => error instanceof MediaProcessError && error.code === "WAVEFORM_RANGE_OUT_OF_RANGE",
    );
    const mix = await handleMediaProcess({
      ...common,
      operation: {
        kind: "audio_mix",
        durationMs: 2000,
        tracks: [
          {
            trackId: "voice",
            inputIndex: 0,
            role: "voice",
            startMs: 500,
            trimStartMs: 0,
            trimEndMs: 1000,
            gainDb: 0,
            fadeInMs: 50,
            fadeOutMs: 100,
          },
          {
            trackId: "music",
            inputIndex: 0,
            role: "music",
            startMs: 0,
            trimStartMs: 0,
            trimEndMs: 2000,
            gainDb: -12,
            fadeInMs: 100,
            fadeOutMs: 100,
          },
        ],
        ducking: {
          mode: "scheduled_voice_windows",
          triggerTrackIds: ["voice"],
          targetTrackIds: ["music"],
          reductionDb: 9,
          attackMs: 100,
          releaseMs: 200,
        },
        mastering: { sampleRate: 48000, targetLufs: -16, maxTruePeakDb: -1, loudnessRange: 11 },
      },
      outputs: {
        audio: { url: `${base}/audio`, method: "PUT" },
        report: { url: `${base}/mix-report`, method: "PUT" },
      },
    });
    assert.equal(mix.kind, "audio_mix");
    assert.equal(mix.outputs.find((o) => o.name === "audio")?.durationMs, 2000);
    assert.ok(mix.checks.every((c) => c.outcome === "pass"));
    assert.equal(mix.sources.length, 1);
    const audioBytes = saved.get("/audio")!;
    assert.equal(
      createHash("sha256").update(audioBytes).digest("hex"),
      mix.outputs.find((o) => o.name === "audio")!.sha256,
    );
    const mixReport = JSON.parse(saved.get("/mix-report")!.toString());
    assert.equal(mixReport.ducking.mode, "scheduled_voice_windows");
    assert.ok(Math.abs(mixReport.measured.integratedLufs + 16) <= 1);
    refuse = true;
    await assert.rejects(
      handleMediaProcess(qaInput),
      (error) => error instanceof MediaProcessError && error.effect === "partial" && !!error.result,
    );
    assert.equal(
      (await readdir(root)).filter((name) => name.startsWith("media-process-")).length,
      0,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
test("operation output descriptor contract and pre-aborted request fail before CPU work", async () => {
  const request = {
    jobId: "x",
    fence: 1,
    inputs: [
      {
        asset: { assetId: "a", revisionId: "r" },
        url: "https://example.test/a",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        mimeType: "video/mp4",
      },
    ],
    operation: { kind: "frames", timesMs: [0], maxWidth: 320, columns: 1 },
    outputs: {},
  };
  assert.equal(MediaProcessRequest.safeParse(request).success, false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    handleMediaProcess(
      {
        ...request,
        outputs: {
          "frame-0": { url: "https://example.test/frame", method: "PUT" },
          contactsheet: { url: "https://example.test/sheet", method: "PUT" },
        },
      },
      controller.signal,
    ),
    (error) => error instanceof MediaProcessError && error.effect === "not_applied",
  );
});
