import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

export { completeCritique } from "./lib/videoCritiqueCompletion";
/** Inline video/base64 lives in the trusted Node runtime, never the media worker. */
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: (ctx, args) =>
    ctx.runAction(makeFunctionReference<"action">("videoCritiqueRunner:run"), args),
});
