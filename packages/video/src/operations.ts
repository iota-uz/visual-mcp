import { z } from "zod";
import { AssetRef } from "./contracts.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Output = z.object({ url: z.string().url(), method: z.literal("PUT") }).strict();
const Input = z
  .object({
    asset: AssetRef,
    url: z.string().url(),
    sha256: Hash,
    sizeBytes: z.number().int().positive().max(2_000_000_000),
    mimeType: z.string().max(100),
  })
  .strict();
export const MediaOperation = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("compare"),
      timesMs: z.array(z.number().int().nonnegative()).min(1).max(12),
      maxWidth: z.number().int().min(64).max(1920),
      labels: z.tuple([z.string().min(1).max(40), z.string().min(1).max(40)]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("audio_mix"),
      durationMs: z.number().int().min(1).max(600000),
      tracks: z
        .array(
          z
            .object({
              trackId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
              inputIndex: z.number().int().min(0).max(15),
              role: z.enum(["voice", "music", "sfx"]),
              startMs: z.number().int().nonnegative(),
              trimStartMs: z.number().int().nonnegative(),
              trimEndMs: z.number().int().positive(),
              gainDb: z.number().min(-60).max(12),
              fadeInMs: z.number().int().nonnegative().default(0),
              fadeOutMs: z.number().int().nonnegative().default(0),
            })
            .strict(),
        )
        .min(1)
        .max(32),
      ducking: z
        .object({
          mode: z.literal("scheduled_voice_windows"),
          triggerTrackIds: z.array(z.string()).min(1).max(32),
          targetTrackIds: z.array(z.string()).min(1).max(32),
          reductionDb: z.number().min(0).max(30),
          attackMs: z.number().int().min(1).max(5000),
          releaseMs: z.number().int().min(1).max(10000),
        })
        .strict()
        .optional(),
      mastering: z
        .object({
          sampleRate: z.union([z.literal(44100), z.literal(48000)]),
          targetLufs: z.number().min(-24).max(-10),
          maxTruePeakDb: z.number().min(-9).max(-0.1),
          loudnessRange: z.number().min(1).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("frames"),
      timesMs: z.array(z.number().int().nonnegative()).min(1).max(24),
      maxWidth: z.number().int().min(64).max(1920),
      columns: z.number().int().min(1).max(6),
    })
    .strict(),
  z
    .object({
      kind: z.literal("proxy"),
      maxWidth: z.number().int().min(64).max(1080),
      fps: z.number().min(0.1).max(30),
      maxOutputBytes: z
        .number()
        .int()
        .min(65536)
        .max(12 * 1024 * 1024),
    })
    .strict(),
  z
    .object({
      kind: z.literal("qa"),
      requiredAudio: z.boolean().default(false),
      expectedWidth: z.number().int().positive().optional(),
      expectedHeight: z.number().int().positive().optional(),
      expectedDurationMs: z.number().int().positive().optional(),
      maxPeakDb: z.number().min(-20).max(0).default(-0.1),
      silenceThresholdDb: z.number().min(-80).max(-10).default(-50),
      maxSilenceMs: z.number().int().min(100).max(30000).default(2000),
      minLufs: z.number().min(-70).max(-5).default(-24),
      maxLufs: z.number().min(-70).max(-5).default(-12),
      maxBlackMs: z.number().int().nonnegative().max(600000).optional(),
      maxFreezeMs: z.number().int().nonnegative().max(600000).optional(),
    })
    .strict(),
]);
export const MediaProcessRequest = z
  .object({
    jobId: z.string().min(1).max(200),
    fence: z.number().int().positive(),
    operation: MediaOperation,
    inputs: z.array(Input).min(1).max(16),
    outputs: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), Output),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation.kind === "qa" && value.operation.minLufs > value.operation.maxLufs)
      ctx.addIssue({
        code: "custom",
        path: ["operation", "minLufs"],
        message: "Minimum loudness must not exceed maximum loudness",
      });
    if (value.inputs.reduce((sum, input) => sum + input.sizeBytes, 0) > 4_000_000_000)
      ctx.addIssue({ code: "custom", path: ["inputs"], message: "Total inputs exceed 4GB" });
    if (
      value.operation.kind !== "audio_mix" &&
      value.inputs.length !== (value.operation.kind === "compare" ? 2 : 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: "Compare requires exactly two inputs; other video operations require one",
      });
    if (value.operation.kind === "audio_mix") {
      const op = value.operation;
      const ids = new Set(op.tracks.map((track) => track.trackId));
      if (ids.size !== op.tracks.length)
        ctx.addIssue({
          code: "custom",
          path: ["operation", "tracks"],
          message: "Track IDs must be unique",
        });
      for (const [index, track] of op.tracks.entries()) {
        const duration = track.trimEndMs - track.trimStartMs;
        if (
          track.inputIndex >= value.inputs.length ||
          duration <= 0 ||
          track.startMs + duration > op.durationMs ||
          track.fadeInMs > duration ||
          track.fadeOutMs > duration
        )
          ctx.addIssue({
            code: "custom",
            path: ["operation", "tracks", index],
            message: "Track input, trim, position or fades are outside the declared duration",
          });
      }
      if (
        op.ducking &&
        ([...op.ducking.triggerTrackIds, ...op.ducking.targetTrackIds].some((id) => !ids.has(id)) ||
          op.ducking.triggerTrackIds.some((id) => op.ducking!.targetTrackIds.includes(id)))
      )
        ctx.addIssue({
          code: "custom",
          path: ["operation", "ducking"],
          message: "Ducking IDs must exist; trigger and target tracks must be separate",
        });
    }
    const required =
      value.operation.kind === "compare"
        ? [
            "contactsheet",
            ...value.operation.timesMs.flatMap((_, i) => [`frame-a-${i}`, `frame-b-${i}`]),
          ]
        : value.operation.kind === "frames"
          ? ["contactsheet", ...value.operation.timesMs.map((_, i) => `frame-${i}`)]
          : value.operation.kind === "audio_mix"
            ? ["audio", "report"]
            : [value.operation.kind === "proxy" ? "proxy" : "report"];
    if (
      Object.keys(value.outputs).length !== required.length ||
      required.some((name) => !value.outputs[name])
    )
      ctx.addIssue({
        code: "custom",
        path: ["outputs"],
        message: `Provide exact signed outputs: ${required.join(", ")}`,
      });
  });
