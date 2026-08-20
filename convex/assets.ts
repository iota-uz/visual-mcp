import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { formatAssetRef, parseAssetRef } from "./lib/assetRef";
import {
  ASSET_MAX_BYTES,
  ASSET_MIME_TYPES,
  assertSafeImportUrl,
  validateAssetBytes,
} from "./lib/assetSecurity";
import { requireIotaIdentity, resolveUserId } from "./lib/auth";
import { sha256HexBytes } from "./lib/hash";
import { deleteObject, getObject, headObject, presignObject, putObject } from "./lib/objectStore";
import { slugify } from "./lib/slug";
import { callWorker, getWorkerConfig } from "./lib/worker";

const scopeValidator = v.union(v.literal("personal"), v.literal("workspace"));
const kindValidator = v.union(
  v.literal("image"),
  v.literal("svg"),
  v.literal("font"),
  v.literal("video"),
  v.literal("data"),
);

const assetListItemValidator = v.object({
  asset_id: v.id("assets"),
  asset_ref: v.string(),
  scope: scopeValidator,
  workspace_slug: v.union(v.string(), v.null()),
  slug: v.string(),
  name: v.string(),
  description: v.union(v.string(), v.null()),
  tags: v.array(v.string()),
  kind: kindValidator,
  revision: v.number(),
  mime_type: v.string(),
  size_bytes: v.number(),
  content_hash: v.string(),
  original_filename: v.string(),
  updated_at: v.number(),
});

type Principal = {
  userId: Id<"users">;
  workspaceId: Id<"workspaces"> | null;
  workspaceSlug: string | null;
};
type PersistedAsset = {
  assetId: Id<"assets">;
  versionId: Id<"assetVersions">;
  revision: number;
  assetRef: string;
  mimeType: string;
  size: number;
  contentHash: string;
};
type AssetListRow = {
  asset_id: Id<"assets">;
  asset_ref: string;
  scope: "personal" | "workspace";
  workspace_slug: string | null;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  kind: "image" | "svg" | "font" | "video" | "data";
  revision: number;
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  original_filename: string;
  updated_at: number;
  preview_object_key: string;
};
type PublicAssetListRow = Omit<AssetListRow, "preview_object_key"> & { preview_url: string };

type AssetLookupCtx = QueryCtx | MutationCtx;

async function findAssetForRef(
  ctx: AssetLookupCtx,
  ref: string,
  userId: Id<"users">,
): Promise<{ asset: Doc<"assets">; workspaceSlug?: string }> {
  const parsed = parseAssetRef(ref);
  if (parsed.scope === "personal") {
    const asset = await ctx.db
      .query("assets")
      .withIndex("by_owner_slug", (q) => q.eq("ownerUserId", userId).eq("slug", parsed.slug))
      .unique();
    if (!asset) throw new Error(`Asset not found: ${ref}`);
    return { asset };
  }

  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", parsed.workspaceSlug))
    .unique();
  if (!workspace || workspace.archivedAt !== undefined) throw new Error(`Asset not found: ${ref}`);
  const asset = await ctx.db
    .query("assets")
    .withIndex("by_workspace_slug", (q) =>
      q.eq("workspaceId", workspace._id).eq("slug", parsed.slug),
    )
    .unique();
  if (!asset) throw new Error(`Asset not found: ${ref}`);
  return { asset, workspaceSlug: workspace.slug };
}

async function latestAssetRevision(ctx: AssetLookupCtx, assetId: Id<"assets">) {
  return ctx.db
    .query("assetVersions")
    .withIndex("by_asset_revision", (q) => q.eq("assetId", assetId))
    .order("desc")
    .first();
}

async function userIdForSubject(ctx: QueryCtx, subject: string): Promise<Id<"users">> {
  const direct = subject.includes("|") ? subject.split("|")[0] : null;
  const normalized = direct ? ctx.db.normalizeId("users", direct) : null;
  const user = normalized
    ? await ctx.db.get(normalized)
    : await ctx.db
        .query("users")
        .withIndex("by_googleSub", (q) => q.eq("googleSub", subject))
        .unique();
  if (!user) throw new Error("Signed-in user record not found");
  return user._id;
}

