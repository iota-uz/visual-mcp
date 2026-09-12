import { makeFunctionReference } from "convex/server";
import type { ObjectType } from "convex/values";
import { ConvexError, v } from "convex/values";
import { canonical } from "../packages/video/src/contracts";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { formatAssetRef } from "./lib/assetRef";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256Hex } from "./lib/hash";
import { headObject, presignObject, presignSizedUpload } from "./lib/objectStore";
import { getWorkerConfig } from "./lib/worker";
export const assetRow = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    principalId: v.id("users"),
    asset: v.object({
      assetId: v.id("assets"),
      revisionId: v.id("assetVersions"),
    }),
  },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.asset.assetId),
      revision = await ctx.db.get(args.asset.revisionId),
      workspace = await ctx.db.get(args.workspaceId);
    if (
      !workspace ||
      !asset ||
      asset.archivedAt !== undefined ||
      !revision ||
      revision.assetId !== asset._id ||
      !(asset.workspaceId === args.workspaceId || asset.scope === "shared")
    )
      throw new ConvexError({
        code: "NOT_FOUND_OR_FORBIDDEN",
        message: "Asset or exact revision unavailable in this workspace",
        effect: "none",
      });
    return {
      objectKey: revision.objectKey,
      asset: args.asset,
      name: asset.name,
      mimeType: revision.mimeType,
      mediaMetadata: revision.mediaMetadata ?? null,
      sha256: revision.contentHash,
      sizeBytes: revision.size,
      ref: formatAssetRef({
        scope: asset.scope === "workspace" ? "workspace" : "shared",
        workspaceSlug: asset.scope === "workspace" ? workspace.slug : undefined,
        slug: asset.slug,
        revision: revision.revision,
      }),
    };
  },
});
export const previewAsset = action({
  args: {
    workspaceId: v.id("workspaces"),
    asset: v.object({
      assetId: v.id("assets"),
      revisionId: v.id("assetVersions"),
    }),
  },
  handler: async (ctx, args) => {
    const principalId = await ctx.runQuery(q("videoMedia:principal"), {});
    const { objectKey, ...data } = await ctx.runQuery(q("videoMedia:assetRow"), {
      ...args,
      principalId,
    });
    return { ...data, url: await presignObject(objectKey, "GET", 900) };
  },
});
export const agentPreviewAsset = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    asset: v.object({ assetId: v.id("assets"), revisionId: v.id("assetVersions") }),
    videoPrincipalId: v.id("users"),
  },
  handler: async (ctx, { videoPrincipalId, ...args }) => {
    const { objectKey, ...data } = await ctx.runQuery(q("videoMedia:assetRow"), {
      ...args,
      principalId: videoPrincipalId,
    });
    return { ...data, url: await presignObject(objectKey, "GET", 900) };
  },
});
const m = (name: string) => makeFunctionReference<"mutation">(name),
  q = (name: string) => makeFunctionReference<"query">(name);
