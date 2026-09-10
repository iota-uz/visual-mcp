import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type MediaProcessRequest, MediaProcessResult } from "@visual-canvas/video/operations";
import {
  downloadSource,
  fileIdentity,
  probeMedia,
  safeLocalMediaArgs,
  uploadArtifact,
} from "./media.js";
import { MediaProcessError } from "./process.js";

const run = promisify(execFile);
type Mix = Extract<MediaProcessRequest["operation"], { kind: "audio_mix" }>;
export function audioFilter(op: Mix) {
  const filters = op.tracks.map((track, index) => {
    const length = (track.trimEndMs - track.trimStartMs) / 1000;
    let value = `[${track.inputIndex}:a:0]atrim=start=${track.trimStartMs / 1000}:end=${track.trimEndMs / 1000},asetpts=PTS-STARTPTS,aresample=${op.mastering.sampleRate},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${track.gainDb}dB`;
    if (track.fadeInMs) value += `,afade=t=in:st=0:d=${track.fadeInMs / 1000}`;
    if (track.fadeOutMs)
      value += `,afade=t=out:st=${length - track.fadeOutMs / 1000}:d=${track.fadeOutMs / 1000}`;
    value += `,adelay=${track.startMs}:all=1`;
    if (op.ducking?.targetTrackIds.includes(track.trackId)) {
      const d = op.ducking;
      const gain = 10 ** (-d.reductionDb / 20);
      const windows = op.tracks
        .filter((t) => d.triggerTrackIds.includes(t.trackId))
        .map((trigger) => {
          const start = trigger.startMs / 1000;
          const end = start + (trigger.trimEndMs - trigger.trimStartMs) / 1000;
          const attack = d.attackMs / 1000;
          const release = d.releaseMs / 1000;
          const a = Math.max(0, start - attack);
          return `if(lt(t,${a}),1,if(lt(t,${start}),1-${1 - gain}*(t-${a})/${Math.max(0.000001, start - a)},if(lt(t,${end}),${gain},if(lt(t,${end + release}),${gain}+${1 - gain}*(t-${end})/${release},1))))`;
        });
      const expression = windows.reduce((a, b) => `min(${a},${b})`);
      value += `,volume='${expression}':eval=frame`;
    }
    return `${value}[track${index}]`;
  });
  filters.push(
    `${op.tracks.map((_, index) => `[track${index}]`).join("")}amix=inputs=${op.tracks.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${op.durationMs / 1000}[mixed]`,
  );
  return filters.join(";");
}
function loudness(stderr: string) {
  const match = /\{\s*"input_i"[\s\S]*?\}/g;
  const matches = [...stderr.matchAll(match)];
  const text = matches.at(-1)?.[0];
  if (!text) throw new MediaProcessError("LOUDNESS_MEASUREMENT_FAILED", "not_applied");
  const value = JSON.parse(text) as Record<string, string>;
  const fields = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const;
  const result = Object.fromEntries(fields.map((field) => [field, Number(value[field])])) as Record<
    (typeof fields)[number],
    number
  >;
  if (!Object.values(result).every(Number.isFinite))
    throw new MediaProcessError("SILENT_MIX_CANNOT_BE_MASTERED", "not_applied");
  return result;
}
export async function executeAudioMix(
  request: MediaProcessRequest,
  scratch: string,
  signal: AbortSignal,
): Promise<MediaProcessResult> {
  const op = request.operation;
  if (op.kind !== "audio_mix") throw new MediaProcessError("VALIDATION_ERROR", "not_applied");
  const ffmpeg = async (args: string[]) =>
    run("ffmpeg", ["-nostdin", "-nostats", "-threads", "1", ...(await safeLocalMediaArgs(args))], {
      signal,
      timeout: 299000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
    });
  const files: string[] = [];
  for (const [index, input] of request.inputs.entries()) {
    const file = join(scratch, `source-${index}`);
    await downloadSource(input, file, signal);
    const probe = await probeMedia(file, signal);
    const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    const durationMs = Number(audio?.duration ?? probe.format.duration) * 1000;
    if (
      !audio ||
      !Number.isFinite(durationMs) ||
      op.tracks.some((track) => track.inputIndex === index && track.trimEndMs > durationMs + 1)
    )
      throw new MediaProcessError("AUDIO_TRIM_OUT_OF_RANGE", "not_applied");
    files.push(file);
  }
  const mixed = join(scratch, "unmastered.wav");
  const output = join(scratch, "audio.wav");
  await ffmpeg([
    "-v",
    "error",
    ...files.flatMap((file) => ["-i", file]),
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    audioFilter(op),
    "-map",
    "[mixed]",
    "-ar",
    String(op.mastering.sampleRate),
    "-c:a",
    "pcm_f32le",
    "-y",
    mixed,
  ]);
  const filter = `loudnorm=I=${op.mastering.targetLufs}:TP=${op.mastering.maxTruePeakDb}:LRA=${op.mastering.loudnessRange}`;
  const first = loudness(
    (
      await ffmpeg([
        "-v",
        "info",
        "-i",
        mixed,
        "-af",
        `${filter}:print_format=json`,
        "-f",
        "null",
        "-",
      ])
    ).stderr,
  );
  const second = `${filter}:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true`;
  await ffmpeg([
    "-v",
    "error",
    "-i",
    mixed,
    "-af",
    second,
    "-ar",
    String(op.mastering.sampleRate),
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    "-y",
    output,
  ]);
  const final = loudness(
    (
      await ffmpeg([
        "-v",
        "info",
        "-i",
        output,
        "-af",
        `${filter}:print_format=json`,
        "-f",
        "null",
        "-",
      ])
    ).stderr,
  );
  const measured = await probeMedia(output, signal);
  const durationMs = Number(measured.format.duration) * 1000;
  const audio = measured.streams.find((stream) => stream.codec_type === "audio");
  if (
    !audio ||
    audio.sample_rate !== String(op.mastering.sampleRate) ||
    audio.channels !== 2 ||
    Math.abs(durationMs - op.durationMs) > 2
  )
    throw new MediaProcessError("MIX_METADATA_MISMATCH", "not_applied");
  const checks: MediaProcessResult["checks"] = [
    { name: "source_integrity", outcome: "pass" },
    { name: "duration_sample_rate_channels", outcome: "pass" },
    {
      name: "audio_loudness",
      outcome: Math.abs(final.input_i - op.mastering.targetLufs) <= 1 ? "pass" : "fail",
      reason: `Measured ${final.input_i} LUFS; target ${op.mastering.targetLufs} LUFS ±1`,
    },
    {
      name: "true_peak",
      outcome: final.input_tp <= op.mastering.maxTruePeakDb + 0.1 ? "pass" : "fail",
      reason: `Measured ${final.input_tp} dBTP; target ${op.mastering.maxTruePeakDb} dBTP`,
    },
  ];
  const sources = request.inputs.map((input) => ({ asset: input.asset, sha256: input.sha256 }));
  const report = join(scratch, "report.json");
  await writeFile(
    report,
    JSON.stringify({
      kind: "audio_mix",
      sources,
      tracks: op.tracks,
      ducking: op.ducking ?? null,
      mastering: op.mastering,
      measured: {
        integratedLufs: final.input_i,
        truePeakDb: final.input_tp,
        loudnessRange: final.input_lra,
        durationMs,
        sampleRate: op.mastering.sampleRate,
      },
      checks,
      limitations: [
        "Ducking follows declared trigger-track windows, not speech activity detection.",
        "No source or selected timeline was overwritten.",
      ],
    }),
  );
  const result = MediaProcessResult.parse({
    jobId: request.jobId,
    fence: request.fence,
    kind: "audio_mix",
    source: request.inputs[0]!.asset,
    sourceSha256: request.inputs[0]!.sha256,
    sources,
    outputs: [
      { name: "audio", ...(await fileIdentity(output)), mimeType: "audio/wav", durationMs },
      { name: "report", ...(await fileIdentity(report)), mimeType: "application/json" },
    ],
    checks,
    sampling: {
      mode: "audio_mix",
      range: { startMs: 0, endMs: op.durationMs },
      limitation:
        "Explicit trim/mix/fades and scheduled-window ducking; two-pass loudness mastering with independently measured output.",
    },
  });
  const persisted: string[] = [];
  try {
    for (const [name, path, mime] of [
      ["audio", output, "audio/wav"],
      ["report", report, "application/json"],
    ] as const) {
      await uploadArtifact(request.outputs[name]!.url, path, mime, signal);
      persisted.push(name);
    }
  } catch {
    throw new MediaProcessError("RESULT_PERSISTENCE_FAILED", "partial", result, persisted);
  }
  return result;
}
