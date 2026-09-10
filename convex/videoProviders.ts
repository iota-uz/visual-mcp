import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
export const editTarget = internalQuery({
  args: {
    jobId: v.id("videoJobs"),
    assetId: v.id("assets"),
    expectedRevisionId: v.id("assetVersions"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId),
      asset = await ctx.db.get(args.assetId),
      version = await ctx.db.get(args.expectedRevisionId);
    if (
      !job ||
      !asset ||
      asset.archivedAt !== undefined ||
      !version ||
      version.assetId !== asset._id ||
      !(
        asset.workspaceId === job.workspaceId ||
        (asset.scope === "personal" && asset.ownerUserId === job.principalId)
      )
    )
      throw new ConvexError({
        code: "NOT_FOUND_OR_FORBIDDEN",
        effect: "not_applied",
      });
    return asset;
  },
});
export const source = internalQuery({
  args: {
    jobId: v.id("videoJobs"),
    assetId: v.id("assets"),
    revisionId: v.id("assetVersions"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId),
      asset = await ctx.db.get(args.assetId),
      revision = await ctx.db.get(args.revisionId);
    if (
      !job ||
      !asset ||
      asset.archivedAt !== undefined ||
      !revision ||
      revision.assetId !== asset._id ||
      !(
        asset.workspaceId === job.workspaceId ||
        (asset.scope === "personal" && asset.ownerUserId === job.principalId)
      )
    )
      throw new Error("Source unavailable");
    return revision;
  },
});

/** Large provider buffers stay in the trusted Node runtime; preserve the scheduled API. */
export const run = internalAction({
  args: { jobId: v.id("videoJobs"), admissionAttempt: v.optional(v.number()) },
  handler: (ctx, args) =>
    ctx.runAction(makeFunctionReference<"action">("videoProviderRunner:run"), args),
});
