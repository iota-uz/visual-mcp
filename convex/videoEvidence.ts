import { v } from "convex/values";
import { canonical } from "../packages/video/src/contracts";
import { internalMutation } from "./_generated/server";
import { completeVideoJob } from "./videoJobs";
import { recordVideoEvidence } from "./videoWorkflow";
/** Completion and immutable evidence publication either both commit or both roll back. */
export const completeWithEvidence = internalMutation({
  args: {
    jobId: v.id("videoJobs"),
    fence: v.number(),
    result: v.any(),
    evidence: v.any(),
  },
  handler: async (ctx, args) => {
    await completeVideoJob(ctx, {
      jobId: args.jobId,
      fence: args.fence,
      result: args.result,
    });
    const { evidenceId } = await recordVideoEvidence(ctx, {
      evidence: args.evidence,
    });
    await ctx.db.patch(args.jobId, {
      result: canonical({ ...args.result, evidenceId }),
    });
    return { jobId: args.jobId, evidenceId };
  },
});
