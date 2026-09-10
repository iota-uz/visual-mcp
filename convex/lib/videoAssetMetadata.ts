import { v } from "convex/values";
import { z } from "zod";
export const MediaMetadataValidator = v.object({
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  frameCount: v.optional(v.number()),
  fps: v.optional(v.object({ numerator: v.number(), denominator: v.number() })),
  hasAudio: v.optional(v.boolean()),
  hasAlpha: v.optional(v.boolean()),
  alphaMin: v.optional(v.number()),
  alphaMax: v.optional(v.number()),
  audioStreams: v.optional(
    v.array(
      v.object({
        codec: v.union(v.string(), v.null()),
        channels: v.union(v.number(), v.null()),
        sampleRateHz: v.union(v.number(), v.null()),
      }),
    ),
  ),
});
const Metadata = z
  .object({
    width: z.number().int().positive().max(16384).optional(),
    height: z.number().int().positive().max(16384).optional(),
    durationMs: z.number().positive().max(86400000).optional(),
    frameCount: z.number().int().positive().optional(),
    fps: z
      .object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() })
      .optional(),
    hasAudio: z.boolean().optional(),
    hasAlpha: z.boolean().optional(),
    alphaMin: z.number().min(0).max(255).optional(),
    alphaMax: z.number().min(0).max(255).optional(),
    audioStreams: z
      .array(
        z.object({
          codec: z.string().max(100).nullable(),
          channels: z.number().int().positive().max(64).nullable(),
          sampleRateHz: z.number().positive().max(384000).nullable(),
        }),
      )
      .max(16)
      .optional(),
  })
  .strict();
/** Normalize only verified probe fields; never take source-declared dimensions as measured. */
export function verifiedMediaMetadata(value: unknown) {
  const data = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "width",
    "height",
    "durationMs",
    "frameCount",
    "hasAudio",
    "hasAlpha",
    "alphaMin",
    "alphaMax",
    "audioStreams",
  ])
    if (data[key] !== undefined && data[key] !== null) out[key] = data[key];
  if (typeof data.fps === "string" && /^\d+\/\d+$/.test(data.fps)) {
    const [numerator, denominator] = data.fps.split("/").map(Number);
    if (numerator && denominator) out.fps = { numerator, denominator };
  } else if (data.fps && typeof data.fps === "object") out.fps = data.fps;
  return Metadata.parse(out);
}
