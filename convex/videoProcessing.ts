import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { JobRequest } from "../packages/video/src/jobs";
import { internalAction } from "./_generated/server";
import type { ClaimedVideoJob } from "./lib/videoJobTypes";
import { processMedia } from "./lib/videoProcessing";

const m = (name: string) => makeFunctionReference<"mutation">(name);
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let job: ClaimedVideoJob | null = null;
    try {
      job = await ctx.runMutation(m("videoJobs:claim"), { jobId: args.jobId });
    } catch (error) {
      if (
        error instanceof ConvexError &&
        (error.data as { code?: string }).code === "CAPACITY_EXCEEDED" &&
        (args.admissionAttempt ?? 0) < 30
      ) {
        await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoProcessing:run"), {
          jobId: args.jobId,
          admissionAttempt: (args.admissionAttempt ?? 0) + 1,
        });
        return;
      }
      await ctx.runMutation(m("videoJobs:failAdmission"), {
        jobId: args.jobId,
        code: "ADMISSION_FAILED",
      });
      return;
    }
    if (!job) return;
    try {
      const request = JobRequest.parse(job.request);
      if (request.kind !== "media") throw new Error("Unexpected job");
      await ctx.runMutation(m("videoJobs:markDispatch"), {
        jobId: job._id,
        fence: job.fence,
      });
      const result = await processMedia(
        ctx,
        job,
        request.asset,
        request.operation,
        request.additionalAssets,
      );
      await ctx.runMutation(m("videoJobs:complete"), {
        jobId: job._id,
        fence: job.fence,
        result: { ...result, kind: "media", operation: result.kind },
      });
    } catch (error) {
      const known =
        error instanceof ConvexError ? (error.data as { code?: string; effect?: string }) : null;
      const effect = ["not_applied", "partial", "unknown"].includes(known?.effect ?? "")
        ? (known?.effect as "not_applied" | "partial" | "unknown")
        : "unknown";
      await ctx.runMutation(m("videoJobs:fail"), {
        jobId: job._id,
        fence: job.fence,
        code: known?.code ?? "MEDIA_PROCESSING_FAILED",
        outcomeUnknown: effect === "unknown",
        effect,
      });
    }
  },
});
