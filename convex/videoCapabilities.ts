import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { canonical } from "../packages/video/src/contracts";
import { CritiquePolicy, resolvedCritiquePolicy } from "../packages/video/src/jobs";
import { action, internalAction } from "./_generated/server";
import { sha256Hex } from "./lib/hash";

const policyArgs = {
  rubric: v.string(),
  criteria: v.optional(v.array(v.object({ id: v.string(), description: v.string() }))),
  requireAudioReview: v.optional(v.boolean()),
};
async function resolvePolicy(args: unknown) {
  const parsed = CritiquePolicy.safeParse(args);
  if (!parsed.success)
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: "Invalid critique policy",
      effect: "none",
    });
  const policy = resolvedCritiquePolicy(parsed.data);
  const { version, ...rubricPolicy } = policy;
  return {
    policy: rubricPolicy,
    policyVersion: version,
    rubricHash: await sha256Hex(canonical(policy)),
  };
}
export const resolveRubric = action({
  args: policyArgs,
  handler: async (ctx, args) => {
    await ctx.runQuery(q("videoMedia:principal"), {});
    return resolvePolicy(args);
  },
});
export const agentResolveRubric = internalAction({
  args: { ...policyArgs, videoPrincipalId: v.id("users") },
  handler: async (_ctx, { videoPrincipalId, ...args }) => {
    void videoPrincipalId;
    return resolvePolicy(args);
  },
});
const q = (name: string) => makeFunctionReference<"query">(name);
const voiceArgs = {
  query: v.optional(v.string()),
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
};
async function list(args: { query?: string; cursor?: string; limit?: number }) {
  if (
    (args.query?.length ?? 0) > 200 ||
    (args.cursor?.length ?? 0) > 2000 ||
    !Number.isInteger(args.limit ?? 20) ||
    (args.limit ?? 20) < 1 ||
    (args.limit ?? 20) > 100
  )
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: "Use limit1–100 and bounded query/cursor",
      effect: "none",
    });
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key)
    throw new ConvexError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "ElevenLabs is not configured on the server",
      effect: "none",
    });
  const url = new URL("https://api.elevenlabs.io/v2/voices");
  url.searchParams.set("page_size", String(args.limit ?? 20));
  if (args.query) url.searchParams.set("search", args.query);
  if (args.cursor) url.searchParams.set("next_page_token", args.cursor);
  // Documented read-only account voice discovery: https://elevenlabs.io/docs/api-reference/voices/search
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "xi-api-key": key },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ConvexError({
      code: "PROVIDER_UNAVAILABLE",
      message: "Voice discovery unavailable; no generation attempted",
      effect: "none",
    });
  }
  if (!response.ok)
    throw new ConvexError({
      code: response.status === 401 ? "PROVIDER_AUTH_FAILED" : "PROVIDER_UNAVAILABLE",
      message: "Voice discovery unavailable; inspect server configuration",
      effect: "none",
    });
  const parsed = z
    .object({
      voices: z
        .array(
          z.object({
            voice_id: z.string(),
            name: z.string(),
            description: z.string().nullish(),
            preview_url: z.string().url().nullish(),
            labels: z.record(z.string(), z.string()).optional(),
          }),
        )
        .max(100),
      has_more: z.boolean(),
      next_page_token: z.string().nullish(),
    })
    .safeParse(await response.json());
  if (!parsed.success)
    throw new ConvexError({
      code: "PROVIDER_RESPONSE_INVALID",
      effect: "none",
    });
  return {
    voices: parsed.data.voices.map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      description: voice.description ?? null,
      previewUrl: voice.preview_url?.startsWith("https:") ? voice.preview_url : null,
      labels: voice.labels ?? {},
      languageQuality: "not_human_verified",
    })),
    nextCursor: parsed.data.next_page_token ?? null,
    hasMore: parsed.data.has_more,
  };
}
export const listVoices = action({
  args: voiceArgs,
  handler: async (ctx, args) => {
    await ctx.runQuery(q("videoMedia:principal"), {});
    return list(args);
  },
});
export const agentListVoices = internalAction({
  args: { ...voiceArgs, videoPrincipalId: v.id("users") },
  handler: async (_ctx, { videoPrincipalId, ...args }) => {
    void videoPrincipalId;
    return list(args);
  },
});
const capabilities = () => ({
  image: {
    configured: !!process.env.OPENAI_API_KEY,
    model: "gpt-image-2.5-sunburst",
    recommendedPortraitSize: "1152x2048",
    formats: ["png", "jpeg", "webp"],
    maxCount: 4,
    maxAggregateOutputPixels: 8294400,
    maxReferenceAndMaskBytes: 33554432,
    maxIndividualReferenceBytes: 26214400,
    memoryLimitRecovery:
      "Reduce count or dimensions; reduce source/reference/mask bytes before retrying",
  },
  voice: {
    configured: !!process.env.ELEVENLABS_API_KEY,
    models: ["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"],
    languageQuality: "not_human_verified",
  },
  shot: {
    configured: !!(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET),
    profiles: ["higgsfield-kling-v2.5-turbo-pro"],
    accountModelAvailability: "unknown",
  },
  critique: {
    configured: !!process.env.GEMINI_API_KEY,
    models: (process.env.GEMINI_VIDEO_MODELS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    maxInlineBytes: 12 * 1024 * 1024,
  },
  render: {
    configured: !!(process.env.WORKER_URL && process.env.WORKER_TOKEN),
    compositionMode: "trusted_timeline",
  },
});
export const getCapabilities = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(q("videoMedia:principal"), {});
    return capabilities();
  },
});
export const agentGetCapabilities = internalAction({
  args: { videoPrincipalId: v.id("users") },
  handler: async () => capabilities(),
});
