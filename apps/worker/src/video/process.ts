import { execFile, fork } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MediaProcessRequest, MediaProcessResult } from "@visual-canvas/video/operations";
import sharp from "sharp";
import { executeAudioMix } from "./audio-mix.js";
import { acquireMediaCapacity } from "./capacity.js";
import {
  downloadSource,
  fileIdentity,
  probeMedia,
  safeLocalMediaArgs,
  uploadArtifact,
} from "./media.js";

const run = promisify(execFile);
const DEADLINE = 300_000;
export function detectedIntervals(log: string, kind: "black" | "freeze", durationMs: number) {
  const intervals: { startMs: number; endMs: number }[] = [];
  let start: number | null = null;
  for (const match of log.matchAll(new RegExp(`${kind}_(start|end):\\s*([\\d.]+)`, "g"))) {
    const time = Math.max(0, Math.min(durationMs, Number(match[2]) * 1000));
    if (match[1] === "start") start = time;
    else if (start !== null) {
      if (time > start) intervals.push({ startMs: start, endMs: time });
      start = null;
    }
  }
  if (start !== null && start < durationMs) intervals.push({ startMs: start, endMs: durationMs });
  return intervals;
}
export class MediaProcessError extends Error {
  constructor(
    public code: string,
    public effect: "not_applied" | "partial" | "unknown",
    public result?: MediaProcessResult,
    public persisted: string[] = [],
  ) {
    super(code);
  }
}
export async function handleMediaProcess(
  input: unknown,
  signal?: AbortSignal,
): Promise<MediaProcessResult> {
  const request = MediaProcessRequest.parse(input);
  if (signal?.aborted) throw new MediaProcessError("MEDIA_INTERRUPTED", "not_applied");
  const release = acquireMediaCapacity();
  if (!release) throw new MediaProcessError("WORKER_BUSY", "not_applied");
  let scratch: string | undefined;
  try {
    const root = process.env.VIDEO_RENDER_TMP_ROOT ?? tmpdir();
    await mkdir(root, { recursive: true });
    scratch = await mkdtemp(join(root, "media-process-"));
    return await new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(new URL("./process-child.js", import.meta.url)), [], {
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: ["--max-old-space-size=512"],
        env: {
          PATH: process.env.PATH,
          NODE_ENV: process.env.NODE_ENV,
          TMPDIR: root,
          MEDIA_PROCESS_SCRATCH: scratch,
        },
      });
      let settled = false;
      const finish = (error?: MediaProcessError, result?: MediaProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", interrupted);
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {}
        if (error) reject(error);
        else resolve(result!);
      };
      const interrupted = () => finish(new MediaProcessError("MEDIA_INTERRUPTED", "unknown"));
      const timer = setTimeout(interrupted, DEADLINE);
      signal?.addEventListener("abort", interrupted, { once: true });
      if (signal?.aborted) interrupted();
      child.once("error", () => finish(new MediaProcessError("MEDIA_START_FAILED", "not_applied")));
      child.once("exit", () => {
        if (!settled) interrupted();
      });
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        if ("error" in message && message.error && typeof message.error === "object") {
          const e = message.error as {
            code: string;
            effect: "partial" | "unknown" | "not_applied";
            result?: MediaProcessResult;
            persisted?: string[];
          };
          finish(new MediaProcessError(e.code, e.effect, e.result, e.persisted));
        } else {
          const parsed = MediaProcessResult.safeParse("result" in message ? message.result : null);
          finish(
            parsed.success ? undefined : new MediaProcessError("MEDIA_RECEIPT_INVALID", "unknown"),
            parsed.success ? parsed.data : undefined,
          );
        }
      });
      if (!settled) child.send(request);
    });
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    release();
  }
}