const Check = z
  .object({
    name: z.string(),
    outcome: z.enum(["pass", "fail", "not_evaluated"]),
    reason: z.string().optional(),
  })
  .strict();
export const MediaProcessResult = z
  .object({
    jobId: z.string(),
    fence: z.number().int().positive(),
    kind: z.enum(["frames", "compare", "proxy", "qa", "audio_mix"]),
    source: AssetRef,
    sourceSha256: Hash,
    sources: z
      .array(z.object({ asset: AssetRef, sha256: Hash }).strict())
      .min(1)
      .max(16),
    outputs: z.array(
      z
        .object({
          name: z.string(),
          sourceIndex: z.number().int().min(0).max(1).optional(),
          sha256: Hash,
          sizeBytes: z.number().int().positive(),
          mimeType: z.string(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          durationMs: z.number().positive().optional(),
          requestedMs: z.number().int().nonnegative().optional(),
          actualMs: z.number().nonnegative().optional(),
        })
        .strict(),
    ),
    checks: z.array(Check),
    sampling: z
      .object({
        mode: z.enum(["exact_requested_frames", "proxy", "full_decode", "audio_mix"]),
        fps: z.number().positive().optional(),
        range: z.object({ startMs: z.number(), endMs: z.number() }).strict(),
        limitation: z.string(),
      })
      .strict(),
  })
  .strict();
export const MediaProcessFailure = z
  .object({
    error: z
      .object({
        code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
        message: z.string().min(1),
        effect: z.enum(["not_applied", "partial", "unknown"]),
        result: MediaProcessResult.optional(),
        persisted: z.array(z.string().min(1).max(200)).max(64).optional(),
      })
      .strict(),
  })
  .strict();
export type MediaProcessRequest = z.infer<typeof MediaProcessRequest>;
export type MediaProcessResult = z.infer<typeof MediaProcessResult>;