export const resolvePrincipal = internalQuery({
  args: { subject: v.string(), workspaceSlug: v.optional(v.string()) },
  returns: v.object({
    userId: v.id("users"),
    workspaceId: v.union(v.id("workspaces"), v.null()),
    workspaceSlug: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const userId = await userIdForSubject(ctx, args.subject);
    if (!args.workspaceSlug) return { userId, workspaceId: null, workspaceSlug: null };
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug as string))
      .unique();
    if (!workspace || workspace.archivedAt !== undefined) throw new Error("Workspace not found");
    return { userId, workspaceId: workspace._id, workspaceSlug: workspace.slug };
  },
});

export const createUpload = internalMutation({
  args: {
    scope: scopeValidator,
    ownerUserId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    sourceObjectKey: v.string(),
    filename: v.string(),
    declaredMimeType: v.string(),
    expectedSize: v.optional(v.number()),
    expectedHash: v.optional(v.string()),
    expiresAt: v.number(),
  },
  returns: v.id("assetUploads"),
  handler: async (ctx, args) => {
    if (args.scope === "workspace" && !args.workspaceId) throw new Error("Workspace is required");
    if (args.scope === "personal" && args.workspaceId)
      throw new Error("Personal assets cannot have a workspace");
    return ctx.db.insert("assetUploads", {
      ...args,
      ownerUserId: args.scope === "personal" ? args.ownerUserId : undefined,
      createdBy: args.ownerUserId,
    });
  },
});

export const getUpload = internalQuery({
  args: { uploadId: v.id("assetUploads"), userId: v.id("users"), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      scope: scopeValidator,
      ownerUserId: v.optional(v.id("users")),
      workspaceId: v.optional(v.id("workspaces")),
      sourceObjectKey: v.string(),
      filename: v.string(),
      declaredMimeType: v.string(),
      expectedSize: v.optional(v.number()),
      expectedHash: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.createdBy !== args.userId || upload.expiresAt <= args.now) return null;
    return {
      scope: upload.scope,
      ownerUserId: upload.ownerUserId,
      workspaceId: upload.workspaceId,
      sourceObjectKey: upload.sourceObjectKey,
      filename: upload.filename,
      declaredMimeType: upload.declaredMimeType,
      expectedSize: upload.expectedSize,
      expectedHash: upload.expectedHash,
    };
  },
});