/** Only invoked in the bounded child; no server credentials or arbitrary command arguments. */
export async function executeMediaProcess(input: unknown): Promise<MediaProcessResult> {
  const request = MediaProcessRequest.parse(input);
  const scratch = process.env.MEDIA_PROCESS_SCRATCH;
  if (!scratch) throw new MediaProcessError("MEDIA_SCRATCH_MISSING", "not_applied");
  const signal = AbortSignal.timeout(DEADLINE - 1000);
  if (request.operation.kind === "audio_mix") return executeAudioMix(request, scratch, signal);
  const source = request.inputs[0]!;
  const path = join(scratch, "source");
  const outputs: MediaProcessResult["outputs"] = [];
  const paths = new Map<string, string>();
  const checks: MediaProcessResult["checks"] = [{ name: "source_integrity", outcome: "pass" }];
  const ffmpeg = async (args: string[]) =>
    run("ffmpeg", ["-nostdin", "-nostats", "-threads", "1", ...(await safeLocalMediaArgs(args))], {
      signal,
      timeout: DEADLINE - 1000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
    });
  await downloadSource(source, path, signal);
  const probe = await probeMedia(path, signal);
  const video = probe.streams.find((item) => item.codec_type === "video");
  const audio = probe.streams.find((item) => item.codec_type === "audio");
  const op = request.operation;
  const durationMs =
    Number((op.kind === "waveform" ? audio?.duration : video?.duration) ?? probe.format.duration) *
    1000;
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > 600_000 ||
    (op.kind === "waveform" ? !audio : !video?.width || !video.height)
  )
    throw new MediaProcessError("UNSUPPORTED_MEDIA", "not_applied");
  const videoWidth = video?.width ?? 0;
  const videoHeight = video?.height ?? 0;
  async function artifact(
    name: string,
    path: string,
    mimeType: string,
    metadata: Partial<MediaProcessResult["outputs"][number]> = {},
  ) {
    outputs.push({ name, ...(await fileIdentity(path)), mimeType, ...metadata });
    paths.set(name, path);
  }
  if (op.kind === "waveform") {
    if (op.startMs >= durationMs || op.startMs + op.durationMs > durationMs + 1)
      throw new MediaProcessError("WAVEFORM_RANGE_OUT_OF_RANGE", "not_applied");
    const channels = audio?.channels ?? 0;
    if ((op.channel === "left" || op.channel === "right") && channels < 2)
      throw new MediaProcessError("WAVEFORM_CHANNEL_UNAVAILABLE", "not_applied");
    const destination = join(scratch, "waveform.png");
    const report = join(scratch, "waveform-report.json");
    const channelFilter =
      op.channel === "left"
        ? "pan=mono|c0=c0"
        : op.channel === "right"
          ? "pan=mono|c0=c1"
          : "aformat=channel_layouts=mono";
    await ffmpeg([
      "-v",
      "error",
      "-ss",
      String(op.startMs / 1000),
      "-t",
      String(op.durationMs / 1000),
      "-i",
      path,
      "-vn",
      "-filter_complex",
      `${channelFilter},atrim=duration=${op.durationMs / 1000},asetpts=PTS-STARTPTS,showwavespic=s=${op.width}x${op.height}:colors=4f9cf9:scale=sqrt`,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      destination,
    ]);
    await writeFile(
      report,
      JSON.stringify({
        source: source.asset,
        sourceSha256: source.sha256,
        coverage: { startMs: op.startMs, endMs: op.startMs + op.durationMs },
        channel: op.channel,
        sourceAudio: {
          codec: audio?.codec_name ?? null,
          channels,
          sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
          durationMs,
        },
        rendering: {
          width: op.width,
          height: op.height,
          amplitudeScale: "sqrt",
          decoder: "ffmpeg",
        },
        limitation:
          "Decoded amplitude overview for the declared time/channel scope; it is not speech alignment, transcription, loudness, or semantic analysis.",
      }),
    );
    await artifact("waveform", destination, "image/png", {
      width: op.width,
      height: op.height,
      durationMs: op.durationMs,
    });
    await artifact("report", report, "application/json", { durationMs: op.durationMs });
    checks.push({ name: "audio_decode", outcome: "pass" });
  } else if (op.kind === "frames" || op.kind === "compare") {
    const cells: Buffer[] = [];
    const contexts = [{ path, durationMs, width: videoWidth }];
    if (op.kind === "compare") {
      const otherPath = join(scratch, "source-b");
      await downloadSource(request.inputs[1]!, otherPath, signal);
      const otherProbe = await probeMedia(otherPath, signal);
      const otherVideo = otherProbe.streams.find((stream) => stream.codec_type === "video");
      const otherDuration = Number(otherVideo?.duration ?? otherProbe.format.duration) * 1000;
      if (
        !otherVideo?.width ||
        !Number.isFinite(otherDuration) ||
        otherDuration <= 0 ||
        otherDuration > 600000
      )
        throw new MediaProcessError("UNSUPPORTED_MEDIA", "not_applied");
      contexts.push({ path: otherPath, durationMs: otherDuration, width: otherVideo.width });
    }
    const samples = op.timesMs.flatMap((ms, index) =>
      contexts.map((context, sourceIndex) => ({ ms, index, context, sourceIndex })),
    );
    for (const { ms, index, context, sourceIndex } of samples) {
      if (ms >= context.durationMs)
        throw new MediaProcessError("FRAME_TIME_OUT_OF_RANGE", "not_applied");
      const name =
        op.kind === "compare"
          ? `frame-${sourceIndex === 0 ? "a" : "b"}-${index}`
          : `frame-${index}`;
      const destination = join(scratch, `${name}.png`);
      const width = Math.min(op.maxWidth, context.width);
      const { stderr } = await ffmpeg([
        "-v",
        "info",
        "-i",
        context.path,
        "-an",
        "-vf",
        `select=gte(t\\,${ms / 1000}),scale=${width}:-1,showinfo`,
        "-frames:v",
        "1",
        "-threads",
        "1",
        "-y",
        destination,
      ]);
      const actual = /pts_time:([0-9.]+)/.exec(stderr);
      if (!actual) throw new MediaProcessError("FRAME_NOT_FOUND", "not_applied");
      const dimensions = await sharp(destination).metadata();
      await artifact(name, destination, "image/png", {
        sourceIndex,
        width: dimensions.width,
        height: dimensions.height,
        requestedMs: ms,
        actualMs: Number(actual[1]) * 1000,
      });
      const thumb = await sharp(destination)
        .resize(320, 180, { fit: "contain", background: "#111827" })
        .png()
        .toBuffer();
      const sourceLabel =
        op.kind === "compare"
          ? (op.labels?.[sourceIndex] ?? (sourceIndex === 0 ? "A" : "B"))
          : String(index + 1);
      const escapedLabel = sourceLabel.replace(
        /[<>&"']/g,
        (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
      );
      const label = Buffer.from(
        `<svg width="320" height="24"><rect width="320" height="24" fill="#111827"/><text x="8" y="17" fill="white" font-size="12">${escapedLabel}: requested ${ms}ms / frame ${Math.round(Number(actual[1]) * 1000)}ms</text></svg>`,
      );
      cells.push(
        await sharp({ create: { width: 320, height: 204, channels: 4, background: "#111827" } })
          .composite([
            { input: thumb, left: 0, top: 0 },
            { input: label, left: 0, top: 180 },
          ])
          .png()
          .toBuffer(),
      );
    }
    const columns = op.kind === "compare" ? 2 : Math.min(op.columns, cells.length);
    const sheet = join(scratch, "contactsheet.png");
    const width = columns * 320;
    const height = Math.ceil(cells.length / columns) * 204;
    await sharp({ create: { width, height, channels: 4, background: "#111827" } })
      .composite(
        cells.map((input, index) => ({
          input,
          left: (index % columns) * 320,
          top: Math.floor(index / columns) * 204,
        })),
      )
      .png()
      .toFile(sheet);
    await artifact("contactsheet", sheet, "image/png", { width, height });
  } else if (op.kind === "proxy") {
    const destination = join(scratch, "proxy.mp4");
    const targetBits = Math.floor((op.maxOutputBytes * 8 * 0.85) / (durationMs / 1000));
    const audioBits = audio ? 48000 : 0;
    if (targetBits - audioBits < 16000)
      throw new MediaProcessError("PROXY_SIZE_UNSATISFIABLE", "not_applied");
    const width = Math.max(2, Math.floor(Math.min(op.maxWidth, videoWidth) / 2) * 2);
    await ffmpeg([
      "-v",
      "error",
      "-i",
      path,
      "-map",
      "0:v:0",
      ...(audio ? ["-map", "0:a:0", "-c:a", "aac", "-b:a", "48k", "-ac", "1"] : ["-an"]),
      "-vf",
      `scale=${width}:-2,fps=${op.fps}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-threads",
      "1",
      "-b:v",
      String(targetBits - audioBits),
      "-maxrate",
      String(targetBits - audioBits),
      "-bufsize",
      String((targetBits - audioBits) * 2),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-fs",
      String(op.maxOutputBytes + 65536),
      "-y",
      destination,
    ]);
    const measured = await probeMedia(destination, signal);
    const identity = await fileIdentity(destination);
    const v = measured.streams.find((item) => item.codec_type === "video");
    const outputDuration = Number(v?.duration ?? measured.format.duration) * 1000;
    if (
      identity.sizeBytes > op.maxOutputBytes ||
      !v?.width ||
      !v.height ||
      Math.abs(outputDuration - durationMs) > Math.max(120, 1000 / op.fps + 50)
    )
      throw new MediaProcessError("PROXY_SIZE_UNSATISFIABLE", "not_applied");
    await artifact("proxy", destination, "video/mp4", {
      width: v.width,
      height: v.height,
      durationMs: outputDuration,
    });
  } else {
    let decode = true;
    try {
      await ffmpeg([
        "-v",
        "error",
        "-xerror",
        "-i",
        path,
        "-map",
        "0:v:0",
        ...(audio ? ["-map", "0:a:0"] : []),
        "-f",
        "null",
        "-",
      ]);
    } catch {
      decode = false;
    }
    checks.push({ name: "decode", outcome: decode ? "pass" : "fail" });
    checks.push({
      name: "dimensions",
      outcome:
        (op.expectedWidth === undefined || videoWidth === op.expectedWidth) &&
        (op.expectedHeight === undefined || videoHeight === op.expectedHeight)
          ? "pass"
          : "fail",
    });
    checks.push({
      name: "duration",
      outcome:
        op.expectedDurationMs === undefined || Math.abs(durationMs - op.expectedDurationMs) <= 120
          ? "pass"
          : "fail",
    });
    checks.push({ name: "audio_presence", outcome: audio || !op.requiredAudio ? "pass" : "fail" });
    let peakDb: number | null = null;
    let meanDb: number | null = null;
    let longestSilenceMs: number | null = null;
    if (audio && decode) {
      const { stderr } = await ffmpeg([
        "-v",
        "info",
        "-i",
        path,
        "-vn",
        "-af",
        `volumedetect,silencedetect=noise=${op.silenceThresholdDb}dB:d=0.1`,
        "-f",
        "null",
        "-",
      ]);
      const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
      const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
      peakDb = peak ? Number(peak[1]) : null;
      meanDb = mean ? Number(mean[1]) : null;
      longestSilenceMs = Math.max(
        0,
        ...[...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map(
          (item) => Number(item[1]) * 1000,
        ),
      );
    }
    checks.push({
      name: "audio_clipping",
      outcome: peakDb === null ? "not_evaluated" : peakDb <= op.maxPeakDb ? "pass" : "fail",
      reason:
        peakDb === null
          ? "No measured audio peak"
          : `Peak ${peakDb} dBFS; limit ${op.maxPeakDb} dBFS`,
    });
    checks.push({
      name: "unexpected_silence",
      outcome:
        longestSilenceMs === null
          ? "not_evaluated"
          : longestSilenceMs <= op.maxSilenceMs
            ? "pass"
            : "fail",
      reason: "Threshold-based silence; this does not determine artistic intent",
    });
    let integratedLufs: number | null = null;
    let truePeakDb: number | null = null;
    if (audio && decode) {
      const { stderr } = await ffmpeg([
        "-v",
        "info",
        "-i",
        path,
        "-vn",
        "-af",
        "loudnorm=I=-16:TP=-1:LRA=11:print_format=json",
        "-f",
        "null",
        "-",
      ]);
      const match = [...stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)].at(-1)?.[0];
      if (match) {
        const data = JSON.parse(match) as { input_i: string; input_tp: string };
        integratedLufs = Number.isFinite(Number(data.input_i)) ? Number(data.input_i) : null;
        truePeakDb = Number.isFinite(Number(data.input_tp)) ? Number(data.input_tp) : null;
      }
    }
    checks.push({
      name: "audio_loudness",
      outcome:
        integratedLufs === null
          ? "not_evaluated"
          : integratedLufs >= op.minLufs && integratedLufs <= op.maxLufs
            ? "pass"
            : "fail",
      reason:
        integratedLufs === null
          ? "No finite integrated loudness (possibly silent or absent audio)"
          : `Measured ${integratedLufs} LUFS; allowed ${op.minLufs}–${op.maxLufs}`,
    });
    let blackIntervals: ReturnType<typeof detectedIntervals> | null = null;
    let freezeIntervals: ReturnType<typeof detectedIntervals> | null = null;
    if (decode) {
      const { stderr } = await ffmpeg([
        "-v",
        "info",
        "-i",
        path,
        "-an",
        "-vf",
        "blackdetect=d=0.1:pic_th=0.98:pix_th=0.1,freezedetect=n=-50dB:d=0.5",
        "-f",
        "null",
        "-",
      ]);
      blackIntervals = detectedIntervals(stderr, "black", durationMs);
      freezeIntervals = detectedIntervals(stderr, "freeze", durationMs);
    }
    for (const [name, intervals, limit] of [
      ["black_frames", blackIntervals, op.maxBlackMs],
      ["freeze_frames", freezeIntervals, op.maxFreezeMs],
    ] as const) {
      const longest = intervals
        ? Math.max(0, ...intervals.map((item) => item.endMs - item.startMs))
        : null;
      checks.push({
        name,
        outcome:
          longest === null || limit === undefined
            ? "not_evaluated"
            : longest <= limit
              ? "pass"
              : "fail",
        reason:
          longest === null
            ? "Media could not be decoded"
            : limit === undefined
              ? `Measured longest interval ${longest}ms; no acceptance threshold supplied (static or black scenes may be intentional)`
              : `Longest interval ${longest}ms; allowed ${limit}ms`,
      });
    }
    for (const name of ["caption_timing", "text_overflow", "safe_areas", "missing_assets"])
      checks.push({
        name,
        outcome: "not_evaluated",
        reason: "This operation does not measure this check; no pass inferred",
      });
    const destination = join(scratch, "report.json");
    await writeFile(
      destination,
      JSON.stringify({
        source: source.asset,
        sourceSha256: source.sha256,
        coverage: { startMs: 0, endMs: durationMs },
        metadata: probe,
        measurements: {
          peakDb,
          meanDb,
          longestSilenceMs,
          integratedLufs,
          truePeakDb,
          blackIntervals,
          freezeIntervals,
        },
        checks,
        outcome: checks.some((check) => check.outcome === "fail") ? "fail" : "inconclusive",
      }),
    );
    await artifact("report", destination, "application/json");
  }
  const result = MediaProcessResult.parse({
    jobId: request.jobId,
    fence: request.fence,
    kind: op.kind,
    source: source.asset,
    sourceSha256: source.sha256,
    sources: request.inputs.map((input) => ({ asset: input.asset, sha256: input.sha256 })),
    outputs,
    checks,
    sampling: {
      mode:
        op.kind === "frames" || op.kind === "compare"
          ? "exact_requested_frames"
          : op.kind === "waveform"
            ? "waveform"
            : op.kind === "proxy"
              ? "proxy"
              : "full_decode",
      ...(op.kind === "proxy" ? { fps: op.fps } : {}),
      range:
        op.kind === "waveform"
          ? { startMs: op.startMs, endMs: op.startMs + op.durationMs }
          : { startMs: 0, endMs: durationMs },
      limitation:
        op.kind === "frames" || op.kind === "compare"
          ? "Contact sheet omits intervening motion and audio; actual extracted frame timestamps are recorded."
          : op.kind === "waveform"
            ? "Decoded amplitude overview for the declared time/channel scope; not speech alignment, loudness, or semantic analysis."
            : op.kind === "proxy"
              ? "Lossy analysis proxy, not original quality; source timing starts at zero."
              : "Full media decode and explicit technical checks; missing checks remain not_evaluated.",
    },
  });
  const persisted: string[] = [];
  try {
    for (const output of outputs) {
      await uploadArtifact(
        request.outputs[output.name]!.url,
        paths.get(output.name)!,
        output.mimeType,
        signal,
      );
      persisted.push(output.name);
    }
  } catch {
    throw new MediaProcessError("RESULT_PERSISTENCE_FAILED", "partial", result, persisted);
  }
  return result;
}
