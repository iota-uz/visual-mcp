import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Durable admission watchdog, not an execution scheduler or a replay engine. */
export const expireQueued = internalMutation({
  args: { jobId: v.id("videoJobs"), createdAt: v.number() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.kind !== "execute" ||
      job.state !== "queued" ||
      job.createdAt !== args.createdAt ||
      job.fence !== 0
    )
      return { expired: false };
    if (Date.now() < job.createdAt + 120000) return { expired: false };
    const effect = await ctx.db
      .query("videoJobEffects")
      .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", job._id))
      .first();
    // A queued job should never have a journal entry. Preserve uncertainty if
    // corrupted/legacy state contradicts that invariant; never call it no-effect.
    await ctx.db.patch(job._id, {
      state: effect ? "outcome_unknown" : "failed",
      stage: "admission_expired",
      errorCode: effect ? "EXECUTION_STATE_INCONSISTENT" : "EXECUTE_NOT_STARTED",
      errorEffect: effect ? "unknown" : "not_applied",
      updatedAt: Date.now(),
    });
    return { expired: true, effect: effect ? "unknown" : "not_applied" };
  },
});