export const commitAssetVersion = internalMutation({
  args: {
    uploadId: v.optional(v.id("assetUploads")),
    scope: scopeValidator,
    ownerUserId: v.id("users"),
    workspaceId: v.optional(v.id("workspaces")),
    workspaceSlug: v.optional(v.string()),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.array(v.string()),
    kind: kindValidator,
    sourceObjectKey: v.string(),
    deliveryObjectKey: v.string(),
    previewObjectKey: v.string(),
    contentHash: v.string(),
    mimeType: v.string(),
    size: v.number(),
    originalFilename: v.string(),
    sourceType: v.union(v.literal("upload"), v.literal("url"), v.literal("canvas-import")),
    sourceUrl: v.optional(v.string()),
  },
  returns: v.object({
    assetId: v.id("assets"),
    versionId: v.id("assetVersions"),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const existing =
      args.scope === "personal"
        ? await ctx.db
            .query("assets")
            .withIndex("by_owner_slug", (q) =>
              q.eq("ownerUserId", args.ownerUserId).eq("slug", args.slug),
            )
            .unique()
        : await ctx.db
            .query("assets")
            .withIndex("by_workspace_slug", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("slug", args.slug),
            )
            .unique();
    const now = Date.now();
    const searchText = [args.name, args.slug, args.description, args.originalFilename, ...args.tags]
      .filter(Boolean)
      .join(" ");
    const assetId =
      existing?._id ??
      (await ctx.db.insert("assets", {
        scope: args.scope,
        ownerUserId: args.scope === "personal" ? args.ownerUserId : undefined,
        workspaceId: args.scope === "workspace" ? args.workspaceId : undefined,
        slug: args.slug,
        name: args.name,
        description: args.description,
        tags: args.tags,
        kind: args.kind,
        searchText,
        createdBy: args.ownerUserId,
        updatedAt: now,
      }));
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        tags: args.tags,
        kind: args.kind,
        searchText,
        archivedAt: undefined,
        updatedAt: now,
      });
    }
    const last = await ctx.db
      .query("assetVersions")
      .withIndex("by_asset_revision", (q) => q.eq("assetId", assetId))
      .order("desc")
      .first();
    const revision = (last?.revision ?? 0) + 1;
    const versionId = await ctx.db.insert("assetVersions", {
      assetId,
      revision,
      sourceObjectKey: args.sourceObjectKey,
      deliveryObjectKey: args.deliveryObjectKey,
      previewObjectKey: args.previewObjectKey,
      contentHash: args.contentHash,
      mimeType: args.mimeType,
      size: args.size,
      originalFilename: args.originalFilename,
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      createdBy: args.ownerUserId,
    });
    await ctx.db.patch(assetId, { updatedAt: now });
    if (args.uploadId) await ctx.db.delete(args.uploadId);
    return { assetId, versionId, revision };
  },
});

