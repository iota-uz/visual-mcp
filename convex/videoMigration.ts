import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { bounded, canonical } from "../packages/video/src/contracts";
import { internalAction, internalMutation, query } from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256HexBytes } from "./lib/hash";
import { getObject } from "./lib/objectStore";
import { readBoundedBody } from "./lib/videoBytes";
import {
  ArchiveRecord,
  AssetMapping,
  convertLegacyScenario,
  migrationWarning,
} from "./lib/videoMigration";

const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
const assetRef = v.object({ assetId: v.id("assets"), revisionId: v.id("assetVersions") });
const identityArgs = {
  workspaceId: v.id("workspaces"),
  principalId: v.id("users"),
  sourceBackupSha256: v.string(),
  sourceRunId: v.string(),
  archiveAsset: assetRef,
  archiveSha256: v.string(),
  assetMap: v.any(),
};
function fail(message: string): never {
  throw new ConvexError({ code: "MIGRATION_INVALID", message, effect: "not_applied" });
}
export const begin = internalMutation({
  args: {
    ...identityArgs,
    records: v.array(v.object({ kind: v.string(), id: v.string(), data: v.string() })),
  },
  handler: async (ctx, args) => {
    if (
      !/^[a-f0-9]{64}$/.test(args.sourceBackupSha256) ||
      !(await ctx.db.get(args.principalId)) ||
      !(await ctx.db.get(args.workspaceId))
    )
      fail("Source identity unavailable");
    bounded(args, 700000);
    const mappings = z.array(AssetMapping).max(1000).parse(args.assetMap),
      records = z.array(ArchiveRecord).max(1000).parse(args.records);
    const existing = await ctx.db
      .query("videoMigrations")
      .withIndex("by_workspaceId_and_sourceBackupSha256", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("sourceBackupSha256", args.sourceBackupSha256),
      )
      .unique();
    if (existing) {
      if (
        existing.principalId !== args.principalId ||
        existing.archiveSha256 !== args.archiveSha256 ||
        existing.sourceRunId !== args.sourceRunId ||
        existing.assetMap !== canonical(mappings)
      )
        fail("Source backup already imported with different content or principal");
      return existing._id;
    }
    for (const entry of [...mappings, { asset: args.archiveAsset, sha256: args.archiveSha256 }]) {
      const asset = await ctx.db.get("assets", entry.asset.assetId as never),
        revision = await ctx.db.get("assetVersions", entry.asset.revisionId as never);
      if (
        !asset ||
        asset.archivedAt !== undefined ||
        asset.workspaceId !== args.workspaceId ||
        !revision ||
        revision.assetId !== asset._id ||
        revision.contentHash !== entry.sha256
      )
        fail("Archived asset reference/hash mismatch");
      if (
        "sizeBytes" in entry &&
        (revision.size !== entry.sizeBytes || revision.mimeType !== entry.mimeType)
      )
        fail("Archived asset metadata mismatch");
    }
    const seen = new Set<string>();
    for (const record of records) {
      const key = `${record.kind}:${record.id}`;
      if (seen.has(key)) fail("Duplicate historical record");
      seen.add(key);
      const parsed = JSON.parse(record.data);
      if (record.kind === "version") {
        const { id, hash, createdAt, ...hashInput } = parsed;
        if (
          id !== record.id ||
          (await sha256HexBytes(new TextEncoder().encode(canonical(hashInput)))) !== hash
        )
          fail("Original version hash mismatch");
      }
    }
    const migrationId = await ctx.db.insert("videoMigrations", {
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      sourceBackupSha256: args.sourceBackupSha256,
      sourceRunId: args.sourceRunId,
      archiveAsset: args.archiveAsset,
      archiveSha256: args.archiveSha256,
      assetMap: canonical(mappings),
      state: "importing",
      createdAt: Date.now(),
      warning: migrationWarning,
    });
    for (const record of records)
      await ctx.db.insert("videoLegacyRecords", {
        migrationId,
        kind: record.kind,
        sourceId: record.id,
        data: record.data,
      });
    return migrationId;
  },
});
export const finish = internalMutation({
  args: {
    migrationId: v.id("videoMigrations"),
    projectId: v.id("videoProjects"),
    nativeVersions: v.any(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.migrationId),
      project = await ctx.db.get(args.projectId);
    if (!row || project?.workspaceId !== row.workspaceId) fail("Migration project unavailable");
    const versions = z
      .array(
        z.object({
          language: z.enum(["ru", "uz"]),
          sourceVersionId: z.string(),
          versionId: z.string(),
          manifestSha256: z.string(),
        }),
      )
      .max(2)
      .parse(args.nativeVersions);
    for (const item of versions) {
      const version = await ctx.db.get("videoVersions", item.versionId as never);
      if (
        !version ||
        version.projectId !== args.projectId ||
        version.language !== item.language ||
        version.manifestSha256 !== item.manifestSha256
      )
        fail("Native version mismatch");
    }
    if (
      row.state === "complete" &&
      (row.projectId !== args.projectId || row.nativeVersions !== canonical(versions))
    )
      fail("Migration already completed differently");
    await ctx.db.patch(args.migrationId, {
      projectId: args.projectId,
      nativeVersions: canonical(versions),
      state: "complete",
    });
    return { migrationId: row._id, projectId: args.projectId, versions, warning: row.warning };
  },
});
/** Admin-only one-shot import. Never exposed through browser/MCP or scheduled as production work. */
export const migrate = internalAction({
  args: identityArgs,
  handler: async (ctx, args) => {
    const archive = await ctx.runQuery(q("videoMedia:assetRow"), {
      workspaceId: args.workspaceId,
      principalId: args.principalId,
      asset: args.archiveAsset,
    });
    if (archive.sha256 !== args.archiveSha256 || archive.mimeType !== "application/json")
      fail("Archive identity mismatch");
    const response = await getObject(archive.objectKey);
    if (!response.ok) fail("Archive bytes unavailable");
    const bytes = await readBoundedBody(response, 700000);
    if ((await sha256HexBytes(bytes)) !== args.archiveSha256) fail("Archive bytes hash mismatch");
    const payload = z
      .object({ sourceBackupSha256: z.string(), records: z.array(ArchiveRecord) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (payload.sourceBackupSha256 !== args.sourceBackupSha256)
      fail("Backup hash differs from archive");
    const mappings = z.array(AssetMapping).parse(args.assetMap),
      records = payload.records;
    const run = JSON.parse(
      records.find((r) => r.kind === "run" && r.id === args.sourceRunId)?.data ?? "null",
    );
    if (!run) fail("Source run not present");
    const languages = z
      .array(z.enum(["ru", "uz"]))
      .min(1)
      .max(2)
      .parse(run.languages);
    const lanes = languages.map((language) => {
      const sourceVersionId = z.string().parse(run.latest?.[language]);
      const version = JSON.parse(
        records.find((r) => r.kind === "version" && r.id === sourceVersionId)?.data ?? "null",
      );
      if (!version || version.runId !== run.id || version.language !== language)
        fail("Latest source version unavailable");
      return {
        language,
        sourceVersionId,
        ...convertLegacyScenario(version.manifest.scenario, mappings),
      };
    });
    if (lanes.some((l) => canonical(l.format) !== canonical(lanes[0]!.format)))
      fail("Language formats differ; explicit mapping required");
    const migrationId = await ctx.runMutation(m("videoMigration:begin"), { ...args, records });
    const prefix = `reels:${args.sourceBackupSha256}`;
    const project = await ctx.runMutation(m("video:agentCreateProject"), {
      workspaceId: args.workspaceId,
      videoPrincipalId: args.principalId,
      idempotencyKey: `${prefix}:project`,
      title: `${String(run.brand ?? "Reels")} — imported fixture`,
      languages,
      brief: { topic: String(run.prompt), direction: migrationWarning },
      format: lanes[0]!.format,
    });
    const nativeVersions = [];
    for (const lane of lanes) {
      const draft = project.drafts.find((d: { language: string }) => d.language === lane.language);
      if (!draft) fail("Native language missing");
      const script = await ctx.runMutation(m("video:agentPatchScript"), {
        videoPrincipalId: args.principalId,
        draftId: draft.draftId,
        expectedRevision: draft.scriptRevision,
        idempotencyKey: `${prefix}:${lane.language}:script`,
        operations: Object.entries(lane.script)
          .filter(([key]) => key !== "language" && key !== "writingSystem")
          .map(([key, value]) => ({ op: "replace", path: `/${key}`, value })),
      });
      const timeline = await ctx.runMutation(m("video:agentPatchTimeline"), {
        videoPrincipalId: args.principalId,
        draftId: draft.draftId,
        expectedRevision: draft.timelineRevision,
        idempotencyKey: `${prefix}:${lane.language}:timeline`,
        operations: Object.entries(lane.timeline).map(([key, value]) => ({
          op: "replace",
          path: `/${key}`,
          value,
        })),
      });
      const checkpoint = await ctx.runMutation(m("video:agentCheckpoint"), {
        videoPrincipalId: args.principalId,
        draftId: draft.draftId,
        expectedProjectRevision: project.revisionId,
        expectedScriptRevision: script.revisionId,
        expectedTimelineRevision: timeline.revisionId,
        idempotencyKey: `${prefix}:${lane.language}:checkpoint`,
        label: "Imported editable approximation — needs new render",
        note: `Original version ${lane.sourceVersionId}. ${migrationWarning}`,
      });
      nativeVersions.push({
        language: lane.language,
        sourceVersionId: lane.sourceVersionId,
        versionId: checkpoint.version.versionId,
        manifestSha256: checkpoint.manifestSha256 ?? checkpoint.version.manifestSha256,
      });
    }
    return ctx.runMutation(m("videoMigration:finish"), {
      migrationId,
      projectId: project.projectId,
      nativeVersions,
    });
  },
});
export const getArchive = query({
  args: { projectId: v.id("videoProjects") },
  handler: async (ctx, args) => {
    await requireUserId(ctx, await requireIotaIdentity(ctx));
    const row = await ctx.db
      .query("videoMigrations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!row) return null;
    return {
      ...row,
      assetMap: JSON.parse(row.assetMap),
      nativeVersions: row.nativeVersions ? JSON.parse(row.nativeVersions) : [],
    };
  },
});
export const listRecords = query({
  args: {
    migrationId: v.id("videoMigrations"),
    kind: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireUserId(ctx, await requireIotaIdentity(ctx));
    if (!(await ctx.db.get(args.migrationId))) fail("Archive unavailable");
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      fail("Page size must be 1–100");
    return ctx.db
      .query("videoLegacyRecords")
      .withIndex("by_migrationId_and_kind", (q) =>
        q.eq("migrationId", args.migrationId).eq("kind", args.kind),
      )
      .paginate(args.paginationOpts);
  },
});
