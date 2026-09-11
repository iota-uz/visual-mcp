// Run inside the built worker image. No provider or production storage access.
// NODE_ENV=test permits this isolated loopback fixture transfer server only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { VERSION } from "remotion";
import sharp from "sharp";
import { probeMedia } from "../dist/video/media.js";
import { handleVideoRender } from "../dist/video/render.js";

assert.equal(process.env.NODE_ENV, "test", "Use test mode only in this isolated fixture container");
assert.ok(process.env.VIDEO_RENDER_TMP_ROOT, "Set an explicit writable fixture output root");
const run = promisify(execFile);
const width = Number(process.env.VIDEO_E2E_WIDTH ?? 360);
const height = Number(process.env.VIDEO_E2E_HEIGHT ?? 640);
assert.ok(Number.isInteger(width) && width > 0 && width % 2 === 0);
assert.ok(Number.isInteger(height) && height > 0 && height % 2 === 0);
await mkdir(process.env.VIDEO_RENDER_TMP_ROOT, { recursive: true });
const root = await mkdtemp(join(process.env.VIDEO_RENDER_TMP_ROOT, "render-e2e-"));
const inputs = join(root, "inputs");
const outputs = join(root, "outputs");
await mkdir(inputs);
await mkdir(outputs);
const image = join(inputs, "image.png");
const svg = join(inputs, "trusted.svg");
const audio = join(inputs, "voice.mp3");
const video = join(inputs, "motion.mp4");
await sharp({ create: { width, height, channels: 3, background: "#18314d" } })
  .png()
  .toFile(image);
