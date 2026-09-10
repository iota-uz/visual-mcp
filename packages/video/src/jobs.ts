import { z } from "zod";
import { AssetRef, Language } from "./contracts.js";
import { AnalyticsImport, OfflineEvaluation } from "./learning.js";
import { MediaOperation } from "./operations.js";
export const JobState = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "succeeded",
  "failed",
  "outcome_unknown",
]);
const Paid = { allowPaid: z.literal(true) };
export const CritiquePolicy = z
  .object({
    rubric: z.string().min(1).max(16000),
    criteria: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            description: z.string().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(30)
      .optional(),
    requireAudioReview: z.boolean().optional(),
  })
  .strict();
export function resolvedCritiquePolicy(input: z.infer<typeof CritiquePolicy>) {
  return {
    version: "video-critique-policy-v1",
    rubric: input.rubric,
    criteria: input.criteria ?? [{ id: "rubric", description: input.rubric }],
    requireAudioReview: input.requireAudioReview ?? false,
  };
}
export const JobRequest = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("media"),
      asset: AssetRef,
      additionalAssets: z.array(AssetRef).max(15).optional(),
      operation: MediaOperation,
    })
    .strict(),
  z
    .object({
      kind: z.literal("memory_validation"),
      memoryId: z.string().min(1),
      expectedRevision: z.string().min(1),
      evidenceIds: z.array(z.string().min(1)).max(100),
      evalIds: z.array(z.string().min(1)).max(100),
      policyHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ kind: z.literal("offline_eval"), evaluation: OfflineEvaluation }).strict(),
  z.object({ kind: z.literal("analytics_import"), import: AnalyticsImport }).strict(),
  z
    .object({
      kind: z.literal("image"),
      ...Paid,
      prompt: z.string().min(1).max(32000),
      model: z.literal("gpt-image-2.5-sunburst"),
      size: z
        .string()
        .regex(/^\d{3,4}x\d{3,4}$/)
        .refine((value) => {
          const [w, h] = value.split("x").map(Number) as [number, number];
          return (
            w % 16 === 0 &&
            h % 16 === 0 &&
            Math.max(w, h) <= 3840 &&
            Math.max(w / h, h / w) <= 3 &&
            w * h >= 655360 &&
            w * h <= 8294400
          );
        }, "Use multiples of 16, max edge 3840, aspect <=3, 655360–8294400 pixels; 1152x2048 is native 9:16"),
      quality: z.enum(["low", "medium", "high", "xhigh", "max", "auto"]),
      count: z.number().int().min(1).max(4).default(1),
      outputFormat: z.enum(["png", "jpeg", "webp"]).default("png"),
      background: z.enum(["opaque", "transparent", "auto"]).default("auto"),
      referenceInstructions: z
        .array(
          z
            .object({
              index: z.number().int().nonnegative().max(15),
              role: z.enum(["style", "character", "composition", "product", "continuity"]),
              instruction: z.string().max(4000),
            })
            .strict(),
        )
        .max(16)
        .default([]),
      references: z.array(AssetRef).max(16).default([]),
      source: AssetRef.optional(),
      mask: AssetRef.optional(),
      editTarget: z
        .object({
          assetId: z.string().min(1),
          expectedRevisionId: z.string().min(1),
        })
        .strict()
        .optional(),
    })
    .strict()
    .superRefine((request, ctx) => {
      const [width, height] = request.size.split("x").map(Number);
      if (width! * height! * request.count > 8294400)
        ctx.addIssue({
          code: "custom",
          path: ["count"],
          message:
            "This server supports at most 8,294,400 aggregate output pixels per image request; reduce count or dimensions",
        });
    }),
  z
    .object({
      kind: z.literal("voice"),
      ...Paid,
      text: z.string().min(1).max(5000),
      language: Language,
      voiceId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
      modelId: z.enum(["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"]),
      alignment: z.enum(["required", "best_effort"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("shot"),
      ...Paid,
      draftId: z.string(),
      scriptRevision: z.string(),
      sceneId: z.string(),
      shotId: z.string(),
      startImage: AssetRef,
      profileId: z.string().min(1).max(200),
      prompt: z.string().min(1).max(16000),
      durationMs: z.number().int().positive().max(30000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("critique"),
      ...Paid,
      asset: AssetRef,
      modelId: z.string().regex(/^gemini-[a-zA-Z0-9.-]+$/),
      rubric: z.string().min(1).max(16000),
      criteria: z
        .array(
          z
            .object({
              id: z.string().min(1).max(100),
              description: z.string().min(1).max(4000),
            })
            .strict(),
        )
        .min(1)
        .max(30)
        .optional(),
      requireAudioReview: z.boolean().optional(),
      brief: z.string().max(16000),
      samplingFps: z.number().min(0.1).max(4),
    })
    .strict(),
  z
    .object({
      kind: z.literal("render"),
      versionId: z.string().min(1),
      mode: z.enum(["draft", "final", "analysis_proxy"]),
      rubricHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      rubricPolicy: CritiquePolicy.optional(),
      range: z
        .object({
          startFrame: z.number().int().nonnegative(),
          endFrame: z.number().int().positive(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("execute"),
      code: z.string().min(1).max(65536),
      inputs: z.record(z.string(), z.unknown()).optional(),
      toolAccess: z.enum(["read_only", "read_write"]),
      timeoutMs: z.number().int().min(1).max(60000),
      memoryLimitMb: z.number().int().min(16).max(1024),
      maxToolCalls: z.number().int().min(1).max(100),
      maxConcurrency: z.number().int().min(1).max(4),
      maxOutputBytes: z.number().int().min(1).max(131072),
      registryRevision: z.string().min(1).max(100),
    })
    .strict(),
]);
export type JobRequest = z.infer<typeof JobRequest>;
export type JobState = z.infer<typeof JobState>;