export async function fetchAssetImport(
  raw: string,
): Promise<{ bytes: Uint8Array; mimeType: string; finalUrl: string }> {
  const url = assertSafeImportUrl(raw).toString();
  const stagingKey = `staging/import/${crypto.randomUUID()}`;
  try {
    const imported = await callWorker<{ finalUrl: string; mimeType: string; size: number }>(
      getWorkerConfig(),
      "/asset-import",
      {
        url,
        maxBytes: ASSET_MAX_BYTES,
        upload: { putUrl: await presignObject("source", stagingKey, "PUT", 900) },
      },
    );
    if (imported.size > ASSET_MAX_BYTES) throw new Error(`Asset exceeds ${ASSET_MAX_BYTES} bytes`);
    const response = await getObject("source", stagingKey);
    if (!response.ok) throw new Error(`Imported object is unavailable: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== imported.size) {
      throw new Error("Imported asset size does not match worker result");
    }
    return { bytes, mimeType: imported.mimeType, finalUrl: imported.finalUrl };
  } finally {
    await deleteObject("source", stagingKey).catch(() => undefined);
  }
}

async function ensureObject(
  store: "source" | "delivery",
  key: string,
  bytes: Uint8Array,
  mimeType: string,
) {
  const existing = await headObject(store, key);
  if (existing.status === 404) await putObject(store, key, bytes, mimeType);
  else if (!existing.ok) throw new Error(`Unable to inspect object: HTTP ${existing.status}`);
}

export async function persistAsset(
  ctx: ActionCtx,
  input: {
    uploadId?: Id<"assetUploads">;
    scope: "personal" | "workspace";
    ownerUserId: Id<"users">;
    workspaceId?: Id<"workspaces">;
    workspaceSlug?: string;
    slug: string;
    name: string;
    description?: string;
    tags: string[];
    filename: string;
    rawBytes: Uint8Array;
    declaredMime: string;
    sourceType: "upload" | "url" | "canvas-import";
    sourceUrl?: string;
  },
): Promise<PersistedAsset> {
  const rawHash = await sha256HexBytes(input.rawBytes);
  const validated = await validateAssetBytes(input.rawBytes, input.declaredMime);
  const sourceObjectKey = `blobs/sha256/${rawHash.slice(0, 2)}/${rawHash}`;
  const deliveryObjectKey = `blobs/sha256/${validated.contentHash.slice(0, 2)}/${validated.contentHash}`;
  await ensureObject("source", sourceObjectKey, input.rawBytes, input.declaredMime);
  await ensureObject("delivery", deliveryObjectKey, validated.bytes, validated.mimeType);
  const committed: { assetId: Id<"assets">; versionId: Id<"assetVersions">; revision: number } =
    await ctx.runMutation(internal.assets.commitAssetVersion, {
      uploadId: input.uploadId,
      scope: input.scope,
      ownerUserId: input.ownerUserId,
      workspaceId: input.workspaceId,
      workspaceSlug: input.workspaceSlug,
      slug: input.slug,
      name: input.name,
      description: input.description,
      tags: input.tags,
      kind: validated.kind,
      sourceObjectKey,
      deliveryObjectKey,
      previewObjectKey: deliveryObjectKey,
      contentHash: validated.contentHash,
      mimeType: validated.mimeType,
      size: validated.bytes.byteLength,
      originalFilename: input.filename,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
    });
  return {
    ...committed,
    assetRef: formatAssetRef({
      scope: input.scope,
      workspaceSlug: input.workspaceSlug,
      slug: input.slug,
      revision: committed.revision,
    }),
    mimeType: validated.mimeType,
    size: validated.bytes.byteLength,
    contentHash: validated.contentHash,
  };
}

export const prepareUploadMine = action({
  args: {
    scope: scopeValidator,
    workspaceSlug: v.optional(v.string()),
    filename: v.string(),
    contentType: v.string(),
    sizeBytes: v.optional(v.number()),
    sha256: v.optional(v.string()),
  },
  returns: v.object({
    uploadId: v.id("assetUploads"),
    uploadUrl: v.string(),
    method: v.literal("PUT"),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    uploadId: Id<"assetUploads">;
    uploadUrl: string;
    method: "PUT";
    expiresAt: number;
  }> => {
    const identity = await requireIotaIdentity(ctx);
    if (args.sizeBytes !== undefined && (args.sizeBytes <= 0 || args.sizeBytes > ASSET_MAX_BYTES)) {
      throw new Error(`Asset size must be between 1 and ${ASSET_MAX_BYTES} bytes`);
    }
    if (!((args.contentType.split(";")[0] as string) in ASSET_MIME_TYPES)) {
      throw new Error(`Unsupported asset MIME type: ${args.contentType}`);
    }
    const principal: Principal = await ctx.runQuery(internal.assets.resolvePrincipal, {
      subject: identity.subject,
      workspaceSlug: args.scope === "workspace" ? args.workspaceSlug : undefined,
    });
    const key = `staging/${principal.userId}/${crypto.randomUUID()}`;
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const uploadId: Id<"assetUploads"> = await ctx.runMutation(internal.assets.createUpload, {
      scope: args.scope,
      ownerUserId: principal.userId,
      workspaceId: principal.workspaceId ?? undefined,
      sourceObjectKey: key,
      filename: args.filename,
      declaredMimeType: args.contentType,
      expectedSize: args.sizeBytes,
      expectedHash: args.sha256,
      expiresAt,
    });
    return {
      uploadId,
      uploadUrl: await presignObject("source", key, "PUT", 3600),
      method: "PUT",
      expiresAt,
    };
  },
});

export const finalizeUploadMine = action({
  args: {
    uploadId: v.id("assetUploads"),
    slug: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.object({
    assetId: v.id("assets"),
    assetRef: v.string(),
    revision: v.number(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentHash: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    assetId: Id<"assets">;
    assetRef: string;
    revision: number;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
  }> => {
    const identity = await requireIotaIdentity(ctx);
    const principal = await ctx.runQuery(internal.assets.resolvePrincipal, {
      subject: identity.subject,
    });
    const upload = await ctx.runQuery(internal.assets.getUpload, {
      uploadId: args.uploadId,
      userId: principal.userId,
      now: Date.now(),
    });
    if (!upload) throw new Error("Upload does not exist or has expired");
    const response = await getObject("source", upload.sourceObjectKey);
    if (!response.ok) throw new Error(`Uploaded object is unavailable: HTTP ${response.status}`);
    const rawBytes = new Uint8Array(await response.arrayBuffer());
    if (upload.expectedSize !== undefined && rawBytes.byteLength !== upload.expectedSize)
      throw new Error("Uploaded asset size does not match the declared size");
    const rawHash = await sha256HexBytes(rawBytes);
    if (upload.expectedHash && rawHash !== upload.expectedHash.replace(/^sha256:/, ""))
      throw new Error("Uploaded asset SHA-256 does not match");
    const workspace = upload.workspaceId
      ? await ctx.runQuery(internal.assets.getWorkspace, { workspaceId: upload.workspaceId })
      : null;
    const saved = await persistAsset(ctx, {
      uploadId: args.uploadId,
      scope: upload.scope,
      ownerUserId: principal.userId,
      workspaceId: upload.workspaceId,
      workspaceSlug: workspace?.slug,
      slug: slugify(args.slug ?? args.name),
      name: args.name.trim(),
      description: args.description,
      tags: [...new Set(args.tags ?? [])],
      filename: upload.filename,
      rawBytes,
      declaredMime: upload.declaredMimeType,
      sourceType: "upload",
    });
    await deleteObject("source", upload.sourceObjectKey);
    return {
      assetId: saved.assetId,
      assetRef: saved.assetRef,
      revision: saved.revision,
      mimeType: saved.mimeType,
      sizeBytes: saved.size,
      contentHash: saved.contentHash,
    };
  },
});

export const getWorkspace = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.union(v.null(), v.object({ slug: v.string(), name: v.string() })),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    return workspace ? { slug: workspace.slug, name: workspace.name } : null;
  },
});

export const getWorkspaceBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({ workspaceId: v.id("workspaces"), slug: v.string(), name: v.string() }),
  ),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    return workspace && workspace.archivedAt === undefined
      ? { workspaceId: workspace._id, slug: workspace.slug, name: workspace.name }
      : null;
  },
});

export const importUrlMine = action({
  args: {
    scope: scopeValidator,
    workspaceSlug: v.optional(v.string()),
    url: v.string(),
    slug: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.object({
    assetId: v.id("assets"),
    assetRef: v.string(),
    revision: v.number(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    contentHash: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const principal = await ctx.runQuery(internal.assets.resolvePrincipal, {
      subject: identity.subject,
      workspaceSlug: args.scope === "workspace" ? args.workspaceSlug : undefined,
    });
    const imported = await fetchAssetImport(args.url);
    const filename = new URL(imported.finalUrl).pathname.split("/").pop() || "asset";
    const saved = await persistAsset(ctx, {
      scope: args.scope,
      ownerUserId: principal.userId,
      workspaceId: principal.workspaceId ?? undefined,
      workspaceSlug: principal.workspaceSlug ?? undefined,
      slug: slugify(args.slug ?? args.name),
      name: args.name.trim(),
      description: args.description,
      tags: [...new Set(args.tags ?? [])],
      filename,
      rawBytes: imported.bytes,
      declaredMime: imported.mimeType,
      sourceType: "url",
      sourceUrl: imported.finalUrl.split("?")[0],
    });
    return {
      assetId: saved.assetId,
      assetRef: saved.assetRef,
      revision: saved.revision,
      mimeType: saved.mimeType,
      sizeBytes: saved.size,
      contentHash: saved.contentHash,
    };
  },
});

export const listInternal = internalQuery({
  args: {
    userId: v.id("users"),
    scope: scopeValidator,
    workspaceSlug: v.optional(v.string()),
    query: v.optional(v.string()),
    kind: v.optional(kindValidator),
    limit: v.number(),
  },
  returns: v.array(assetListItemValidator.extend({ preview_object_key: v.string() })),
  handler: async (ctx, args) => {
    let workspace: Doc<"workspaces"> | null = null;
    if (args.scope === "workspace") {
      workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug as string))
        .unique();
      if (!workspace) throw new Error("Workspace not found");
    }
    const rows = args.query?.trim()
      ? await ctx.db
          .query("assets")
          .withSearchIndex("search_text", (q) => {
            let search = q.search("searchText", args.query as string).eq("scope", args.scope);
            search =
              args.scope === "personal"
                ? search.eq("ownerUserId", args.userId)
                : search.eq("workspaceId", workspace?._id);
            return args.kind ? search.eq("kind", args.kind) : search;
          })
          .take(Math.min(args.limit, 100))
      : args.scope === "personal"
        ? await ctx.db
            .query("assets")
            .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", args.userId))
            .order("desc")
            .take(Math.min(args.limit, 100))
        : await ctx.db
            .query("assets")
            .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspace?._id))
            .order("desc")
            .take(Math.min(args.limit, 100));
    const visible = rows.filter(
      (row) => row.archivedAt === undefined && (!args.kind || row.kind === args.kind),
    );
    const result = [];
    for (const asset of visible) {
      const version = await ctx.db
        .query("assetVersions")
        .withIndex("by_asset_revision", (q) => q.eq("assetId", asset._id))
        .order("desc")
        .first();
      if (!version) continue;
      result.push({
        asset_id: asset._id,
        asset_ref: formatAssetRef({
          scope: asset.scope,
          workspaceSlug: workspace?.slug,
          slug: asset.slug,
          revision: version.revision,
        }),
        scope: asset.scope,
        workspace_slug: workspace?.slug ?? null,
        slug: asset.slug,
        name: asset.name,
        description: asset.description ?? null,
        tags: asset.tags,
        kind: asset.kind,
        revision: version.revision,
        mime_type: version.mimeType,
        size_bytes: version.size,
        content_hash: version.contentHash,
        original_filename: version.originalFilename,
        updated_at: asset.updatedAt,
        preview_object_key: version.previewObjectKey,
      });
    }
    return result;
  },
});

export const listMine = action({
  args: {
    scope: scopeValidator,
    workspaceSlug: v.optional(v.string()),
    query: v.optional(v.string()),
    kind: v.optional(kindValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(assetListItemValidator.extend({ preview_url: v.string() })),
  handler: async (ctx, args): Promise<PublicAssetListRow[]> => {
    const identity = await requireIotaIdentity(ctx);
    const principal: Principal = await ctx.runQuery(internal.assets.resolvePrincipal, {
      subject: identity.subject,
      workspaceSlug: args.scope === "workspace" ? args.workspaceSlug : undefined,
    });
    const rows: AssetListRow[] = await ctx.runQuery(internal.assets.listInternal, {
      userId: principal.userId,
      scope: args.scope,
      workspaceSlug: args.workspaceSlug,
      query: args.query,
      kind: args.kind,
      limit: args.limit ?? 100,
    });
    return Promise.all(
      rows.map(async ({ preview_object_key, ...row }) => ({
        ...row,
        preview_url: await presignObject("delivery", preview_object_key, "GET", 900),
      })),
    );
  },
});

export const resolveRef = internalQuery({
  args: { ref: v.string(), userId: v.id("users") },
  returns: v.object({
    assetId: v.id("assets"),
    assetVersionId: v.id("assetVersions"),
    revision: v.number(),
    mimeType: v.string(),
    size: v.number(),
    contentHash: v.string(),
    deliveryObjectKey: v.string(),
    previewObjectKey: v.string(),
    assetRef: v.string(),
  }),
  handler: async (ctx, args) => {
    const parsed = parseAssetRef(args.ref);
    const { asset, workspaceSlug } = await findAssetForRef(ctx, args.ref, args.userId);
    if (asset.archivedAt !== undefined) throw new Error(`Asset not found: ${args.ref}`);
    const version = parsed.revision
      ? await ctx.db
          .query("assetVersions")
          .withIndex("by_asset_revision", (q) =>
            q.eq("assetId", asset._id).eq("revision", parsed.revision as number),
          )
          .unique()
      : await ctx.db
          .query("assetVersions")
          .withIndex("by_asset_revision", (q) => q.eq("assetId", asset._id))
          .order("desc")
          .first();
    if (!version) throw new Error(`Asset revision not found: ${args.ref}`);
    return {
      assetId: asset._id,
      assetVersionId: version._id,
      revision: version.revision,
      mimeType: version.mimeType,
      size: version.size,
      contentHash: version.contentHash,
      deliveryObjectKey: version.deliveryObjectKey,
      previewObjectKey: version.previewObjectKey,
      assetRef: formatAssetRef({
        scope: asset.scope,
        workspaceSlug,
        slug: asset.slug,
        revision: version.revision,
      }),
    };
  },
});

async function archiveAssetByRef(
  ctx: MutationCtx,
  args: { assetRef: string; userId: Id<"users"> },
) {
  const { asset, workspaceSlug } = await findAssetForRef(ctx, args.assetRef, args.userId);
  const version = await latestAssetRevision(ctx, asset._id);
  if (!version) throw new Error(`Asset revision not found: ${args.assetRef}`);
  await ctx.db.patch(asset._id, { archivedAt: Date.now(), updatedAt: Date.now() });
  return {
    assetRef: formatAssetRef({
      scope: asset.scope,
      workspaceSlug,
      slug: asset.slug,
      revision: version.revision,
    }),
    mode: "archived" as const,
    reversible: true,
  };
}

export const archiveByRef = internalMutation({
  args: { assetRef: v.string(), userId: v.id("users") },
  returns: v.object({ assetRef: v.string(), mode: v.literal("archived"), reversible: v.boolean() }),
  handler: async (ctx, args) => {
    return archiveAssetByRef(ctx, args);
  },
});

export const restoreByRef = internalMutation({
  args: { assetRef: v.string(), userId: v.id("users") },
  returns: v.object({ assetRef: v.string(), mode: v.literal("restored") }),
  handler: async (ctx, args) => {
    const { asset, workspaceSlug } = await findAssetForRef(ctx, args.assetRef, args.userId);
    const version = await latestAssetRevision(ctx, asset._id);
    if (!version) throw new Error(`Asset revision not found: ${args.assetRef}`);
    if (asset.archivedAt !== undefined) {
      await ctx.db.patch(asset._id, { archivedAt: undefined, updatedAt: Date.now() });
    }
    return {
      assetRef: formatAssetRef({
        scope: asset.scope,
        workspaceSlug,
        slug: asset.slug,
        revision: version.revision,
      }),
      mode: "restored" as const,
    };
  },
});

export const moveByRef = internalMutation({
  args: {
    assetRef: v.string(),
    userId: v.id("users"),
    destinationScope: scopeValidator,
    destinationWorkspaceSlug: v.optional(v.string()),
  },
  returns: v.object({ previousAssetRef: v.string(), assetRef: v.string() }),
  handler: async (ctx, args) => {
    const { asset, workspaceSlug: sourceWorkspaceSlug } = await findAssetForRef(
      ctx,
      args.assetRef,
      args.userId,
    );
    if (asset.archivedAt !== undefined) throw new Error(`Asset not found: ${args.assetRef}`);
    const version = await latestAssetRevision(ctx, asset._id);
    if (!version) throw new Error(`Asset revision not found: ${args.assetRef}`);

    let destinationWorkspace: Doc<"workspaces"> | null = null;
    if (args.destinationScope === "workspace") {
      if (!args.destinationWorkspaceSlug) {
        throw new Error("destination_workspace is required for workspace assets");
      }
      destinationWorkspace = await ctx.db
        .query("workspaces")
        .withIndex("by_slug", (q) => q.eq("slug", args.destinationWorkspaceSlug as string))
        .unique();
      if (!destinationWorkspace || destinationWorkspace.archivedAt !== undefined) {
        throw new Error("Destination workspace not found");
      }
    } else if (args.destinationWorkspaceSlug) {
      throw new Error("destination_workspace is only valid for workspace assets");
    }

    const sameDestination =
      asset.scope === args.destinationScope &&
      (asset.scope === "personal" || asset.workspaceId === destinationWorkspace?._id);
    if (sameDestination) throw new Error("Asset is already in the destination library");

    const collision =
      args.destinationScope === "personal"
        ? await ctx.db
            .query("assets")
            .withIndex("by_owner_slug", (q) =>
              q.eq("ownerUserId", args.userId).eq("slug", asset.slug),
            )
            .unique()
        : await ctx.db
            .query("assets")
            .withIndex("by_workspace_slug", (q) =>
              q.eq("workspaceId", destinationWorkspace?._id).eq("slug", asset.slug),
            )
            .unique();
    if (collision) {
      throw new Error(
        `An asset with slug "${asset.slug}" already exists in the destination library`,
      );
    }

    const previousAssetRef = formatAssetRef({
      scope: asset.scope,
      workspaceSlug: sourceWorkspaceSlug,
      slug: asset.slug,
      revision: version.revision,
    });
    await ctx.db.patch(asset._id, {
      scope: args.destinationScope,
      ownerUserId: args.destinationScope === "personal" ? args.userId : undefined,
      workspaceId: args.destinationScope === "workspace" ? destinationWorkspace?._id : undefined,
      updatedAt: Date.now(),
    });
    return {
      previousAssetRef,
      assetRef: formatAssetRef({
        scope: args.destinationScope,
        workspaceSlug: destinationWorkspace?.slug,
        slug: asset.slug,
        revision: version.revision,
      }),
    };
  },
});

export const attachMine = action({
  args: {
    canvasId: v.id("canvases"),
    assetRef: v.string(),
    path: v.string(),
    expectedVersion: v.number(),
  },
  returns: v.object({ version: v.number(), assetRef: v.string(), path: v.string() }),
  handler: async (ctx, args): Promise<{ version: number; assetRef: string; path: string }> => {
    const identity = await requireIotaIdentity(ctx);
    const principal: Principal = await ctx.runQuery(internal.assets.resolvePrincipal, {
      subject: identity.subject,
    });
    const resolved = await ctx.runQuery(internal.assets.resolveRef, {
      ref: args.assetRef,
      userId: principal.userId,
    });
    const result: { version: number; path: string } = await ctx.runMutation(
      internal.canvases.bindAssetAndVersion,
      {
        canvasId: args.canvasId,
        logicalPath: args.path,
        assetId: resolved.assetId,
        assetVersionId: resolved.assetVersionId,
        expectedVersion: args.expectedVersion,
        createdBy: principal.userId,
      },
    );
    return { version: result.version, assetRef: resolved.assetRef, path: result.path };
  },
});

export const listForCanvasMine = query({
  args: { canvasId: v.id("canvases") },
  returns: v.array(
    v.object({
      path: v.string(),
      asset_id: v.id("assets"),
      asset_version_id: v.id("assetVersions"),
      name: v.string(),
      revision: v.number(),
      mime_type: v.string(),
      size_bytes: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const bindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(200);
    const rows = [];
    for (const binding of bindings) {
      const asset = await ctx.db.get(binding.assetId);
      const version = await ctx.db.get(binding.assetVersionId);
      if (!asset || !version) continue;
      rows.push({
        path: binding.logicalPath,
        asset_id: asset._id,
        asset_version_id: version._id,
        name: asset.name,
        revision: version.revision,
        mime_type: version.mimeType,
        size_bytes: version.size,
      });
    }
    return rows;
  },
});

export const archiveMine = mutation({
  args: { assetRef: v.string() },
  returns: v.object({ assetRef: v.string(), mode: v.literal("archived"), reversible: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await resolveUserId(ctx, identity);
    if (!userId) throw new Error("Signed-in user record not found");
    return archiveAssetByRef(ctx, { assetRef: args.assetRef, userId });
  },
});