export const principal = internalQuery({
  args: {},
  handler: async (ctx) => requireUserId(ctx, await requireIotaIdentity(ctx)),
});
export const agentGetUpload = internalQuery({
  args: {
    uploadId: v.id("videoMediaUploads"),
    videoPrincipalId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.principalId !== args.videoPrincipalId)
      throw new ConvexError({ code: "NOT_FOUND_OR_FORBIDDEN", effect: "none" });
    return {
      uploadId: row._id,
      workspaceId: row.workspaceId,
      state: row.state,
      expiresAt: row.expiresAt,
      asset: row.result ? JSON.parse(row.result) : null,
      sha256: row.sha256,
      sizeBytes: row.sizeBytes,
      mimeType: row.mimeType,
    };
  },
});
const requestArgs = {
  workspaceId: v.id("workspaces"),
  idempotencyKey: v.string(),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  sha256: v.string(),
  source: v.union(v.literal("upload"), v.literal("codex-imagegen")),
};
const allowed = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "application/json",
  "text/vtt",
  "font/ttf",
];
export const reserve = internalMutation({
  args: { ...requestArgs, principalId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.principalId)) || !(await ctx.db.get(args.workspaceId)))
      throw new ConvexError({
        code: "NOT_FOUND_OR_FORBIDDEN",
        effect: "not_applied",
      });
    if (
      !Number.isSafeInteger(args.sizeBytes) ||
      args.sizeBytes < 1 ||
      args.sizeBytes > 2000000000 ||
      !/^[a-f0-9]{64}$/.test(args.sha256) ||
      !allowed.includes(args.mimeType) ||
      !args.filename ||
      args.filename.length > 255 ||
      !args.idempotencyKey ||
      args.idempotencyKey.length > 200
    )
      throw new ConvexError({
        code: "VALIDATION_ERROR",
        message: "Supply exact size up to 2GB, SHA256 and supported media MIME",
        effect: "not_applied",
      });
    const hash = await sha256Hex(canonical(args));
    const existing = await ctx.db
      .query("videoMediaUploads")
      .withIndex("by_principal_workspace_key", (i) =>
        i
          .eq("principalId", args.principalId)
          .eq("workspaceId", args.workspaceId)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      if (existing.inputHash !== hash)
        throw new ConvexError({
          code: "IDEMPOTENCY_CONFLICT",
          effect: "not_applied",
        });
      if (existing.state === "reserved") {
        const expiresAt = Date.now() + 900000;
        await ctx.db.patch(existing._id, { expiresAt });
        return { ...existing, expiresAt };
      }
      return existing;
    }
    const id = await ctx.db.insert("videoMediaUploads", {
      ...args,
      inputHash: hash,
      objectKey: `media-uploads/${args.workspaceId}/${crypto.randomUUID()}`,
      state: "reserved",
      expiresAt: Date.now() + 900000,
    });
    return (await ctx.db.get(id))!;
  },
});
async function prepareForPrincipal(
  ctx: ActionCtx,
  args: ObjectType<typeof requestArgs>,
  principalId: Id<"users">,
) {
  const row = await ctx.runMutation(m("videoMedia:reserve"), {
    ...args,
    principalId,
  });
  return {
    uploadId: row._id,
    state: row.state,
    expiresAt: row.expiresAt,
    ...(row.state === "ready"
      ? { asset: JSON.parse(row.result) }
      : row.state === "reserved"
        ? {
            upload: {
              method: "PUT",
              url: await presignSizedUpload(row.objectKey, row.sizeBytes),
              headers: { "content-length": String(row.sizeBytes) },
              maxBytes: row.sizeBytes,
            },
          }
        : {}),
  };
}
export const prepareUpload = action({
  args: requestArgs,
  handler: async (ctx, args) =>
    prepareForPrincipal(ctx, args, await ctx.runQuery(q("videoMedia:principal"), {})),
});
export const agentPrepareUpload = internalAction({
  args: { ...requestArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => prepareForPrincipal(ctx, args, videoPrincipalId),
});
export const uploadRow = internalQuery({
  args: { uploadId: v.id("videoMediaUploads"), principalId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.principalId !== args.principalId)
      throw new ConvexError({ code: "NOT_FOUND_OR_FORBIDDEN", effect: "none" });
    return row;
  },
});
export const claim = internalMutation({
  args: { uploadId: v.id("videoMediaUploads"), principalId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.principalId !== args.principalId)
      throw new ConvexError({
        code: "NOT_FOUND_OR_FORBIDDEN",
        effect: "not_applied",
      });
    if (!["reserved", "failed"].includes(row.state)) return false;
    const startedAt = Date.now();
    await ctx.db.patch(row._id, {
      state: "verifying",
      verificationStartedAt: startedAt,
    });
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoMedia:verify"), {
      ...args,
      startedAt,
    });
    await ctx.scheduler.runAfter(
      900000,
      makeFunctionReference<"mutation">("videoMedia:expireVerification"),
      { uploadId: row._id, startedAt },
    );
    return true;
  },
});
export const finished = internalMutation({
  args: {
    uploadId: v.id("videoMediaUploads"),
    startedAt: v.number(),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.state !== "verifying" || row.verificationStartedAt !== args.startedAt)
      throw new Error("Upload claim unavailable");
    await ctx.db.patch(
      row._id,
      args.result ? { state: "ready", result: canonical(args.result) } : { state: "failed" },
    );
  },
});
async function finalizeForPrincipal(
  ctx: ActionCtx,
  args: { uploadId: Id<"videoMediaUploads"> },
  principalId: Id<"users">,
) {
  const row = await ctx.runQuery(q("videoMedia:uploadRow"), {
    ...args,
    principalId,
  });
  if (row.state === "ready") return { state: "ready", asset: JSON.parse(row.result) };
  if (!["reserved", "failed"].includes(row.state)) return { state: row.state, asset: null };
  const head = await headObject(row.objectKey);
  if (!head.ok || Number(head.headers.get("content-length")) !== row.sizeBytes)
    throw new ConvexError({
      code: "UPLOAD_INCOMPLETE",
      message: "Upload exact reserved bytes before finalizing",
      effect: "not_applied",
    });
  if (!(await ctx.runMutation(m("videoMedia:claim"), { ...args, principalId })))
    return { state: "verifying", asset: null };
  return { state: "verifying", asset: null };
}
export const finalizeUpload = action({
  args: { uploadId: v.id("videoMediaUploads") },
  handler: async (ctx, args) =>
    finalizeForPrincipal(ctx, args, await ctx.runQuery(q("videoMedia:principal"), {})),
});
export const agentFinalizeUpload = internalAction({
  args: {
    uploadId: v.id("videoMediaUploads"),
    videoPrincipalId: v.id("users"),
  },
  handler: (ctx, { videoPrincipalId, ...args }) =>
    finalizeForPrincipal(ctx, args, videoPrincipalId),
});
export const verify = internalAction({
  args: {
    uploadId: v.id("videoMediaUploads"),
    principalId: v.id("users"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(q("videoMedia:uploadRow"), {
      uploadId: args.uploadId,
      principalId: args.principalId,
    });
    if (row.state !== "verifying" || row.verificationStartedAt !== args.startedAt) return;
    try {
      const worker = getWorkerConfig();
      const leaseId = `media-upload:${row._id}`;
      const immutableKey = `media-ready/${row._id}/${row.sha256}`;
      await ctx.runMutation(m("assets:acquireObjectLease"), {
        objectKey: immutableKey,
        leaseId,
      });
      const response = await fetch(`${worker.url}/media/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${worker.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourceUrl: await presignObject(row.objectKey, "GET", 900),
          destinationUrl: await presignObject(immutableKey, "PUT", 900),
          declaredMimeType: row.mimeType,
          maxBytes: row.sizeBytes,
          expectedSize: row.sizeBytes,
          expectedSha256: row.sha256,
        }),
        signal: AbortSignal.timeout(540000),
      });
      if (!response.ok) throw new Error("Media verification failed");
      const data = (await response.json()) as {
        sha256: string;
        sizeBytes: number;
        mimeType: string;
        kind: string;
        persisted: boolean;
      };
      if (
        !data.persisted ||
        data.sha256 !== row.sha256 ||
        data.sizeBytes !== row.sizeBytes ||
        data.mimeType !== row.mimeType
      )
        throw new Error("Media integrity mismatch");
      const saved = await ctx.runMutation(m("assets:commitAssetVersion"), {
        scope: "workspace",
        createdBy: row.principalId,
        workspaceId: row.workspaceId,
        slug: `media-${row._id}`,
        name: row.filename,
        tags: ["video-import"],
        kind: data.kind,
        mediaMetadata: verifiedMediaMetadata(data),
        objectKey: immutableKey,
        contentHash: row.sha256,
        mimeType: row.mimeType,
        size: row.sizeBytes,
        originalFilename: row.filename,
        sourceType: "upload",
        deduplicateObject: true,
        objectLeaseId: leaseId,
        ...(row.source === "codex-imagegen"
          ? { provenance: { kind: "codex-imagegen", actualModel: null } }
          : {}),
      });
      await ctx.runMutation(m("videoMedia:finished"), {
        uploadId: row._id,
        startedAt: args.startedAt,
        result: { assetId: saved.assetId, revisionId: saved.versionId },
      });
    } catch {
      await ctx.runMutation(m("videoMedia:finished"), {
        uploadId: row._id,
        startedAt: args.startedAt,
      });
    }
  },
});
export const expireVerification = internalMutation({
  args: { uploadId: v.id("videoMediaUploads"), startedAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (row?.state === "verifying" && row.verificationStartedAt === args.startedAt)
      await ctx.db.patch(row._id, { state: "failed" });
  },
});

import { verifiedMediaMetadata } from "./lib/videoAssetMetadata";
