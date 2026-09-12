import { fork } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import {
  type VideoFailureReasonCode,
  VideoRenderRequest,
  VideoRenderResult,
} from "@visual-canvas/video/media";
import { chromium } from "playwright";
import { acquireMediaCapacity } from "./capacity.js";
import type { RenderProps } from "./composition.js";
import { downloadSource, fileIdentity, makePoster, probeMedia, uploadArtifact } from "./media.js";
import { buildIdentity, renderEngine } from "./provenance.js";
import { captionsVtt, frameAligned, renderRange } from "./timing.js";

let active = false;
const MAX_TOTAL_INPUT_BYTES = 4_000_000_000;
const RENDER_TIMEOUT_MS = 8 * 60 * 1000;
export class VideoWorkerError extends Error {
  constructor(
    public code: string,
    message: string,
    public effect: "not_applied" | "partial" | "unknown",
    public result?: VideoRenderResult,
    public persisted?: string[],
    public reasonCode?: VideoFailureReasonCode,
  ) {
    super(message);
  }
}

/** Trusted composition only; all media bytes arrive via scoped signed transfers. */
export async function handleVideoRender(
  input: unknown,
  callerSignal?: AbortSignal,
): Promise<VideoRenderResult> {
  const request = VideoRenderRequest.parse(input);
  if (callerSignal?.aborted)
    throw new VideoWorkerError(
      "RENDER_INTERRUPTED",
      "Request was cancelled before rendering",
      "not_applied",
      undefined,
      undefined,
      "REQUEST_INTERRUPTED",
    );
  const releaseCapacity = acquireMediaCapacity();
  if (!releaseCapacity)
    throw new VideoWorkerError(
      "WORKER_BUSY",
      "A video render is already running. Retry this job later.",
      "not_applied",
      undefined,
      undefined,
      "WORKER_CAPACITY_EXHAUSTED",
    );
  let ownedScratch: string | undefined;
  try {
    const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
    await mkdir(root, { recursive: true });
    ownedScratch = await mkdtemp(join(root, "video-render-"));
    return await new Promise<VideoRenderResult>((resolve, reject) => {
      const child = fork(fileURLToPath(new URL("./render-child.js", import.meta.url)), [], {
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: ["--max-old-space-size=1024"],
        // Deliberately do not copy server credentials into the renderer process.
        env: {
          PATH: process.env.PATH,
          NODE_ENV: process.env.NODE_ENV,
          TMPDIR: process.env.TMPDIR,
          VIDEO_RENDER_TMP_ROOT: process.env.VIDEO_RENDER_TMP_ROOT,
          VIDEO_RENDER_SCRATCHDIR: ownedScratch,
          VIDEO_FONT_DIR: process.env.VIDEO_FONT_DIR,
          VIDEO_WORKER_BUILD_SHA:
            buildIdentity(
              process.env.VIDEO_WORKER_BUILD_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA,
            ) ?? undefined,
          VIDEO_BROWSER_EXECUTABLE:
            process.env.VIDEO_BROWSER_EXECUTABLE ?? chromium.executablePath(),
        },
      });
      let settled = false;
      const kill = () => {
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      };
      const finish = (error?: Error, result?: VideoRenderResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
        kill();
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () =>
        finish(
          new VideoWorkerError(
            "RENDER_INTERRUPTED",
            "Rendering interrupted; reserved output objects may require reconciliation",
            "unknown",
            undefined,
            undefined,
            "REQUEST_INTERRUPTED",
          ),
        );
      // Parent-enforced deadline covers bundle, browser startup and uploads as
      // well as renderMedia. A stalled compiler cannot escape this watchdog.
      const timer = setTimeout(abort, RENDER_TIMEOUT_MS);
      callerSignal?.addEventListener("abort", abort, { once: true });
      child.on("error", () =>
        finish(
          new VideoWorkerError(
            "RENDER_FAILED",
            "Render process could not start",
            "not_applied",
            undefined,
            undefined,
            "RENDER_PROCESS_FAILED",
          ),
        ),
      );
      child.on("exit", () => {
        if (!settled)
          finish(
            new VideoWorkerError(
              "RENDER_INTERRUPTED",
              "Render process ended without a confirmed result",
              "unknown",
              undefined,
              undefined,
              "REQUEST_INTERRUPTED",
            ),
          );
      });
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const wire = message as {
          result?: unknown;
          error?: {
            code: string;
            reasonCode?: VideoFailureReasonCode;
            message: string;
            effect: "partial" | "unknown" | "not_applied";
            result?: VideoRenderResult;
            persisted?: string[];
          };
        };
        if (wire.error)
          finish(
            new VideoWorkerError(
              wire.error.code,
              wire.error.message,
              wire.error.effect,
              wire.error.result,
              wire.error.persisted,
              wire.error.reasonCode,
            ),
          );
        else {
          const parsed = VideoRenderResult.safeParse(wire.result);
          if (parsed.success) finish(undefined, parsed.data);
          else
            finish(
              new VideoWorkerError(
                "RENDER_FAILED",
                "Invalid renderer receipt",
                "unknown",
                undefined,
                undefined,
                "RENDER_RECEIPT_INVALID",
              ),
            );
        }
      });
      child.send(request);
    });
  } finally {
    if (ownedScratch) await rm(ownedScratch, { recursive: true, force: true });
    releaseCapacity();
  }
}