await writeFile(
  svg,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#10243d"/><circle cx="${width / 2}" cy="${height / 3}" r="${width / 5}" fill="#66e5b7"/></svg>`,
);
await run(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4.004",
    "-codec:a",
    "libmp3lame",
    "-y",
    audio,
  ],
  { timeout: 30_000 },
);
const mp3Probe = await probeMedia(audio);
const mp3DurationMs = Number(mp3Probe.format.duration) * 1000;
assert.ok(
  Math.abs(mp3DurationMs - 4004) <= 1000 / 30 + 0.01,
  `MP3 container duration ${mp3DurationMs}ms must stay within one 30fps frame of the encoded source`,
);
await run(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=30000/1001:duration=4.004`,
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ],
  { timeout: 60_000 },
);
const sources = new Map([
  ["/image.png", image],
  ["/trusted.svg", svg],
  ["/voice.mp3", audio],
  ["/motion.mp4", video],
]);
const saved = new Map();
let failedCaptionPut = false;
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && sources.has(request.url)) {
      response.writeHead(200);
      await pipeline(createReadStream(sources.get(request.url)), response);
      return;
    }
    if (
      request.method === "PUT" &&
      /^\/(ru|uz)\/(video|poster|captions)$/.test(request.url ?? "")
    ) {
      const name = request.url.slice(1).replaceAll("/", "-");
      const target = join(outputs, name);
      await pipeline(request, createWriteStream(target));
      saved.set(request.url, target);
      if (request.url === "/ru/captions" && !failedCaptionPut) {
        failedCaptionPut = true;
        response.writeHead(503);
        response.end();
        return;
      }
      response.writeHead(200);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  } catch {
    response.writeHead(500);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const identity = async (path) => ({
  sizeBytes: (await stat(path)).size,
  sha256: createHash("sha256")
    .update(await readFile(path))
    .digest("hex"),
});
const sourceInput = async (id, path, mimeType) => ({
  asset: { assetId: id, revisionId: "pinned-v1" },
  url: `${origin}/${path.split("/").at(-1)}`,
  mimeType,
  ...(await identity(path)),
});
const summaries = [];
const registeredAssets = new Map();
try {
  for (const language of ["ru", "uz"]) {
    const rational = language === "uz";
    const fps = rational
      ? { numerator: 30000, denominator: 1001 }
      : { numerator: 30, denominator: 1 };
    const visual = await sourceInput(
      "visual",
      rational ? video : svg,
      rational ? "video/mp4" : "image/svg+xml",
    );
    const voice = await sourceInput("voice", audio, "audio/mpeg");
    const pinnedImage = await sourceInput("component-image", image, "image/png");
    const request = {
      jobId: `fixture-${language}`,
      fence: 1,
      version: { projectId: "fixture", language, versionId: `version-${language}` },
      format: { width, height, fps },
      script: {
        language,
        writingSystem: rational ? "latin" : "cyrillic",
        title: "Synthetic fixture",
        premise: "Test only",
        sceneOrder: [],
        scenesById: {},
      },
      timeline: {
        fps,
        durationFrames: 60,
        trackOrder: ["visual", "component", "voice", "caption"],
        tracksById: {
          visual: {
            kind: "visual",
            clipOrder: ["visual"],
            clipsById: {
              visual: {
                startFrame: 0,
                durationFrames: 60,
                motion: "push-in",
                source: {
                  kind: "asset",
                  asset: visual.asset,
                  ...(rational ? { sourceStartMs: 1001 } : {}),
                },
              },
            },
          },
          voice: {
            kind: "voice",
            clipOrder: ["voice"],
            clipsById: {
              voice: {
                startFrame: 0,
                durationFrames: 60,
                audio: { gainDb: -6, fadeInMs: 100, fadeOutMs: 100 },
                source: {
                  kind: "asset",
                  asset: voice.asset,
                  sourceStartMs: rational ? 1001 : 1000,
                  ...(rational ? {} : { sourceEndMs: 4000 }),
                },
              },
            },
          },
          component: {
            kind: "visual",
            clipOrder: ["authored"],
            clipsById: {
              authored: {
                startFrame: 0,
                durationFrames: 60,
                source: {
                  kind: "component",
                  component: { resourceId: "video/component/scene-graph", revisionId: "1" },
                  props: {
                    background: "#061b36",
                    nodeOrder: ["image", "title"],
                    nodesById: {
                      image: {
                        kind: "image",
                        asset: pinnedImage.asset,
                        x: 0.08,
                        y: 0.08,
                        width: 0.3,
                        height: 0.2,
                        fit: "cover",
                      },
                      title: {
                        kind: "text",
                        text: "Component",
                        x: 0.42,
                        y: 0.1,
                        width: 0.5,
                        height: 0.2,
                        fontSize: 20,
                        fontFamily: "sans-serif",
                        color: "#ffffff",
                        textAlign: "left",
                      },
                    },
                  },
                },
              },
            },
          },
          caption: {
            kind: "caption",
            clipOrder: ["caption"],
            clipsById: {
              caption: {
                startFrame: 0,
                durationFrames: 60,
                layout: { x: 0.05, y: 0.6, width: 0.9, height: 0.3, fit: "contain" },
                source: {
                  kind: "text",
                  text: rational
                    ? "O‘zbekcha sinov\nFaqat sintetik material"
                    : "Русский тест\nТолько синтетический материал",
                  style: {
                    fontFamily: "sans-serif",
                    fontSize: Math.round((22 * width) / 360),
                    color: "#ffffff",
                    textAlign: "center",
                  },
                },
              },
            },
          },
        },
      },
      inputs: [visual, voice, pinnedImage],
      outputs: Object.fromEntries(
        ["video", "poster", "captions"].map((name) => [
          name,
          { method: "PUT", url: `${origin}/${language}/${name}` },
        ]),
      ),
      ...(rational ? {} : { range: { startFrame: 0, endFrame: 60 } }),
    };
    const pending = handleVideoRender(request);
    await assert.rejects(handleVideoRender(request), (error) => error.code === "WORKER_BUSY");
    let result;
    if (language === "ru") {
      const failure = await pending.then(
        () => null,
        (error) => error,
      );
      assert.equal(failure?.code, "RESULT_PERSISTENCE_FAILED");
      assert.deepEqual(failure.persisted, ["video", "poster"]);
      result = failure.result;
      const receipt = {
        state: "partially_persisted",
        kind: "render",
        artifacts: ["video", "poster", "captions"].map((role) => ({
          role,
          path: saved.get(`/ru/${role}`),
        })),
      };
      for (const artifact of receipt.artifacts) {
        assert.ok(artifact.path, `${artifact.role} bytes survived the failed PUT response`);
        assert.deepEqual(await identity(artifact.path), {
          sha256: result[artifact.role].sha256,
          sizeBytes: result[artifact.role].sizeBytes,
        });
        registeredAssets.set(`${request.jobId}:${artifact.role}`, {
          sha256: result[artifact.role].sha256,
          sizeBytes: result[artifact.role].sizeBytes,
        });
      }
      receipt.state = "persisted";
      assert.equal(registeredAssets.size, 3);
    } else result = await pending;
    assert.equal(result.engine.remotionVersion, VERSION);
    assert.ok(result.engine.ffmpegVersion.length > 0);
    assert.equal(result.engine.fonts.length, 3);
    assert.ok(result.engine.fonts.every((font) => /^[a-f0-9]{64}$/.test(font.sha256)));
    for (const name of ["video", "poster", "captions"]) {
      const output = saved.get(`/${language}/${name}`);
      assert.ok(output, `${name} must persist`);
      assert.deepEqual(await identity(output), {
        sha256: result[name].sha256,
        sizeBytes: result[name].sizeBytes,
      });
    }
    const probe = await probeMedia(saved.get(`/${language}/video`));
    assert.ok(probe.streams.some((stream) => stream.codec_type === "audio"));
    assert.equal(result.video.width, width);
    assert.equal(result.video.height, height);
    assert.equal(result.partial, false);
    assert.deepEqual(result.video.fps, fps);
    assert.equal(
      Number(probe.streams.find((stream) => stream.codec_type === "video").nb_frames),
      60,
    );
    const expectedDurationMs = (60 * 1000 * fps.denominator) / fps.numerator;
    assert.ok(Math.abs(result.video.durationMs - expectedDurationMs) <= 120);
    const poster = await sharp(saved.get(`/${language}/poster`)).metadata();
    assert.equal(poster.width, width);
    assert.equal(poster.height, height);
    const captions = await readFile(saved.get(`/${language}/captions`), "utf8");
    assert.match(captions, /^WEBVTT/);
    assert.match(captions, /00:00:00\.000 -->/);
    assert.match(captions, rational ? /O‘zbekcha/ : /Русский/);
    summaries.push({ language, result, outputDirectory: outputs });
  }
  assert.ok(
    !(await readdir(process.env.VIDEO_RENDER_TMP_ROOT)).some((name) =>
      name.startsWith("video-render-"),
    ),
    "Worker scratch directories cleaned after success",
  );
  process.stdout.write(
    `${JSON.stringify({ synthetic: true, providerCalls: 0, summaries }, null, 2)}\n`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
