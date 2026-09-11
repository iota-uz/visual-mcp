import { ConvexError, v } from "convex/values";
import { canonical, Format } from "../packages/video/src/contracts";
import { internalMutation } from "./_generated/server";
import { sha256HexBytes } from "./lib/hash";

const digest = (value: unknown) => sha256HexBytes(new TextEncoder().encode(canonical(value)));

/** Explicit one-time rewrite for projects created under the ambiguous targetDurationMs contract. */
export const renamePlanningHint = internalMutation({
  args: {
    projectId: v.id("videoProjects"),
    expectedProjectRevision: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.revisionId !== args.expectedProjectRevision)
      throw new ConvexError({ code: "REVISION_CONFLICT", effect: "not_applied" });
    const rawFormat = JSON.parse(project.format) as Record<string, unknown>;
    const oldValue = rawFormat.targetDurationMs;
    if (oldValue === undefined)
      return { changed: false, projectRevision: project.revisionId, versions: 0 };
    delete rawFormat.targetDurationMs;
    rawFormat.plannedDurationMs = oldValue;
    const format = Format.parse(rawFormat);
    const brief = JSON.parse(project.brief);
    const revisionId = await digest({ title: project.title, brief, format });
    const versions = await ctx.db
      .query("videoVersions")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", project._id))
      .take(101);
    if (versions.length > 100)
      throw new ConvexError({ code: "MIGRATION_BATCH_EXCEEDED", effect: "not_applied" });
    for (const version of versions) {
      const manifest = JSON.parse(version.manifest) as Record<string, unknown>;
      manifest.format = format;
      await ctx.db.patch(version._id, {
        manifest: canonical(manifest),
        manifestSha256: await digest(manifest),
        ...(version.projectRevision === project.revisionId ? { projectRevision: revisionId } : {}),
      });
    }
    await ctx.db.patch(project._id, {
      format: canonical(format),
      revisionId,
      updatedAt: Date.now(),
    });
    return { changed: true, projectRevision: revisionId, versions: versions.length };
  },
});