/** Child-process entry; callers use handleVideoRender for the hard deadline. */
export async function executeVideoRender(
  input: unknown,
  callerSignal?: AbortSignal,
): Promise<VideoRenderResult> {
  const request = VideoRenderRequest.parse(input);
  if (callerSignal?.aborted)
    throw new VideoWorkerError(
      "RENDER_INTERRUPTED",
      "Request cancelled before rendering",
      "not_applied",
      undefined,
      undefined,
      "REQUEST_INTERRUPTED",
    );
  if (active)
    throw new VideoWorkerError(
      "WORKER_BUSY",
      "A video render is already running. Retry this job later.",
      "not_applied",
      undefined,
      undefined,
      "WORKER_CAPACITY_EXHAUSTED",
    );
  renderRange(request);
  if (
    request.script.language !== request.version.language ||
    request.timeline.fps.numerator !== request.format.fps.numerator ||
    request.timeline.fps.denominator !== request.format.fps.denominator
  )
    throw new VideoWorkerError(
      "VALIDATION_ERROR",
      "Version language or timeline frame rate does not match the pinned inputs",
      "not_applied",
      undefined,
      undefined,
      "VERSION_CONTRACT_MISMATCH",
    );
  if (request.format.width % 2 || request.format.height % 2)
    throw new VideoWorkerError(
      "VALIDATION_ERROR",
      "H264 yuv420p dimensions must be even",
      "not_applied",
      undefined,
      undefined,
      "DIMENSIONS_UNSUPPORTED",
    );
  if (request.inputs.reduce((sum, item) => sum + item.sizeBytes, 0) > MAX_TOTAL_INPUT_BYTES)
    throw new VideoWorkerError(
      "EXECUTION_LIMIT_EXCEEDED",
      "Render inputs exceed 4,000,000,000 bytes",
      "not_applied",
      undefined,
      undefined,
      "INPUT_LIMIT_EXCEEDED",
    );
  active = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  const abort = () => controller.abort();
  callerSignal?.addEventListener("abort", abort, { once: true });
  const scratchRoot = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
  let scratch: string | undefined;
  try {
    await mkdir(scratchRoot, { recursive: true });
    scratch =
      process.env.VIDEO_RENDER_SCRATCHDIR ?? (await mkdtemp(join(scratchRoot, "video-render-")));
    return await renderInDirectory(request, scratch, controller.signal);
  } catch (error) {
    if (error instanceof VideoWorkerError) throw error;
    if (controller.signal.aborted)
      throw new VideoWorkerError(
        "RENDER_INTERRUPTED",
        "Rendering stopped or timed out; already uploaded outputs may require reconciliation",
        "unknown",
        undefined,
        undefined,
        "REQUEST_INTERRUPTED",
      );
    // Never return exception text containing signed URLs, filesystem paths or browser logs.
    throw new VideoWorkerError(
      "RENDER_FAILED",
      "Rendering or source validation failed. Check the pinned media and frame-aligned timing.",
      "not_applied",
      undefined,
      undefined,
      classifyRenderFailure(error),
    );
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abort);
    if (scratch) await rm(scratch, { recursive: true, force: true });
    active = false;
  }
}

