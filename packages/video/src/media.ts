import { z } from "zod";
import { AssetRef, Format, Language, Script, Timeline } from "./contracts.js";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const RenderEngine = z
  .object({
    remotionVersion: z.string().min(1).max(100),
    ffmpegVersion: z.string().min(1).max(200),
    workerBuildSha: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/)
      .nullable(),
    fonts: z.array(z.object({ family: z.string().min(1).max(100), sha256: Hash }).strict()).max(20),
  })
  .strict();
const Target = z.object({ url: z.string().url(), method: z.literal("PUT") }).strict();
export const VideoRenderRequest = z
  .object({
    jobId: z.string().min(1),
    fence: z.number().int().positive(),
    version: z
      .object({
        projectId: z.string(),
        language: Language,
        versionId: z.string(),
      })
      .strict(),
    format: Format,
    script: Script,
    timeline: Timeline,
    inputs: z
      .array(
        z
          .object({
            asset: AssetRef,
            url: z.string().url(),
            sha256: Hash,
            mimeType: z.string(),
            sizeBytes: z.number().int().positive().max(2000000000),
          })
          .strict(),
      )
      .max(100),
    outputs: z.object({ video: Target, poster: Target, captions: Target }).strict(),
    range: z
      .object({
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
const Artifact = z.object({
  sha256: Hash,
  sizeBytes: z.number().int().positive().max(2000000000),
  mimeType: z.string(),
});
export const VideoRenderResult = z
  .object({
    engine: RenderEngine.optional(),
    jobId: z.string(),
    fence: z.number().int().positive(),
    video: Artifact.extend({
      mimeType: z.literal("video/mp4"),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      durationMs: z.number().int().positive(),
      fps: Format.shape.fps,
    }),
    poster: Artifact.extend({
      mimeType: z.literal("image/png"),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    captions: Artifact.extend({ mimeType: z.literal("text/vtt") }),
    partial: z.boolean(),
    checks: z
      .array(
        z
          .object({
            name: z.string(),
            outcome: z.enum(["pass", "fail", "not_evaluated"]),
            reason: z.string().optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const VideoRenderFailure = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        effect: z.enum(["not_applied", "partial", "unknown"]),
        result: VideoRenderResult.optional(),
        persisted: z
          .array(z.enum(["video", "poster", "captions"]))
          .max(3)
          .optional(),
      })
      .strict(),
  })
  .strict();
export type VideoRenderRequest = z.infer<typeof VideoRenderRequest>;
export type VideoRenderResult = z.infer<typeof VideoRenderResult>;
export type VideoRenderFailure = z.infer<typeof VideoRenderFailure>;