async function renderInDirectory(
  request: VideoRenderRequest,
  scratch: string,
  signal: AbortSignal,
) {
  const publicDir = join(scratch, "public");
  await mkdir(publicDir);
  const fontDir = process.env.VIDEO_FONT_DIR ?? "/usr/share/fonts/truetype/dejavu";
  for (const font of ["DejaVuSans.ttf", "DejaVuSerif.ttf", "DejaVuSansMono.ttf"])
    await copyFile(join(fontDir, font), join(publicDir, font));
  const files: RenderProps["files"] = {};
  const sourceDurations = new Map<string, number>();
  const sourceKinds = new Map<string, string[]>();
  for (const [index, input] of request.inputs.entries()) {
    const key = `${input.asset.assetId}:${input.asset.revisionId}`;
    if (files[key]) throw new Error("Duplicate input asset");
    const ext = renderSourceExtension(input.mimeType);
    const path = `${index}.${ext}`;
    await downloadSource(input, join(publicDir, path), signal);
    files[key] = { path, mimeType: input.mimeType };
    if (!renderSourceNeedsProbe(input.mimeType)) {
      sourceKinds.set(key, []);
      continue;
    }
    const metadata = await probeMedia(join(publicDir, path), signal);
    sourceDurations.set(key, Number(metadata.format.duration));
    sourceKinds.set(
      key,
      metadata.streams.map((stream) => stream.codec_type),
    );
  }
  const fps = request.format.fps.numerator / request.format.fps.denominator;
  let expectedAudio = false;
  for (const track of Object.values(request.timeline.tracksById))
    for (const clip of Object.values(track.clipsById)) {
      if (clip.source.kind === "component") {
        if (track.kind !== "visual") throw new Error("Components require a visual track");
        if ("nodesById" in clip.source.props)
          for (const node of Object.values(clip.source.props.nodesById)) {
            if (
              node.kind === "image" &&
              !files[`${node.asset.assetId}:${node.asset.revisionId}`]?.mimeType.startsWith(
                "image/",
              )
            )
              throw new Error("Component image requires a pinned image source");
          }
        continue;
      }
      if (clip.source.kind === "text") {
        if (!["caption", "visual"].includes(track.kind))
          throw new Error("Text cannot be an audio source");
        continue;
      }
      const key = `${clip.source.asset.assetId}:${clip.source.asset.revisionId}`;
      const file = files[key];
      if (!file) throw new Error("Missing pinned source");
      const kinds = sourceKinds.get(key) ?? [];
      const isAudio = file.mimeType.startsWith("audio/");
      const isVideo = file.mimeType.startsWith("video/");
      if (["voice", "music", "sfx"].includes(track.kind) && !isAudio)
        throw new Error("Audio tracks require audio sources");
      if (isAudio && !["voice", "music", "sfx"].includes(track.kind))
        throw new Error("Audio source requires audio track");
      if ((isAudio && !kinds.includes("audio")) || (isVideo && !kinds.includes("video")))
        throw new Error("Source stream type mismatch");
      if (isAudio || isVideo) {
        const startMs = clip.source.sourceStartMs ?? 0;
        frameAligned(startMs, fps);
        const sourceDurationMs = (sourceDurations.get(key) ?? 0) * 1000;
        const endMs = clip.source.sourceEndMs ?? sourceDurationMs;
        if (clip.source.sourceEndMs !== undefined) frameAligned(clip.source.sourceEndMs, fps);
        if (!sourceTrimFits(startMs, endMs, sourceDurationMs, clip.durationFrames, fps))
          throw new Error("Clip exceeds source trim range");
        expectedAudio ||= isAudio || (isVideo && Boolean(clip.audio) && kinds.includes("audio"));
      }
    }
  const props: RenderProps = { format: request.format, timeline: request.timeline, files };
  const entryPoint = fileURLToPath(new URL("./entry.js", import.meta.url));
  const serveUrl = await bundle({
    entryPoint,
    outDir: join(scratch, "bundle"),
    publicDir,
    enableCaching: false,
  });
  signal.throwIfAborted();
  const browserExecutable = process.env.VIDEO_BROWSER_EXECUTABLE ?? chromium.executablePath();
  const composition = await selectComposition({
    serveUrl,
    id: "VideoStudio",
    inputProps: props,
    browserExecutable,
    logLevel: "error",
  });
  const { cancel, cancelSignal } = makeCancelSignal();
  const stop = () => cancel();
  signal.addEventListener("abort", stop, { once: true });
  const range = renderRange(request);
  const videoPath = join(scratch, "render.mp4");
  try {
    await renderMedia({
      composition,
      serveUrl,
      inputProps: props,
      outputLocation: videoPath,
      browserExecutable,
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: 18,
      concurrency: 1,
      logLevel: "error",
      cancelSignal,
      frameRange: [range.start, range.end - 1],
    });
  } finally {
    signal.removeEventListener("abort", stop);
  }
  const metadata = await probeMedia(videoPath, signal);
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  const hasAudio = metadata.streams.some((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(Number(metadata.format.duration) * 1000);
  const actualFps = video?.avg_frame_rate?.split("/").map(Number);
  if (
    !video ||
    video.width !== request.format.width ||
    video.height !== request.format.height ||
    Number(video.nb_frames) !== range.frames ||
    !Number.isFinite(durationMs) ||
    Math.abs(durationMs - (range.frames / fps) * 1000) > 120 ||
    !actualFps ||
    Math.abs(actualFps[0]! / actualFps[1]! - fps) > 0.0001 ||
    (expectedAudio && !hasAudio)
  )
    throw new Error("Rendered metadata differs from inputs");
  const posterPath = join(scratch, "poster.png");
  await makePoster(videoPath, posterPath, signal);
  const captionsPath = join(scratch, "captions.vtt");
  await writeFile(captionsPath, captionsVtt(request));
  const result = VideoRenderResult.parse({
    engine: await renderEngine(
      [
        { family: "DejaVu Sans", path: join(publicDir, "DejaVuSans.ttf") },
        { family: "DejaVu Serif", path: join(publicDir, "DejaVuSerif.ttf") },
        { family: "DejaVu Sans Mono", path: join(publicDir, "DejaVuSansMono.ttf") },
      ],
      signal,
    ),
    jobId: request.jobId,
    fence: request.fence,
    video: {
      ...(await fileIdentity(videoPath)),
      mimeType: "video/mp4",
      width: video.width,
      height: video.height,
      durationMs,
      fps: request.format.fps,
    },
    poster: {
      ...(await fileIdentity(posterPath)),
      mimeType: "image/png",
      width: video.width,
      height: video.height,
    },
    captions: { ...(await fileIdentity(captionsPath)), mimeType: "text/vtt" },
    partial: range.partial,
    checks: [
      { name: "dimensions_frames_duration_fps", outcome: "pass" },
      { name: "source_integrity", outcome: "pass" },
      {
        name: "audio_presence",
        outcome: "pass",
        reason: hasAudio
          ? "Audio stream measured in the rendered MP4"
          : "No audio stream measured; the pinned timeline does not request audio",
      },
      {
        name: "font_mapping",
        outcome: "pass",
        reason:
          "sans-serif=DejaVu Sans; serif=DejaVu Serif; monospace=DejaVu Sans Mono. Container fonts are pinned by deployment.",
      },
      {
        name: "text_overflow",
        outcome: "not_evaluated",
        reason: "Layout coverage has not been measured",
      },
      {
        name: "artistic_quality",
        outcome: "not_evaluated",
        reason: "Requires independent audiovisual review",
      },
    ],
  });
  const persisted: string[] = [];
  try {
    for (const [name, path, mime] of [
      ["video", videoPath, "video/mp4"],
      ["poster", posterPath, "image/png"],
      ["captions", captionsPath, "text/vtt"],
    ] as const) {
      await uploadArtifact(request.outputs[name].url, path, mime, signal);
      persisted.push(name);
    }
  } catch {
    throw new VideoWorkerError(
      "RESULT_PERSISTENCE_FAILED",
      "Rendered bytes exist but output persistence could not be confirmed. Reconcile this job’s reserved objects.",
      "partial",
      result,
      persisted,
      "RESULT_UPLOAD_FAILED",
    );
  }
  return result;
}

const renderSourceExtensions: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
};

export function renderSourceExtension(mimeType: string) {
  const extension = renderSourceExtensions[mimeType];
  if (!extension) throw new Error("Unsupported source MIME");
  return extension;
}

export function renderSourceNeedsProbe(mimeType: string) {
  return mimeType !== "image/svg+xml";
}

export function sourceTrimFits(
  startMs: number,
  endMs: number,
  sourceDurationMs: number,
  clipDurationFrames: number,
  fps: number,
) {
  const frameToleranceMs = 1000 / fps + 0.01;
  return (
    Number.isFinite(endMs) &&
    endMs > startMs &&
    endMs <= sourceDurationMs + frameToleranceMs &&
    startMs + (clipDurationFrames / fps) * 1000 <= endMs + frameToleranceMs
  );
}

/** Converts internal exception categories into a bounded, non-sensitive diagnostic code. */
export function classifyRenderFailure(error: unknown): VideoFailureReasonCode {
  const message = error instanceof Error ? error.message : "";
  if (message === "Unsupported source MIME") return "UNSUPPORTED_SOURCE_MIME";
  if (message === "Input transfer failed") return "INPUT_TRANSFER_FAILED";
  if (
    message === "Input checksum or size mismatch" ||
    message === "Input size exceeds reserved bytes"
  )
    return "INPUT_INTEGRITY_MISMATCH";
  if (
    message === "Source stream type mismatch" ||
    message === "Audio tracks require audio sources" ||
    message === "Audio source requires audio track" ||
    message === "Component image requires a pinned image source"
  )
    return "SOURCE_STREAM_MISMATCH";
  if (message === "Clip exceeds source trim range") return "SOURCE_TRIM_EXCEEDED";
  if (message === "Rendered metadata differs from inputs") return "OUTPUT_METADATA_MISMATCH";
  if (
    message === "Duplicate input asset" ||
    message === "Components require a visual track" ||
    message === "Text cannot be an audio source" ||
    message === "Missing pinned source"
  )
    return "VERSION_CONTRACT_MISMATCH";
  return "RENDER_PROCESS_FAILED";
}
