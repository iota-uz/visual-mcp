import { layoutCanvas } from "@visual-canvas/canvas/layout.js";
import { renderCanvas } from "@visual-canvas/canvas/render.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import { CanvasDocSchema, RectSchema } from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity } from "./lib/auth";
import { findCanvasByRef, findWorkspaceByRef, resolveOrCreateCanvas } from "./lib/canvasRefs";
import {
  isBlobReferenced as isStorageReferenced,
  purgeArtifact,
  purgeCanvas,
  purgeCanvasFile,
  purgeWorkspace,
} from "./lib/purge";
import { slugify } from "./lib/slug";
import { randomPublicSlug } from "./lib/tokenFormat";

const ArtifactTypeValidator = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("svg"),
  v.literal("source"),
);

const KindValidator = v.union(
  v.literal("canvas"),
  v.literal("html"),
  v.literal("image"),
  v.literal("pdf"),
);

function renderCanvasEntry(doc: ReturnType<typeof CanvasDocSchema.parse>): string {
  const { html } = renderCanvas(layoutCanvas(doc), { iframeLoading: "eager" });
  return (
    '<!doctype html><html><head><meta charset="utf-8" />' +
    `<style>html,body{margin:0;padding:0}</style><style>${THEME_CSS}</style>` +
    `</head><body>${html}<script>addEventListener('message',function(e){if(!e.data||e.data.type!=='visual-canvas:readiness')return;for(const f of document.querySelectorAll('.vc-kind-iframe iframe'))if(f.contentWindow===e.source){const n=f.closest('.vc-kind-iframe');n.dataset.iframeReadiness=e.data.state;n.dataset.iframeReadinessDetail=typeof e.data.detail==='string'?e.data.detail:'';break}})</script></body></html>`
  );
}

async function nextVersionNumber(ctx: MutationCtx, canvasId: Id<"canvases">): Promise<number> {
  const last = await ctx.db
    .query("canvasVersions")
    .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvasId))
    .order("desc")
    .first();
  return (last?.version ?? 0) + 1;
}

// PLAN.md section 9/12.4: "an agent in a loop can produce hundreds of
// full-page PNGs" — a soft per-canvas cap. Tracked as a running counter on
// `canvases.storageBytesUsed`, NOT recomputed from `artifacts`/`canvasFiles`
// at check time: version history (PLAN.md section 1 — re-rendering a
// relPath creates a new version and never destroys the superseded blob)
// means a canvas's real storage footprint keeps growing even when the
// *current* artifact rows don't change count, so a scan of "current rows
// only" silently undercounts and lets exactly the "hundreds of re-renders
// to the same output_path" scenario this cap exists for bypass it entirely.
// The counter only grows on writes below and only shrinks when a blob is
// actually deleted (sweepCacheTtl) — it tracks live storage, not a
// recomputation of current pointers. `canvasVersions` doc/css blobs
// (written when a doc is saved) and canvas thumbnails are deliberately
// excluded: one blob per call for docs, and thumbnails are capped at one per
// canvas by construction (recordRender always deletes the superseded one) —
// neither is the unbounded-loop growth vector this cap targets.
const CANVAS_STORAGE_QUOTA_BYTES = 250 * 1024 * 1024;

/**
 * Checks `incomingBytes` against the canvas's running storage total and, if
 * it fits, reserves it by patching the counter — in one mutation so the
 * check and the reservation can't drift apart. Throws a clear,
 * MCP-tool-surfaced error (caught by ../mcp/tools.ts's `runTool`) when it
 * would push the canvas over its soft cap.
 */
async function reserveCanvasStorage(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  incomingBytes: number,
): Promise<void> {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) throw new Error(`Unknown canvas: ${canvasId}`);
  const used = canvas.storageBytesUsed ?? 0;
  const next = used + incomingBytes;
  if (next > CANVAS_STORAGE_QUOTA_BYTES) {
    const usedMb = (used / (1024 * 1024)).toFixed(1);
    const capMb = (CANVAS_STORAGE_QUOTA_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Canvas storage quota exceeded: ${usedMb}MB used of ${capMb}MB soft cap. ` +
        "Remove old /output or /cache files, or start a new canvas.",
    );
  }
  await ctx.db.patch(canvasId, { storageBytesUsed: next });
}

/** The inverse of reserveCanvasStorage, for sweepCacheTtl's real deletions. */
async function releaseCanvasStorage(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  bytes: number,
): Promise<void> {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) return;
  const next = Math.max(0, (canvas.storageBytesUsed ?? 0) - bytes);
  await ctx.db.patch(canvasId, { storageBytesUsed: next });
}

/**
 * Records one artifact for a canvas, mirroring
 * packages/runtime/src/render/artifact-store's `registerArtifact` role
 * inference: the first artifact a canvas ever produces becomes "primary";
 * every artifact after that becomes "supporting" unless it explicitly
 * demotes the current primary. That override is `forceRole`, and
 * `canvas_save`'s per-render `primary` flag is what reaches it: inference
 * alone made the *first* artifact primary, so an html-then-png canvas
 * pinned its thumbnail to the html and never showed a picture.
 * Re-registering an existing relPath overwrites that row rather
 * than duplicating it — and, unlike the reference implementation's literal
 * "any artifacts already exist" check, re-registering the relPath that is
 * *currently* primary keeps it primary: the hosted product re-renders the
 * same output path across a canvas's whole lifetime (version history is a
 * first-class feature here, unlike the one-shot stdio sessions the
 * reference module was built for), so treating every re-render as "not the
 * first artifact ever" would silently vacate the "exactly one primary
 * artifact" invariant on the second render of any canvas.
 */
async function upsertArtifact(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  versionId: Id<"canvasVersions">,
  entry: {
    relPath: string;
    type: "pdf" | "image" | "svg" | "source";
    mimeType: string;
    size: number;
    storageId: Id<"_storage">;
  },
  opts?: {
    // attachCanvasRender's caller: kind="canvas"'s primary content is the doc
    // itself (PLAN.md section 2), never a PNG snapshot of it, so its
    // auto-render must never become "primary" even when it's the first
    // artifact this canvas has ever produced — the inference below would
    // otherwise get this wrong for exactly that case.
    //
    // "primary" is the v2 addition: the caller can now *declare* which render
    // is the canvas's face instead of leaving it to first-artifact-wins
    // inference. That inference had a trap — an html-kind canvas whose first
    // render was format:"html" claimed primary forever, so every later PNG
    // was "supporting" and its thumbnail was silently discarded, leaving the
    // gallery permanently blank for that canvas.
    forceRole?: "primary" | "supporting";
  },
): Promise<{ relPath: string; role: "primary" | "supporting" }> {
  await reserveCanvasStorage(ctx, canvasId, entry.size);

  const existingRow = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId).eq("relPath", entry.relPath))
    .unique();

  let role: "primary" | "supporting";
  if (opts?.forceRole) {
    role = opts.forceRole;
  } else if (existingRow?.role === "primary") {
    role = "primary";
  } else {
    const anyExisting = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
      .take(1);
    role = anyExisting.length === 0 ? "primary" : "supporting";
  }

  if (role === "primary") {
    const currentPrimary = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvasId))
      .filter((q) => q.eq(q.field("role"), "primary"))
      .take(10);
    for (const row of currentPrimary) {
      if (row.relPath !== entry.relPath) {
        await ctx.db.patch(row._id, { role: "supporting" });
      }
    }
  }

  if (existingRow) {
    await ctx.db.patch(existingRow._id, {
      versionId,
      type: entry.type,
      role,
      mimeType: entry.mimeType,
      size: entry.size,
      storageId: entry.storageId,
    });
  } else {
    await ctx.db.insert("artifacts", {
      canvasId,
      versionId,
      relPath: entry.relPath,
      type: entry.type,
      role,
      mimeType: entry.mimeType,
      size: entry.size,
      storageId: entry.storageId,
    });
  }
  return { relPath: entry.relPath, role };
}

/** Deletes the canvas's superseded thumbnail (if any) and replaces it — capping storage at one small blob per canvas regardless of render count. */
async function setCanvasThumbnail(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  thumbnailStorageId: Id<"_storage">,
): Promise<void> {
  const current = await ctx.db.get(canvasId);
  if (current?.thumbnailId) {
    await ctx.storage.delete(current.thumbnailId);
  }
  await ctx.db.patch(canvasId, { thumbnailId: thumbnailStorageId });
}

/**
 * recordRender's thumbnail policy: the gallery shows one thumbnail per
 * canvas, for its *primary* artifact — a thumbnail from re-rendering a
 * supporting output path doesn't belong on the canvas, so it's discarded
 * immediately rather than left as an orphaned blob.
 * attachCanvasRender (the doc auto-render) does NOT use this: its
 * artifact is always "supporting" by design (see upsertArtifact's
 * forceRole), but its thumbnail is still exactly what the doc currently
 * looks like and should always be attached — see its own call to
 * setCanvasThumbnail directly.
 */
async function attachThumbnailIfPrimary(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  role: "primary" | "supporting",
  thumbnailStorageId: Id<"_storage">,
): Promise<void> {
  if (role === "primary") {
    await setCanvasThumbnail(ctx, canvasId, thumbnailStorageId);
  } else {
    await ctx.storage.delete(thumbnailStorageId);
  }
}

function toSummary(c: Doc<"canvases">) {
  return {
    canvas_id: c._id,
    workspace_id: c.workspaceId,
    slug: c.slug,
    title: c.title,
    description: c.description,
    kind: c.kind,
    visibility: c.visibility,
    public_slug: c.publicSlug,
    theme: c.theme,
    updated_at: c.updatedAt,
  };
}

/**
 * A canvas's primary artifact is its gallery face, not necessarily the file
 * that can be opened as the canvas. HTML canvases commonly render both an
 * interactive HTML page and a primary PNG thumbnail. Treating the primary
 * PNG as `entry_url` turns the signed-in viewer into a static screenshot.
 *
 * Prefer a matching primary when one exists; otherwise use the most recently
 * registered artifact whose media type matches the canvas kind. Re-rendering
 * replaces an artifact row, so `_creationTime` is the current row's freshness
 * signal without loading every historical version.
 */
function selectViewerArtifact(
  kind: Doc<"canvases">["kind"],
  artifacts: Doc<"artifacts">[],
): Doc<"artifacts"> | undefined {
  if (kind === "canvas") return undefined;

  const matchesKind = (artifact: Doc<"artifacts">) => {
    switch (kind) {
      case "html":
        return artifact.mimeType === "text/html";
      case "pdf":
        return artifact.type === "pdf" || artifact.mimeType === "application/pdf";
      case "image":
        return artifact.type === "image" || artifact.type === "svg";
    }
  };

  const matching = artifacts.filter(matchesKind);
  return (
    matching.find((artifact) => artifact.role === "primary") ??
    matching.reduce<Doc<"artifacts"> | undefined>(
      (latest, artifact) =>
        !latest || artifact._creationTime > latest._creationTime ? artifact : latest,
      undefined,
    )
  );
}

async function getViewerArtifact(
  ctx: QueryCtx,
  canvas: Doc<"canvases">,
): Promise<Doc<"artifacts"> | undefined> {
  if (canvas.kind === "canvas") return undefined;
  const artifacts = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
    .take(500);
  return (
    selectViewerArtifact(canvas.kind, artifacts) ??
    artifacts.find((artifact) => artifact.role === "primary")
  );
}

export const create = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    title: v.string(),
    kind: v.union(v.literal("canvas"), v.literal("html"), v.literal("image"), v.literal("pdf")),
    slug: v.optional(v.string()),
    theme: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error(`Unknown workspace: ${args.workspaceId}`);

    const base = slugify(args.slug ?? args.title);
    let slug = base;
    let suffix = 2;
    while (
      await ctx.db
        .query("canvases")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", slug),
        )
        .unique()
    ) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }

    const now = Date.now();
    const canvasId = await ctx.db.insert("canvases", {
      workspaceId: args.workspaceId,
      slug,
      title: args.title,
      kind: args.kind,
      visibility: "private",
      theme: args.theme,
      createdBy: args.createdBy,
      updatedAt: now,
    });
    return { canvasId, slug };
  },
});

async function listCanvases(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const rows = (
    await ctx.db
      .query("canvases")
      .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .take(200)
  ).filter((c) => c.archivedAt === undefined);
  // Signed, time-limited URLs, resolved per row — this is what lights up
  // the gallery grid (PLAN.md section 8: "gallery with live-updating
  // thumbnails"), not just the single-canvas viewer's thumbnail_url.
  return Promise.all(
    rows.map(async (row) => ({
      ...toSummary(row),
      thumbnail_url: row.thumbnailId ? await ctx.storage.getUrl(row.thumbnailId) : null,
    })),
  );
}

async function getCanvas(ctx: QueryCtx, canvasId: Id<"canvases">) {
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) return null;
  let docStorageId: Id<"_storage"> | undefined;
  let entryStorageId: Id<"_storage"> | undefined;
  let cssStorageId: Id<"_storage"> | undefined;
  let version: number | undefined;
  let iframeRevisions: Record<string, string> | null = null;
  if (canvas.currentVersionId) {
    const currentVersionId = canvas.currentVersionId;
    const currentVersion = await ctx.db.get(currentVersionId);
    docStorageId = currentVersion?.docStorageId;
    entryStorageId = currentVersion?.entryStorageId;
    cssStorageId = currentVersion?.cssStorageId;
    version = currentVersion?.version;
    if (canvas.kind === "canvas") {
      const [files, assets] = await Promise.all([
        ctx.db
          .query("canvasVersionFiles")
          .withIndex("by_version_relPath", (q) => q.eq("versionId", currentVersionId))
          .take(500),
        ctx.db
          .query("canvasVersionAssets")
          .withIndex("by_version_path", (q) => q.eq("versionId", currentVersionId))
          .take(500),
      ]);
      const entrypoints = new Set(currentVersion?.iframeEntrypoints ?? []);
      const sharedResources = [
        ...files
          .filter(
            (file) =>
              (file.relPath.startsWith("/src/screens/") && !entrypoints.has(file.relPath)) ||
              file.relPath.startsWith("/assets/"),
          )
          .map((file) => `${file.relPath}:${file.contentHash}`),
        ...assets.map((asset) => `${asset.logicalPath}:${asset.assetVersionId}`),
      ];
      iframeRevisions = Object.fromEntries(
        [...entrypoints].map((entrypoint) => {
          const entrypointFile = files.find((file) => file.relPath === entrypoint);
          const manifest = [
            ...sharedResources,
            `${entrypoint}:${entrypointFile?.contentHash ?? "missing"}`,
          ]
            .sort()
            .join("\n");
          // Entry points get independent identities. Shared JS/CSS/assets are
          // conservative dependencies, but editing one screen HTML no longer
          // invalidates every iframe in the canvas.
          let hash = 2166136261;
          for (let index = 0; index < manifest.length; index += 1) {
            hash ^= manifest.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
          }
          return [entrypoint, `${manifest.length.toString(36)}-${(hash >>> 0).toString(36)}`];
        }),
      );
    }
  }
  const viewerArtifact = await getViewerArtifact(ctx, canvas);
  const viewerStorageId = viewerArtifact?.storageId ?? entryStorageId;
  // Signed, time-limited URLs — cheap to mint per query, never stored.
  // `doc_url` feeds the SPA's client-side canvas viewer (kind="canvas");
  // `entry_url` is the artifact matching the canvas kind. It is deliberately
  // independent from the primary artifact: an HTML canvas usually has a PNG
  // primary for its gallery thumbnail. `css_url` is the compiled Tailwind
  // stylesheet for the doc's HTML nodes (PLAN.md section 2), null when the
  // doc has no content.type='html' nodes.
  const docUrl = docStorageId ? await ctx.storage.getUrl(docStorageId) : null;
  const entryUrl = viewerStorageId ? await ctx.storage.getUrl(viewerStorageId) : null;
  const cssUrl = cssStorageId ? await ctx.storage.getUrl(cssStorageId) : null;
  const thumbnailUrl = canvas.thumbnailId ? await ctx.storage.getUrl(canvas.thumbnailId) : null;
  const artifactRows = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
    .take(500);
  return {
    ...toSummary(canvas),
    doc_storage_id: docStorageId,
    doc_url: docUrl,
    entry_url: entryUrl,
    entry_public_url: await publicEntryUrl(ctx, canvas, viewerStorageId),
    css_url: cssUrl,
    thumbnail_url: thumbnailUrl,
    artifacts: artifactRows.map((artifact) => ({
      path: artifact.relPath,
      type: artifact.type,
      role: artifact.role,
      mime_type: artifact.mimeType,
      size_bytes: artifact.size,
    })),
    iframe_revisions: iframeRevisions,
    version,
  };
}

/**
 * `entry_url` is a bare `/api/storage/<uuid>` URL, which is fine for a
 * self-contained page and useless for one with subresources: a relative
 * `../assets/logo.svg` resolves against `/api/`, not against the canvas, so
 * every image in a shared multi-asset page 404s. Served instead from
 * `/s/:slug/output/index.html`, the same relative reference lands on
 * `/s/:slug/assets/logo.svg`, which `resolvePublicArtifact` now answers.
 *
 * Public canvases only — the `/s/` endpoint is anonymous by design, so
 * there is nothing to point a private canvas's viewer at. Null there, and
 * the caller falls back to `entry_url`.
 */
async function publicEntryUrl(
  ctx: QueryCtx,
  canvas: Doc<"canvases">,
  entryStorageId: Id<"_storage"> | undefined,
): Promise<string | null> {
  if (canvas.visibility !== "public" || !canvas.publicSlug || !entryStorageId) return null;
  const site = process.env.CONVEX_SITE_URL;
  if (!site) return null;
  const artifact = await ctx.db
    .query("artifacts")
    .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
    .filter((q) => q.eq(q.field("storageId"), entryStorageId))
    .first();
  if (!artifact) return null;
  return `${site}/s/${canvas.publicSlug}${artifact.relPath}`;
}

async function publishCanvas(
  ctx: MutationCtx,
  args: {
    canvasId: Id<"canvases">;
    visibility: "private" | "public";
    newPublicSlug?: string;
  },
) {
  const canvas = await ctx.db.get(args.canvasId);
  if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

  if (args.visibility === "private") {
    await ctx.db.patch(args.canvasId, { visibility: "private", publicSlug: undefined });
    return { visibility: "private" as const, publicSlug: undefined };
  }

  const publicSlug = canvas.publicSlug ?? args.newPublicSlug;
  if (!publicSlug) {
    throw new Error("newPublicSlug is required the first time a canvas is published");
  }
  await ctx.db.patch(args.canvasId, { visibility: "public", publicSlug });
  return { visibility: "public" as const, publicSlug };
}

export const list = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => listCanvases(ctx, args.workspaceId),
});

export const get = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => getCanvas(ctx, args.canvasId),
});

export const publish = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    visibility: v.union(v.literal("private"), v.literal("public")),
    // A fresh 128-bit-random slug, generated by the caller (httpAction —
    // mutations should not mint their own randomness); ignored if the
    // canvas already has one.
    newPublicSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => publishCanvas(ctx, args),
});

// --- Public, SPA-facing (PLAN.md Part 1 section 1's `/w/:wsSlug`, `/c/:canvasId`) ---
// Reads are org-wide (decision #4: private = visible to all @iota.uz, and
// there's no ACL layer to further restrict who among them can see what) —
// these do not filter by `visibility`, unlike the anonymous `/s/:slug` path
// (PLAN.md Part 1 section 8), which is the only place `visibility` actually
// gates access.

export const listForWorkspace = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return listCanvases(ctx, args.workspaceId);
  },
});

export const getMine = query({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return getCanvas(ctx, args.canvasId);
  },
});

export const publishMine = mutation({
  args: {
    canvasId: v.id("canvases"),
    visibility: v.union(v.literal("private"), v.literal("public")),
  },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    // Minted here (not passed in by the client) so a signed-in user cannot
    // choose their own public slug.
    return publishCanvas(ctx, { ...args, newPublicSlug: randomPublicSlug() });
  },
});

// Replaces the old published slug with a fresh one in a single atomic patch
// (no unpublish -> publish round trip, which would leave a window where the
// canvas resolves as private). The old slug stops resolving the instant this
// commits, since `resolvePublicArtifact` looks up by exact `publicSlug`.
export const rotateMySlug = mutation({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);
    if (canvas.visibility !== "public") {
      throw new Error("Canvas must be public before its share link can be rotated");
    }
    const publicSlug = randomPublicSlug();
    await ctx.db.patch(args.canvasId, { publicSlug });
    return { publicSlug };
  },
});

// Version history for the Canvas page — every save creates a new
// canvasVersions row and old ones are never destroyed (decision #1), so this
// is a plain reverse-chronological list. Restoring one of these is
// restoreVersionMine (SPA) / restoreVersionByRef (MCP), below.
export const listVersionsMine = query({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) return [];

    const versions = await ctx.db
      .query("canvasVersions")
      .withIndex("by_canvas_version", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .take(50);

    return Promise.all(
      versions.map(async (v) => {
        const author = await ctx.db.get(v.createdBy);
        return {
          versionId: v._id,
          version: v.version,
          note: v.note,
          createdAt: v._creationTime,
          createdByEmail: author?.email ?? null,
          isCurrent: canvas.currentVersionId === v._id,
        };
      }),
    );
  },
});

// Cross-workspace search over canvas-kind node titles/eyebrows/inspector
// copy (PLAN.md section 4/9), backed by canvasNodes.search_text. Org-wide
// like the rest of the signed-in read surface (decision #4) — no canvasId
// filter, so a query can find the right canvas as well as the right node
// inside it. Only ever holds current-version rows (putDoc deletes the
// previous version's), so there's no per-node duplicate-across-history noise.
export const searchNodes = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const trimmed = args.query.trim();
    if (!trimmed) return [];

    const rows = await ctx.db
      .query("canvasNodes")
      .withSearchIndex("search_text", (q) => q.search("searchText", trimmed))
      .take(20);

    const results = await Promise.all(
      rows.map(async (row) => {
        const canvas = await ctx.db.get(row.canvasId);
        if (!canvas) return null;
        return {
          canvasId: row.canvasId,
          canvasTitle: canvas.title,
          workspaceId: canvas.workspaceId,
          nodeId: row.nodeId,
          nodeTitle: row.title,
          nodeEyebrow: row.eyebrow,
        };
      }),
    );
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

export const putDoc = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    docStorageId: v.id("_storage"),
    // Compiled Tailwind CSS for the doc's HTML nodes (PLAN.md section 2),
    // produced by the worker's /compile-css and stored by the caller before
    // this mutation runs — omitted when the doc has no content.type='html'
    // nodes, since there's nothing to compile.
    cssStorageId: v.optional(v.id("_storage")),
    entryStorageId: v.optional(v.id("_storage")),
    iframeEntrypoints: v.optional(v.array(v.string())),
    note: v.optional(v.string()),
    createdBy: v.id("users"),
    expectedVersion: v.optional(v.number()),
    nodes: v.array(
      v.object({
        nodeId: v.string(),
        title: v.string(),
        eyebrow: v.optional(v.string()),
        searchText: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const last = await ctx.db
      .query("canvasVersions")
      .withIndex("by_canvas_version", (q) => q.eq("canvasId", args.canvasId))
      .order("desc")
      .first();
    if (args.expectedVersion !== undefined && (last?.version ?? 0) !== args.expectedVersion) {
      throw new Error(
        `Canvas version conflict: expected ${args.expectedVersion}, current ${last?.version ?? 0}`,
      );
    }
    const version = (last?.version ?? 0) + 1;

    // canvasNodes exists only to back the search index and `?node=` lookups
    // against the *current* doc, unlike canvasVersions/artifacts (whose
    // history is deliberately kept forever). Deleting the previous version's
    // rows here keeps it that way — otherwise every doc save leaves
    // its old nodes behind, and search would return one stale duplicate per
    // past edit for every node that survived unchanged.
    if (last) {
      const staleNodes = await ctx.db
        .query("canvasNodes")
        .withIndex("by_version", (q) => q.eq("versionId", last._id))
        .collect();
      for (const node of staleNodes) {
        await ctx.db.delete(node._id);
      }
    }

    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      note: args.note,
      createdBy: args.createdBy,
      docStorageId: args.docStorageId,
      cssStorageId: args.cssStorageId,
      entryStorageId: args.entryStorageId,
      iframeEntrypoints: args.iframeEntrypoints,
    });

    const files = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .collect();
    for (const file of files) {
      await ctx.db.insert("canvasVersionFiles", {
        canvasId: args.canvasId,
        versionId,
        relPath: file.relPath,
        storageId: file.storageId,
        size: file.size,
        contentHash: file.contentHash,
      });
    }

    const assetBindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    for (const binding of assetBindings) {
      await ctx.db.insert("canvasVersionAssets", {
        canvasId: args.canvasId,
        versionId,
        logicalPath: binding.logicalPath,
        assetId: binding.assetId,
        assetVersionId: binding.assetVersionId,
      });
    }

    for (const node of args.nodes) {
      await ctx.db.insert("canvasNodes", { canvasId: args.canvasId, versionId, ...node });
    }

    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });
    return { versionId, version };
  },
});

/** Atomically binds one immutable asset revision and creates a canvas snapshot. */
export const bindAssetAndVersion = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    logicalPath: v.string(),
    assetId: v.id("assets"),
    assetVersionId: v.id("assetVersions"),
    expectedVersion: v.number(),
    createdBy: v.id("users"),
  },
  returns: v.object({ versionId: v.id("canvasVersions"), version: v.number(), path: v.string() }),
  handler: async (ctx, args) => {
    const normalized = normalizeCanvasPath(args.logicalPath, "write", "path").displayPath;
    if (!normalized.startsWith("/assets/"))
      throw new Error("Asset bindings must live under /assets/");
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas?.currentVersionId) throw new Error("Canvas has no current version");
    const current = await ctx.db.get(canvas.currentVersionId);
    if (!current || current.version !== args.expectedVersion) {
      throw new Error(
        `Canvas version conflict: expected ${args.expectedVersion}, current ${current?.version ?? 0}`,
      );
    }
    const asset = await ctx.db.get(args.assetId);
    const assetVersion = await ctx.db.get(args.assetVersionId);
    if (!asset || !assetVersion || assetVersion.assetId !== asset._id)
      throw new Error("Invalid asset revision");
    const existing = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) =>
        q.eq("canvasId", args.canvasId).eq("logicalPath", normalized),
      )
      .unique();
    if (existing)
      await ctx.db.patch(existing._id, { assetId: asset._id, assetVersionId: assetVersion._id });
    else
      await ctx.db.insert("canvasAssetBindings", {
        canvasId: args.canvasId,
        logicalPath: normalized,
        assetId: asset._id,
        assetVersionId: assetVersion._id,
      });
    const replacedFile = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) =>
        q.eq("canvasId", args.canvasId).eq("relPath", normalized),
      )
      .unique();
    if (replacedFile) {
      await ctx.db.delete(replacedFile._id);
      const stillReferenced = await isStorageReferenced(ctx, args.canvasId, replacedFile.storageId);
      if (!stillReferenced) {
        try {
          await ctx.storage.delete(replacedFile.storageId);
          await releaseCanvasStorage(ctx, args.canvasId, replacedFile.size);
        } catch {
          // The new asset binding remains the current path owner.
        }
      }
    }

    const version = current.version + 1;
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      note: `Asset: ${normalized}`,
      createdBy: args.createdBy,
      docStorageId: current.docStorageId,
      cssStorageId: current.cssStorageId,
      entryStorageId: current.entryStorageId,
      iframeEntrypoints: current.iframeEntrypoints,
    });
    const files = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    for (const file of files) {
      await ctx.db.insert("canvasVersionFiles", {
        canvasId: args.canvasId,
        versionId,
        relPath: file.relPath,
        storageId: file.storageId,
        size: file.size,
        contentHash: file.contentHash,
      });
    }
    const bindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    for (const binding of bindings) {
      await ctx.db.insert("canvasVersionAssets", {
        canvasId: args.canvasId,
        versionId,
        logicalPath: binding.logicalPath,
        assetId: binding.assetId,
        assetVersionId: binding.assetVersionId,
      });
    }
    const oldNodes = await ctx.db
      .query("canvasNodes")
      .withIndex("by_version", (q) => q.eq("versionId", current._id))
      .take(1000);
    for (const node of oldNodes) {
      await ctx.db.insert("canvasNodes", {
        canvasId: args.canvasId,
        versionId,
        nodeId: node.nodeId,
        title: node.title,
        eyebrow: node.eyebrow,
        searchText: node.searchText,
      });
      await ctx.db.delete(node._id);
    }
    await ctx.db.patch(canvas._id, { currentVersionId: versionId, updatedAt: Date.now() });
    return { versionId, version, path: normalized };
  },
});

export const upsertAssetBinding = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    logicalPath: v.string(),
    assetId: v.id("assets"),
    assetVersionId: v.id("assetVersions"),
  },
  returns: v.object({ path: v.string() }),
  handler: async (ctx, args) => {
    const path = normalizeCanvasPath(args.logicalPath, "write", "path").displayPath;
    if (!path.startsWith("/assets/")) throw new Error("Asset bindings must live under /assets/");
    const version = await ctx.db.get(args.assetVersionId);
    if (!version || version.assetId !== args.assetId) throw new Error("Invalid asset revision");
    const existing = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId).eq("logicalPath", path))
      .unique();
    if (existing)
      await ctx.db.patch(existing._id, {
        assetId: args.assetId,
        assetVersionId: args.assetVersionId,
      });
    else
      await ctx.db.insert("canvasAssetBindings", {
        canvasId: args.canvasId,
        logicalPath: path,
        assetId: args.assetId,
        assetVersionId: args.assetVersionId,
      });
    const replacedFile = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId).eq("relPath", path))
      .unique();
    if (replacedFile) {
      await ctx.db.delete(replacedFile._id);
      const stillReferenced = await isStorageReferenced(ctx, args.canvasId, replacedFile.storageId);
      if (!stillReferenced) {
        try {
          await ctx.storage.delete(replacedFile.storageId);
          await releaseCanvasStorage(ctx, args.canvasId, replacedFile.size);
        } catch {
          // The binding is authoritative even when an already-missing old blob cannot be reclaimed.
        }
      }
    }
    return { path };
  },
});

export const removeAssetBinding = internalMutation({
  args: { canvasId: v.id("canvases"), logicalPath: v.string() },
  returns: v.object({ removed: v.boolean() }),
  handler: async (ctx, args) => {
    const path = normalizeCanvasPath(args.logicalPath, "write", "path").displayPath;
    const existing = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId).eq("logicalPath", path))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { removed: Boolean(existing) };
  },
});

export const listAssetBindingPaths = internalQuery({
  args: { canvasId: v.id("canvases") },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const bindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    return bindings.map((binding) => binding.logicalPath);
  },
});

export const listAssetSourcesForCanvas = internalQuery({
  args: { canvasId: v.id("canvases") },
  returns: v.array(
    v.object({
      relPath: v.string(),
      objectKey: v.string(),
      size: v.number(),
      mimeType: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const bindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    const sources = [];
    for (const binding of bindings) {
      const version = await ctx.db.get(binding.assetVersionId);
      if (!version) continue;
      sources.push({
        relPath: binding.logicalPath,
        objectKey: version.deliveryObjectKey,
        size: version.size,
        mimeType: version.mimeType,
      });
    }
    return sources;
  },
});

export const getEditableFileByRef = internalQuery({
  args: { ref: v.string(), path: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      canvasId: v.id("canvases"),
      version: v.number(),
      kind: KindValidator,
      path: v.string(),
      size: v.number(),
      contentHash: v.string(),
      fileUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    if (!canvas?.currentVersionId || canvas.archivedAt !== undefined) return null;
    const version = await ctx.db.get(canvas.currentVersionId);
    if (!version) return null;
    const path = normalizeCanvasPath(args.path, "write", "path").displayPath;
    const file = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id).eq("relPath", path))
      .unique();
    if (!file) return null;
    const fileUrl = await ctx.storage.getUrl(file.storageId);
    if (!fileUrl) throw new Error("File blob is unavailable");
    return {
      canvasId: canvas._id,
      version: version.version,
      kind: canvas.kind,
      path,
      size: file.size,
      contentHash: file.contentHash,
      fileUrl,
    };
  },
});

export const commitFilePatch = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    expectedVersion: v.number(),
    changes: v.array(
      v.union(
        v.object({
          type: v.literal("write"),
          path: v.string(),
          expectedHash: v.optional(v.string()),
          storageId: v.id("_storage"),
          size: v.number(),
          contentHash: v.string(),
        }),
        v.object({
          type: v.literal("delete"),
          path: v.string(),
          expectedHash: v.string(),
        }),
        v.object({
          type: v.literal("move"),
          path: v.string(),
          toPath: v.string(),
          expectedHash: v.string(),
        }),
      ),
    ),
    createdBy: v.id("users"),
    note: v.optional(v.string()),
  },
  returns: v.object({ versionId: v.id("canvasVersions"), version: v.number() }),
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas?.currentVersionId) throw new Error("Canvas has no current version");
    const current = await ctx.db.get(canvas.currentVersionId);
    if (!current || current.version !== args.expectedVersion) {
      throw new Error(
        `Canvas version conflict: expected ${args.expectedVersion}, current ${current?.version ?? 0}`,
      );
    }
    if (args.changes.length === 0) throw new Error("Patch has no file changes");
    const paths = new Set<string>();
    for (const change of args.changes) {
      const path = normalizeCanvasPath(change.path, "write", "path").displayPath;
      if (paths.has(path)) throw new Error(`Patch changes ${path} more than once`);
      paths.add(path);
      const file = await ctx.db
        .query("canvasFiles")
        .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId).eq("relPath", path))
        .unique();
      if (change.type === "write") {
        if (change.expectedHash === undefined && file)
          throw new Error(`File already exists: ${path}`);
        if (change.expectedHash !== undefined && !file) throw new Error(`File not found: ${path}`);
        if (file && file.contentHash !== change.expectedHash) {
          throw new Error(
            `File hash conflict for ${path}: expected ${change.expectedHash}, current ${file.contentHash}`,
          );
        }
      } else {
        if (!file) throw new Error(`File not found: ${path}`);
        if (file.contentHash !== change.expectedHash) {
          throw new Error(
            `File hash conflict for ${path}: expected ${change.expectedHash}, current ${file.contentHash}`,
          );
        }
        if (change.type === "move") {
          const toPath = normalizeCanvasPath(change.toPath, "write", "toPath").displayPath;
          if (paths.has(toPath)) throw new Error(`Patch target conflicts at ${toPath}`);
          const target = await ctx.db
            .query("canvasFiles")
            .withIndex("by_canvas_relPath", (q) =>
              q.eq("canvasId", args.canvasId).eq("relPath", toPath),
            )
            .unique();
          if (target) throw new Error(`Move target already exists: ${toPath}`);
        }
      }
    }
    const incomingBytes = args.changes.reduce(
      (total, change) => total + (change.type === "write" ? change.size : 0),
      0,
    );
    if (incomingBytes > 0) await reserveCanvasStorage(ctx, args.canvasId, incomingBytes);
    for (const change of args.changes) {
      const path = normalizeCanvasPath(change.path, "write", "path").displayPath;
      const file = await ctx.db
        .query("canvasFiles")
        .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId).eq("relPath", path))
        .unique();
      if (change.type === "write") {
        if (file) {
          await ctx.db.patch(file._id, {
            storageId: change.storageId,
            size: change.size,
            contentHash: change.contentHash,
          });
        } else {
          await ctx.db.insert("canvasFiles", {
            canvasId: args.canvasId,
            relPath: path,
            storageId: change.storageId,
            size: change.size,
            contentHash: change.contentHash,
          });
        }
      } else if (change.type === "delete") {
        if (file) await ctx.db.delete(file._id);
      } else if (file) {
        const toPath = normalizeCanvasPath(change.toPath, "write", "toPath").displayPath;
        await ctx.db.patch(file._id, { relPath: toPath });
      }
    }
    const version = current.version + 1;
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      note: args.note ?? `Edit ${args.changes.length} file${args.changes.length === 1 ? "" : "s"}`,
      createdBy: args.createdBy,
      docStorageId: current.docStorageId,
      cssStorageId: current.cssStorageId,
      entryStorageId: current.entryStorageId,
      iframeEntrypoints: current.iframeEntrypoints,
    });
    const files = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    for (const currentFile of files) {
      await ctx.db.insert("canvasVersionFiles", {
        canvasId: args.canvasId,
        versionId,
        relPath: currentFile.relPath,
        storageId: currentFile.storageId,
        size: currentFile.size,
        contentHash: currentFile.contentHash,
      });
    }
    const bindings = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    for (const binding of bindings) {
      await ctx.db.insert("canvasVersionAssets", {
        canvasId: args.canvasId,
        versionId,
        logicalPath: binding.logicalPath,
        assetId: binding.assetId,
        assetVersionId: binding.assetVersionId,
      });
    }
    const oldNodes = await ctx.db
      .query("canvasNodes")
      .withIndex("by_version", (q) => q.eq("versionId", current._id))
      .take(1000);
    for (const node of oldNodes) {
      await ctx.db.insert("canvasNodes", {
        canvasId: args.canvasId,
        versionId,
        nodeId: node.nodeId,
        title: node.title,
        eyebrow: node.eyebrow,
        searchText: node.searchText,
      });
      await ctx.db.delete(node._id);
    }
    await ctx.db.patch(canvas._id, { currentVersionId: versionId, updatedAt: Date.now() });
    return { versionId, version };
  },
});

export const getLayoutPatchSource = internalQuery({
  args: { canvasId: v.id("canvases"), subject: v.string() },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas?.currentVersionId) throw new Error("Canvas has no current version");
    const current = await ctx.db.get(canvas.currentVersionId);
    if (!current?.docStorageId) throw new Error("Canvas has no CanvasDoc");
    const authUserId = args.subject.includes("|") ? args.subject.split("|")[0] : null;
    const normalizedUserId = authUserId ? ctx.db.normalizeId("users", authUserId) : null;
    const user = normalizedUserId
      ? await ctx.db.get(normalizedUserId)
      : await ctx.db
          .query("users")
          .withIndex("by_googleSub", (q) => q.eq("googleSub", args.subject))
          .unique();
    if (!user) throw new Error("Signed-in user record not found");
    const docUrl = await ctx.storage.getUrl(current.docStorageId);
    if (!docUrl) throw new Error("CanvasDoc storage object is unavailable");
    return {
      docUrl,
      version: current.version,
      cssStorageId: current.cssStorageId,
      iframeEntrypoints: current.iframeEntrypoints,
      userId: user._id,
    };
  },
});

/** Signed-in layout editing: one optimistic rect patch creates one immutable v2 version. */
export const patchNodeRectMine = action({
  args: {
    canvasId: v.id("canvases"),
    nodeId: v.string(),
    rect: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args): Promise<{ version: number }> => {
    const identity = await requireIotaIdentity(ctx);
    const source = await ctx.runQuery(internal.canvases.getLayoutPatchSource, {
      canvasId: args.canvasId,
      subject: identity.subject,
    });
    if (source.version !== args.expectedVersion) {
      throw new Error(
        `Canvas version conflict: expected ${args.expectedVersion}, current ${source.version}`,
      );
    }
    const rect = RectSchema.parse(args.rect);
    const response = await fetch(source.docUrl);
    if (!response.ok) throw new Error(`Unable to load CanvasDoc: HTTP ${response.status}`);
    const doc = CanvasDocSchema.parse(await response.json());
    const nodeIndex = doc.nodes.findIndex((node) => node.id === args.nodeId);
    if (nodeIndex < 0) throw new Error(`Unknown canvas node: ${args.nodeId}`);
    const nodes = doc.nodes.map((node, index) =>
      index === nodeIndex ? { ...node, rect: { ...rect } } : node,
    );
    const patched = CanvasDocSchema.parse({ ...doc, nodes });
    const bytes = new TextEncoder().encode(JSON.stringify(patched));
    const docStorageId = await ctx.storage.store(new Blob([bytes], { type: "application/json" }));
    const entryBytes = new TextEncoder().encode(renderCanvasEntry(patched));
    const entryStorageId = await ctx.storage.store(new Blob([entryBytes], { type: "text/html" }));
    try {
      const result = await ctx.runMutation(internal.canvases.putDoc, {
        canvasId: args.canvasId,
        docStorageId,
        entryStorageId,
        cssStorageId: source.cssStorageId,
        iframeEntrypoints: source.iframeEntrypoints,
        expectedVersion: args.expectedVersion,
        note: `Layout: ${args.nodeId}`,
        createdBy: source.userId,
        nodes: patched.nodes.map((node) => ({
          nodeId: node.id,
          title: node.caption.title,
          eyebrow: node.inspector?.eyebrow ?? node.caption.tag,
          searchText: [
            node.caption.title,
            node.caption.subtitle,
            node.caption.tag,
            node.inspector?.eyebrow,
            node.inspector?.title,
            node.inspector?.copy,
          ]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join(" "),
        })),
      });
      return { version: result.version };
    } catch (error) {
      await ctx.storage.delete(docStorageId);
      await ctx.storage.delete(entryStorageId);
      throw error;
    }
  },
});

/**
 * Attaches a server-side render's PNG + thumbnail to a version a doc save
 * already created (PLAN.md section 9 C1: "server-side render -> thumbnail +
 * PNG/PDF export... come for free"). Deliberately does NOT insert a new
 * canvasVersions row or touch currentVersionId — unlike recordRender (which
 * backs an explicit `renders` entry, producing its own version), this
 * is a best-effort side-render of a doc version that already exists; giving
 * it its own version would leave that version with no docStorageId and break
 * the SPA viewer (getCanvas resolves doc_url from the *current* version).
 * The produced artifact is "supporting", not "primary" — kind="canvas"'s
 * primary content is the doc itself, not a PNG snapshot of it, and
 * `/s/:slug` (which serves the primary artifact) is not wired for
 * kind="canvas" canvases yet (a separate, documented gap).
 */
export const attachCanvasRender = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    relPath: v.string(),
    type: ArtifactTypeValidator,
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const artifact = await upsertArtifact(
      ctx,
      args.canvasId,
      args.versionId,
      {
        relPath: args.relPath,
        type: args.type,
        mimeType: args.mimeType,
        size: args.size,
        storageId: args.storageId,
      },
      { forceRole: "supporting" },
    );

    // Unlike recordRender's thumbnail policy (attachThumbnailIfPrimary,
    // gated on role === "primary"), this thumbnail is always attached: it's
    // exactly what the doc currently looks like, regardless of the PNG
    // artifact's (always "supporting") role.
    if (args.thumbnailStorageId) {
      await setCanvasThumbnail(ctx, args.canvasId, args.thumbnailStorageId);
    }

    return { artifact };
  },
});

export const currentVersion = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas?.currentVersionId) return null;
    const version = await ctx.db.get(canvas.currentVersionId);
    return version ? { versionId: version._id, version: version.version } : null;
  },
});

const SnapshotContextValidator = v.union(
  v.null(),
  v.object({
    canvasId: v.id("canvases"),
    kind: KindValidator,
    versionId: v.id("canvasVersions"),
    version: v.number(),
    docStorageId: v.optional(v.id("_storage")),
    cssStorageId: v.optional(v.id("_storage")),
    entryStorageId: v.optional(v.id("_storage")),
    files: v.array(
      v.object({ relPath: v.string(), storageId: v.id("_storage"), size: v.number() }),
    ),
    assets: v.array(
      v.object({
        relPath: v.string(),
        objectKey: v.string(),
        size: v.number(),
        mimeType: v.string(),
      }),
    ),
  }),
);

/** Resolves one current version and its immutable source manifest atomically. */
export const snapshotContextByRef = internalQuery({
  args: { ref: v.string() },
  returns: SnapshotContextValidator,
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    if (!canvas?.currentVersionId || canvas.archivedAt !== undefined) return null;
    const version = await ctx.db.get(canvas.currentVersionId);
    if (!version) return null;
    const [files, bindings] = await Promise.all([
      ctx.db
        .query("canvasVersionFiles")
        .withIndex("by_version_relPath", (q) => q.eq("versionId", version._id))
        .take(500),
      ctx.db
        .query("canvasVersionAssets")
        .withIndex("by_version_path", (q) => q.eq("versionId", version._id))
        .take(500),
    ]);
    const assets = [];
    for (const binding of bindings) {
      const assetVersion = await ctx.db.get(binding.assetVersionId);
      if (!assetVersion) continue;
      assets.push({
        relPath: binding.logicalPath,
        objectKey: assetVersion.deliveryObjectKey,
        size: assetVersion.size,
        mimeType: assetVersion.mimeType,
      });
    }
    return {
      canvasId: canvas._id,
      kind: canvas.kind,
      versionId: version._id,
      version: version.version,
      docStorageId: version.docStorageId,
      cssStorageId: version.cssStorageId,
      entryStorageId: version.entryStorageId,
      files: [
        ...files
          .filter((file) => file.relPath !== "/src/__canvas.html")
          .map((file) => ({ relPath: file.relPath, storageId: file.storageId, size: file.size })),
        ...(version.entryStorageId
          ? [{ relPath: "/src/__canvas.html", storageId: version.entryStorageId, size: 0 }]
          : []),
      ],
      assets,
    };
  },
});

const SnapshotCacheValidator = v.union(
  v.null(),
  v.object({
    storageId: v.id("_storage"),
    mimeType: v.literal("image/png"),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial")),
    warnings: v.array(v.string()),
  }),
);

export const getSnapshotCache = internalQuery({
  args: { versionId: v.id("canvasVersions"), cacheKey: v.string(), now: v.number() },
  returns: SnapshotCacheValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvasSnapshots")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .order("desc")
      .first();
    if (!row || row.createdAt <= args.now - CACHE_TTL_MS) return null;
    return {
      storageId: row.storageId,
      mimeType: row.mimeType,
      size: row.size,
      width: row.width,
      height: row.height,
      status: row.status,
      warnings: row.warnings,
    };
  },
});

export const putSnapshotCache = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    cacheKey: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial")),
    warnings: v.array(v.string()),
  },
  returns: v.object({
    storageId: v.id("_storage"),
    mimeType: v.literal("image/png"),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial")),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("canvasSnapshots")
      .withIndex("by_version_cacheKey", (q) =>
        q.eq("versionId", args.versionId).eq("cacheKey", args.cacheKey),
      )
      .first();
    if (existing && existing.createdAt > Date.now() - CACHE_TTL_MS) {
      // Concurrent identical captures race only until this transaction. Keep
      // the first immutable blob and discard the redundant upload.
      await ctx.storage.delete(args.storageId).catch(() => undefined);
      return {
        storageId: existing.storageId,
        mimeType: existing.mimeType,
        size: existing.size,
        width: existing.width,
        height: existing.height,
        status: existing.status,
        warnings: existing.warnings,
      };
    }
    if (existing) {
      await ctx.storage.delete(existing.storageId).catch(() => undefined);
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert("canvasSnapshots", {
      ...args,
      mimeType: "image/png",
      createdAt: Date.now(),
    });
    return {
      storageId: args.storageId,
      mimeType: "image/png" as const,
      size: args.size,
      width: args.width,
      height: args.height,
      status: args.status,
      warnings: args.warnings,
    };
  },
});

export const upsertFile = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    relPath: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const existing = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) =>
        q.eq("canvasId", args.canvasId).eq("relPath", args.relPath),
      )
      .unique();

    const replacedBinding = await ctx.db
      .query("canvasAssetBindings")
      .withIndex("by_canvas_path", (q) =>
        q.eq("canvasId", args.canvasId).eq("logicalPath", args.relPath),
      )
      .unique();
    if (replacedBinding) await ctx.db.delete(replacedBinding._id);

    // Re-declaring the identical blob at the identical path (a retried
    // canvas_save replaying its upload_ids) must not charge the quota twice
    // for bytes that were already charged and are still the same bytes.
    if (existing?.storageId !== args.storageId) {
      await reserveCanvasStorage(ctx, args.canvasId, args.size);
    }

    if (existing) {
      const supersededId = existing.storageId;
      const supersededSize = existing.size;
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        size: args.size,
        contentHash: args.contentHash,
      });
      // Overwriting a source file used to drop the old storageId on the
      // floor: the blob stayed alive forever, unreferenced and invisible,
      // and its bytes stayed charged against the 250MB quota with no way to
      // get them back — so an agent iterating on one file could exhaust the
      // canvas by re-saving it. Source files are *inputs*, not versioned
      // artifacts (renders and docs are what version history tracks), so the
      // superseded blob is genuinely garbage once replaced. Guarded because
      // `recordRender` can share one blob between a file row and a version's
      // entryStorageId, in which case history still needs it.
      if (supersededId !== args.storageId) {
        const stillReferenced = await isStorageReferenced(ctx, args.canvasId, supersededId);
        if (!stillReferenced) {
          try {
            await ctx.storage.delete(supersededId);
            await releaseCanvasStorage(ctx, args.canvasId, supersededSize);
          } catch {
            // Blob already gone; the row now points at the new one either way.
          }
        }
      }
    } else {
      await ctx.db.insert("canvasFiles", {
        canvasId: args.canvasId,
        relPath: args.relPath,
        storageId: args.storageId,
        size: args.size,
        contentHash: args.contentHash,
      });
    }
    await ctx.db.patch(args.canvasId, { updatedAt: Date.now() });
  },
});

export const listArtifactsForCanvas = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    return rows.map((a) => ({ path: a.relPath, type: a.type, role: a.role }));
  },
});

export const getArtifact = internalQuery({
  args: { canvasId: v.id("canvases"), relPath: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("artifacts")
      .withIndex("by_canvas_relPath", (q) =>
        q.eq("canvasId", args.canvasId).eq("relPath", args.relPath),
      )
      .unique();
    if (!row) return null;
    return {
      path: row.relPath,
      type: row.type,
      role: row.role,
      mimeType: row.mimeType,
      size: row.size,
      storageId: row.storageId,
    };
  },
});

// Backs the anonymous `/s/:slug[/*]` httpAction (PLAN.md Part 1 section 8) —
// the only place `visibility` actually gates access (every other read in
// this file is org-wide per decision #4). Returns null for both an unknown
// slug and a since-unpublished one — `publish`/`publishCanvas` clears
// `publicSlug` on unpublish, so those two cases already collapse to "no row
// matches the index" without any extra check here, which is what keeps this
// from leaking "it exists but is private" to an anonymous caller.
export const resolvePublicArtifact = internalQuery({
  args: { publicSlug: v.string(), relPath: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (canvas?.visibility !== "public") return null;

    let row: Doc<"artifacts"> | null;
    if (args.relPath) {
      row = await ctx.db
        .query("artifacts")
        .withIndex("by_canvas_relPath", (q) =>
          q.eq("canvasId", canvas._id).eq("relPath", args.relPath as string),
        )
        .unique();
    } else {
      const artifacts = await ctx.db
        .query("artifacts")
        .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
        .take(500);
      row =
        selectViewerArtifact(canvas.kind, artifacts) ??
        artifacts.find((artifact) => artifact.role === "primary") ??
        null;
    }

    // CanvasDoc v2 screens and assets resolve only through the current
    // version snapshot. HTML is served only when registered by an iframe node.
    if (!row && args.relPath && canvas.kind === "canvas" && canvas.currentVersionId) {
      const currentVersionId = canvas.currentVersionId;
      const relPath = args.relPath;
      const version = await ctx.db.get(currentVersionId);
      const isEntrypoint =
        args.relPath.startsWith("/src/screens/") &&
        version?.iframeEntrypoints?.includes(args.relPath);
      const isAsset =
        args.relPath.startsWith("/assets/") ||
        args.relPath.startsWith("/src/screens/assets/") ||
        /\.(css|js|mjs|png|jpe?g|svg|webp|woff2?|ttf)$/i.test(args.relPath);
      if (isEntrypoint || isAsset) {
        const file = await ctx.db
          .query("canvasVersionFiles")
          .withIndex("by_version_relPath", (q) =>
            q.eq("versionId", currentVersionId).eq("relPath", relPath),
          )
          .unique();
        if (file) {
          const { type, mime } = classifyAssetPath(file.relPath);
          return {
            relPath: file.relPath,
            type,
            mimeType: mime,
            size: file.size,
            storageId: file.storageId,
            iframe: isEntrypoint,
          };
        }
        if (args.relPath.startsWith("/assets/")) {
          const binding = await ctx.db
            .query("canvasVersionAssets")
            .withIndex("by_version_path", (q) =>
              q.eq("versionId", currentVersionId).eq("logicalPath", relPath),
            )
            .unique();
          if (binding) {
            const assetVersion = await ctx.db.get(binding.assetVersionId);
            if (assetVersion) {
              return {
                relPath,
                type:
                  assetVersion.mimeType === "image/svg+xml" ? ("svg" as const) : ("image" as const),
                mimeType: assetVersion.mimeType,
                size: assetVersion.size,
                objectKey: assetVersion.deliveryObjectKey,
                libraryAsset: true,
                iframe: false,
              };
            }
          }
        }
      }
    }

    // Fall back to the canvas's own /assets. A shared HTML artifact is a
    // page, and a page has subresources: `<img src="../assets/logo.svg">`
    // renders correctly in the worker (which hydrates every canvasFile) and
    // then 404s for the reader, because artifacts were the only thing this
    // endpoint could serve. Deliberately scoped to /assets — /src holds the
    // author's sources, and publishing those with the render was never part
    // of what "public" means here.
    if (!row && args.relPath?.startsWith("/assets/")) {
      const file = await ctx.db
        .query("canvasFiles")
        .withIndex("by_canvas_relPath", (q) =>
          q.eq("canvasId", canvas._id).eq("relPath", args.relPath as string),
        )
        .unique();
      if (!file) return null;
      const { type, mime } = classifyAssetPath(file.relPath);
      return {
        relPath: file.relPath,
        type,
        mimeType: mime,
        size: file.size,
        storageId: file.storageId,
      };
    }
    if (!row) return null;

    return {
      relPath: row.relPath,
      type: row.type,
      mimeType: row.mimeType,
      size: row.size,
      storageId: row.storageId,
    };
  },
});

const PublicEmbedTargetValidator = v.union(
  v.literal("canvas"),
  v.literal("node"),
  v.literal("artifact"),
);

const PublicEmbedCardValidator = v.object({
  canvasTitle: v.string(),
  canvasKind: KindValidator,
  version: v.number(),
  updatedAt: v.number(),
  targetKind: PublicEmbedTargetValidator,
  targetLabel: v.string(),
  targetDetail: v.string(),
  previewStorageId: v.optional(v.id("_storage")),
});

const PublicSocialMetadataValidator = v.object({
  title: v.string(),
  description: v.string(),
  version: v.number(),
  updatedAt: v.number(),
  thumbnailStorageId: v.optional(v.id("_storage")),
});

/** Minimal anonymous metadata used by the web origin's crawler-facing HTML. */
export const resolvePublicSocialMetadata = internalQuery({
  args: { publicSlug: v.string() },
  returns: v.union(v.null(), PublicSocialMetadataValidator),
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (canvas?.visibility !== "public" || canvas.archivedAt !== undefined) return null;
    const version = canvas.currentVersionId ? await ctx.db.get(canvas.currentVersionId) : null;
    if (!version) return null;
    return {
      title: canvas.title,
      description: canvas.description?.trim() || "A visual canvas shared from Visual Canvas.",
      version: version.version,
      updatedAt: canvas.updatedAt,
      thumbnailStorageId: canvas.thumbnailId,
    };
  },
});

/**
 * Metadata for the static image card used by GitHub/Markdown. This is not a
 * second viewer: the card is only an image, and its surrounding Markdown
 * link points at the existing public share page (or the public artifact).
 *
 * A `version` query pins the text/node lookup to an immutable CanvasDoc
 * version. The canvas thumbnail is intentionally used only while that
 * version is current because thumbnails are not version snapshots; after a
 * later save, the endpoint keeps returning an honest branded card instead
 * of putting the new screenshot under an old version label.
 */
export const resolvePublicEmbedCard = internalQuery({
  args: {
    publicSlug: v.string(),
    target: PublicEmbedTargetValidator,
    targetId: v.optional(v.string()),
    version: v.optional(v.number()),
  },
  returns: v.union(v.null(), PublicEmbedCardValidator),
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (canvas?.visibility !== "public") return null;

    const version = args.version
      ? await ctx.db
          .query("canvasVersions")
          .withIndex("by_canvas_version", (q) =>
            q.eq("canvasId", canvas._id).eq("version", args.version as number),
          )
          .unique()
      : canvas.currentVersionId
        ? await ctx.db.get(canvas.currentVersionId)
        : null;
    if (!version) return null;

    const isCurrent = version._id === canvas.currentVersionId;
    let targetLabel = canvas.title;
    let targetDetail = `${canvas.kind} canvas`;
    let previewStorageId = isCurrent ? canvas.thumbnailId : undefined;

    if (args.target === "node") {
      if (!args.targetId || canvas.kind !== "canvas") return null;
      const nodes = await ctx.db
        .query("canvasNodes")
        .withIndex("by_version", (q) => q.eq("versionId", version._id))
        .take(1_000);
      const node = nodes.find((entry) => entry.nodeId === args.targetId);
      if (!node) return null;
      targetLabel = node.title;
      targetDetail = node.eyebrow ? `${node.eyebrow} · canvas screen` : "Canvas screen";
    } else if (args.target === "artifact") {
      if (!args.targetId?.startsWith("/")) return null;
      const artifact = await ctx.db
        .query("artifacts")
        .withIndex("by_canvas_relPath", (q) =>
          q.eq("canvasId", canvas._id).eq("relPath", args.targetId as string),
        )
        .unique();
      // Current/latest links must name a real public artifact. A pinned URL
      // may outlive the mutable current artifact row, so its safe path label
      // remains renderable even after a newer version replaces that row.
      if (!artifact && !args.version) return null;
      const filename = args.targetId.split("/").filter(Boolean).pop() ?? "Artifact";
      targetLabel = filename;
      targetDetail = artifact
        ? `${artifact.type.toUpperCase()} · ${artifact.role}`
        : "Pinned artifact";
      if (artifact && isCurrent && artifact.type === "image") {
        previewStorageId = artifact.storageId;
      } else if (!isCurrent) {
        previewStorageId = undefined;
      }
    }

    return {
      canvasTitle: canvas.title,
      canvasKind: canvas.kind,
      version: version.version,
      updatedAt: canvas.updatedAt,
      targetKind: args.target,
      targetLabel,
      targetDetail,
      previewStorageId,
    };
  },
});

/**
 * `canvasFiles` rows carry no mime type — they are inputs, not artifacts, and
 * nothing needed one until /assets became publicly servable. Extension-based
 * because that is all the row has, and `x-content-type-options: nosniff` on
 * the response means a wrong guess fails closed rather than being sniffed
 * into something executable.
 */
function classifyAssetPath(relPath: string): {
  type: "pdf" | "image" | "svg" | "source";
  mime: string;
} {
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return { type: "image", mime: "image/png" };
    case "jpg":
    case "jpeg":
      return { type: "image", mime: "image/jpeg" };
    case "gif":
      return { type: "image", mime: "image/gif" };
    case "webp":
      return { type: "image", mime: "image/webp" };
    case "avif":
      return { type: "image", mime: "image/avif" };
    case "ico":
      return { type: "image", mime: "image/x-icon" };
    case "svg":
      return { type: "svg", mime: "image/svg+xml" };
    case "pdf":
      return { type: "pdf", mime: "application/pdf" };
    case "css":
      return { type: "source", mime: "text/css" };
    case "html":
    case "htm":
      return { type: "source", mime: "text/html; charset=utf-8" };
    case "js":
    case "mjs":
      return { type: "source", mime: "text/javascript; charset=utf-8" };
    case "woff2":
      return { type: "source", mime: "font/woff2" };
    case "woff":
      return { type: "source", mime: "font/woff" };
    case "ttf":
      return { type: "source", mime: "font/ttf" };
    case "otf":
      return { type: "source", mime: "font/otf" };
    default:
      return { type: "source", mime: "application/octet-stream" };
  }
}

// Anonymous, SPA-facing counterpart to `getMine` (PLAN.md Part 1 section 1's
// `/s/:slug` public viewer route) — kind="canvas" documents render on the
// app origin (section 8), so unlike `resolvePublicArtifact` this is a plain
// query the client calls directly, not an httpAction. Keyed on the
// unguessable slug alone; never accepts a canvasId, since the slug itself
// is the access control. Returns null for both "no such slug" and "exists
// but private" so neither leaks to an anonymous caller.
export const getPublic = query({
  args: { publicSlug: v.string() },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvases")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.publicSlug))
      .unique();
    if (canvas?.visibility !== "public") return null;
    return getCanvas(ctx, canvas._id);
  },
});

export const mintIframeCapabilityMine = mutation({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const sessionUserId = identity.subject.includes("|")
      ? (identity.subject.split("|")[0] as Id<"users">)
      : undefined;
    const user = sessionUserId
      ? await ctx.db.get(sessionUserId)
      : await ctx.db
          .query("users")
          .withIndex("by_googleSub", (q) => q.eq("googleSub", identity.subject))
          .unique();
    if (!user) throw new Error("Signed-in user record not found");
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas?.currentVersionId) throw new Error("Canvas has no current version");
    const token = randomPublicSlug() + randomPublicSlug();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await ctx.db.insert("iframeCapabilities", {
      token,
      canvasId: canvas._id,
      versionId: canvas.currentVersionId,
      userId: user._id,
      expiresAt,
    });
    return { token, version: (await ctx.db.get(canvas.currentVersionId))?.version, expiresAt };
  },
});

export const resolveIframeCapability = internalQuery({
  args: { token: v.string(), relPath: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const capability = await ctx.db
      .query("iframeCapabilities")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!capability || capability.expiresAt <= args.now) return null;
    const canvas = await ctx.db.get(capability.canvasId);
    // Capabilities are already bound to an immutable version snapshot and
    // expire quickly. A newer current version must not break screens that
    // are still resident in a live viewer; it only causes the client to mint
    // a new capability when the iframe resource manifest actually changes.
    if (!canvas || canvas.archivedAt !== undefined) return null;
    const version = await ctx.db.get(capability.versionId);
    const allowed =
      (args.relPath.startsWith("/src/screens/") &&
        version?.iframeEntrypoints?.includes(args.relPath)) ||
      args.relPath.startsWith("/assets/") ||
      /\.(css|js|mjs|png|jpe?g|svg|webp|woff2?|ttf)$/i.test(args.relPath);
    if (!allowed) return null;
    const file = await ctx.db
      .query("canvasVersionFiles")
      .withIndex("by_version_relPath", (q) =>
        q.eq("versionId", capability.versionId).eq("relPath", args.relPath),
      )
      .unique();
    if (!file && args.relPath.startsWith("/assets/")) {
      const binding = await ctx.db
        .query("canvasVersionAssets")
        .withIndex("by_version_path", (q) =>
          q.eq("versionId", capability.versionId).eq("logicalPath", args.relPath),
        )
        .unique();
      if (!binding) return null;
      const assetVersion = await ctx.db.get(binding.assetVersionId);
      if (!assetVersion) return null;
      return {
        objectKey: assetVersion.deliveryObjectKey,
        size: assetVersion.size,
        relPath: args.relPath,
        mimeType: assetVersion.mimeType,
        iframe: false,
        libraryAsset: true,
      };
    }
    if (!file) return null;
    const classified = classifyAssetPath(file.relPath);
    return {
      storageId: file.storageId,
      size: file.size,
      relPath: file.relPath,
      mimeType: classified.mime,
      iframe: version?.iframeEntrypoints?.includes(args.relPath) ?? false,
    };
  },
});

export const listFilesForCanvas = internalQuery({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("canvasFiles")
      .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", args.canvasId))
      .take(500);
    return rows.map((f) => ({
      relPath: f.relPath,
      storageId: f.storageId,
      size: f.size,
      contentHash: f.contentHash,
    }));
  },
});

/**
 * Records one `canvas_save` render: a new canvasVersions row (entryStorageId —
 * "kind=canvas" uses docStorageId instead, per PLAN.md section 4) plus the
 * produced artifact, atomically. "Claude re-rendering creates a new
 * version, never destroys the old one" (PLAN.md section 1) applies to every
 * canvas kind, not just kind="canvas".
 */
export const recordRender = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    createdBy: v.id("users"),
    relPath: v.string(),
    type: ArtifactTypeValidator,
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    // Only ever set for format="png" renders (apps/worker/src/render.ts).
    // Excluded from the storage quota (like putDoc's blobs) — unlike
    // artifacts/canvasFiles, a thumbnail is never kept for version history,
    // so it can't accumulate: the superseded one is always deleted below,
    // capping this at one small blob per canvas regardless of render count.
    thumbnailStorageId: v.optional(v.id("_storage")),
    // Explicit role, when the caller declared one. Undefined keeps the
    // historical first-artifact-wins inference.
    primary: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const version = await nextVersionNumber(ctx, args.canvasId);
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      createdBy: args.createdBy,
      entryStorageId: args.storageId,
    });
    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });

    const artifact = await upsertArtifact(
      ctx,
      args.canvasId,
      versionId,
      {
        relPath: args.relPath,
        type: args.type,
        mimeType: args.mimeType,
        size: args.size,
        storageId: args.storageId,
      },
      args.primary === undefined
        ? undefined
        : { forceRole: args.primary ? "primary" : "supporting" },
    );

    if (args.thumbnailStorageId) {
      await attachThumbnailIfPrimary(ctx, args.canvasId, artifact.role, args.thumbnailStorageId);
    }

    return { version, artifact };
  },
});

/**
 * Records `canvas_run`'s produced /output files as one new version (see
 * recordRender's comment) plus one artifact row per file. No-ops (creates
 * no version) when the script produced nothing to upload — a pure-compute
 * call shouldn't bump the canvas's version history.
 */
export const recordExecArtifacts = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    createdBy: v.id("users"),
    artifacts: v.array(
      v.object({
        relPath: v.string(),
        type: ArtifactTypeValidator,
        mimeType: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.artifacts.length === 0) {
      return {
        version: null,
        artifacts: [] as { relPath: string; role: "primary" | "supporting" }[],
      };
    }
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error(`Unknown canvas: ${args.canvasId}`);

    const version = await nextVersionNumber(ctx, args.canvasId);
    const first = args.artifacts[0];
    if (!first) throw new Error("unreachable: length checked above");
    const versionId = await ctx.db.insert("canvasVersions", {
      canvasId: args.canvasId,
      version,
      createdBy: args.createdBy,
      entryStorageId: first.storageId,
    });
    await ctx.db.patch(args.canvasId, { currentVersionId: versionId, updatedAt: Date.now() });

    const recorded: { relPath: string; role: "primary" | "supporting" }[] = [];
    for (const entry of args.artifacts) {
      recorded.push(await upsertArtifact(ctx, args.canvasId, versionId, entry));
    }
    return { version, artifacts: recorded };
  },
});

export const logRender = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    entrypoint: v.string(),
    format: v.union(v.literal("png"), v.literal("svg"), v.literal("pdf"), v.literal("html")),
    status: v.union(v.literal("success"), v.literal("partial"), v.literal("error")),
    durationMs: v.optional(v.number()),
    errorText: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("renders", args);
  },
});

// PLAN.md section 4/9/12.4: "/cache renders stay out of `artifacts`, as
// today" describes intent, not current storage — renders and script runs
// record every output, /cache/ ones included, as a normal `artifacts` row
// (see upsertArtifact above). This sweep is what actually makes /cache/
// paths ephemeral: anything under that prefix older than the TTL is deleted,
// storage blob and all. Scheduled from ./crons.ts. A single-org internal
// tool with no admin panel (decision #8) is small enough that a full
// `artifacts` table scan is the right tradeoff over adding a dedicated
// TTL/prefix index purely to serve one cron.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const sweepCacheTtl = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    // Paginated rather than `.collect()`: an unbounded collect over the whole
    // artifacts table is a transaction-size bomb that fails outright once the
    // table outgrows the read limit — and a cron that starts throwing is a
    // cron nobody notices has stopped. A bounded page per run keeps this
    // predictable; anything not reached this pass is picked up the next one.
    const SWEEP_PAGE = 512;
    const page = await ctx.db.query("artifacts").take(SWEEP_PAGE);
    let deleted = 0;
    for (const row of page) {
      if (row.relPath.startsWith("/cache/") && row._creationTime < cutoff) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch {
          // Blob already collected; still drop the row and release the bytes.
        }
        await ctx.db.delete(row._id);
        await releaseCanvasStorage(ctx, row.canvasId, row.size);
        deleted += 1;
      }
    }
    const snapshots = await ctx.db
      .query("canvasSnapshots")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(SWEEP_PAGE);
    for (const row of snapshots) {
      await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
    }
    return {
      scanned: page.length + snapshots.length,
      deleted: deleted + snapshots.length,
      truncated: page.length === SWEEP_PAGE || snapshots.length === SWEEP_PAGE,
    };
  },
});

/* ------------------------------------------------------------------------
 * v2 surface: upsert, delete, restore
 *
 * Everything below is reachable from both the MCP tools (via internal*) and
 * the SPA (via the *Mine public wrappers at the bottom).
 * ---------------------------------------------------------------------- */

/** Current quota position, echoed by every write so a caller can see the cap coming. */
export async function storageStatus(ctx: QueryCtx, canvasId: Id<"canvases">) {
  const canvas = await ctx.db.get(canvasId);
  return {
    used_bytes: canvas?.storageBytesUsed ?? 0,
    quota_bytes: CANVAS_STORAGE_QUOTA_BYTES,
  };
}

/**
 * The find-or-create behind `canvas_save`. Returns enough for the tool layer
 * to build URLs and warnings without a second round trip.
 */
export const upsertByRef = internalMutation({
  args: {
    ref: v.string(),
    createdBy: v.id("users"),
    title: v.optional(v.string()),
    kind: v.optional(KindValidator),
    description: v.optional(v.string()),
    theme: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("upsert"), v.literal("create"), v.literal("update"))),
    expectedVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { canvas, workspace, created, overwroteOtherAuthor } = await resolveOrCreateCanvas(ctx, {
      ref: args.ref,
      createdBy: args.createdBy,
      title: args.title,
      kind: args.kind,
      description: args.description,
      theme: args.theme,
      mode: args.mode,
      expectedVersion: args.expectedVersion,
    });
    return {
      canvasId: canvas._id,
      workspaceId: workspace._id,
      workspaceSlug: workspace.slug,
      canvasSlug: canvas.slug,
      kind: canvas.kind,
      title: canvas.title,
      visibility: canvas.visibility,
      publicSlug: canvas.publicSlug,
      created,
      overwroteOtherAuthor,
    };
  },
});

export type DeleteTarget = "workspace" | "canvas" | "file" | "artifact";

async function performDelete(
  ctx: MutationCtx,
  args: { ref: string; target: DeleteTarget; path?: string; purge?: boolean },
) {
  const hard = args.purge === true;

  if (args.target === "workspace") {
    const workspace = await findWorkspaceByRef(ctx, args.ref);
    if (!workspace) throw new Error(`No workspace found for ref "${args.ref}".`);
    if (!hard) {
      await ctx.db.patch(workspace._id, { archivedAt: Date.now() });
      return {
        deleted: [{ kind: "workspace" as const, ref: workspace.slug }],
        bytes_reclaimed: 0,
        archived: true,
      };
    }
    const totals = await purgeWorkspace(ctx, workspace);
    return {
      deleted: [{ kind: "workspace" as const, ref: workspace.slug }],
      bytes_reclaimed: totals.bytesReclaimed,
      canvases_deleted: totals.canvasesDeleted,
      archived: false,
    };
  }

  const canvas = await findCanvasByRef(ctx, args.ref);
  if (!canvas) throw new Error(`No canvas found for ref "${args.ref}".`);
  const workspace = await ctx.db.get(canvas.workspaceId);
  const refLabel = workspace ? `${workspace.slug}/${canvas.slug}` : canvas.slug;

  if (args.target === "canvas") {
    if (!hard) {
      await ctx.db.patch(canvas._id, { archivedAt: Date.now() });
      return {
        deleted: [{ kind: "canvas" as const, ref: refLabel }],
        bytes_reclaimed: 0,
        archived: true,
      };
    }
    const totals = await purgeCanvas(ctx, canvas);
    return {
      deleted: [{ kind: "canvas" as const, ref: refLabel }],
      bytes_reclaimed: totals.bytesReclaimed,
      archived: false,
    };
  }

  if (!args.path) {
    throw new Error(`target "${args.target}" requires a path (e.g. "/output/report.png").`);
  }

  const totals =
    args.target === "file"
      ? await purgeCanvasFile(ctx, canvas._id, args.path)
      : await purgeArtifact(ctx, canvas._id, args.path);
  if (!totals) {
    throw new Error(
      `No ${args.target} at "${args.path}" on "${refLabel}". Use canvas_get to list what exists.`,
    );
  }
  await releaseCanvasStorage(ctx, canvas._id, totals.bytesReclaimed);
  return {
    deleted: [{ kind: args.target, ref: refLabel, path: args.path }],
    bytes_reclaimed: totals.bytesReclaimed,
    archived: false,
  };
}

export const removeByRef = internalMutation({
  args: {
    ref: v.string(),
    target: v.union(
      v.literal("workspace"),
      v.literal("canvas"),
      v.literal("file"),
      v.literal("artifact"),
    ),
    path: v.optional(v.string()),
    purge: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => performDelete(ctx, args),
});

/**
 * Rolls a canvas back to an earlier version by re-pointing
 * `currentVersionId`. The blobs were never destroyed (decision #1), so this
 * is a pointer move, not a copy — which is why v1's write-only history was a
 * missing surface rather than missing data.
 */
async function restoreVersion(
  ctx: MutationCtx,
  canvasId: Id<"canvases">,
  version: number,
): Promise<{ version: number }> {
  const target = await ctx.db
    .query("canvasVersions")
    .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvasId).eq("version", version))
    .unique();
  if (!target) throw new Error(`Canvas has no version ${version}.`);
  await ctx.db.patch(canvasId, { currentVersionId: target._id, updatedAt: Date.now() });
  return { version: target.version };
}

/**
 * Guard for `canvas_upload_url`'s handle-echo flow. Convex's upload URLs
 * return the `storageId` in the *client's* response, so the handle a caller
 * passes back is chosen by the caller, from the org's whole storage
 * namespace. Attaching a blob that some other row already points at would
 * double-count it against the quota and make deleting one canvas punch a
 * hole in another.
 *
 * Returns *where* the blob is attached rather than a bare boolean, because
 * one case is not aliasing at all: re-declaring the same blob at the same
 * path on the same canvas. That is exactly what a retried `canvas_save`
 * does — it replays the upload_ids it was given — and rejecting it would
 * break the idempotent-retry guarantee the whole ref/upsert design exists
 * for. The caller treats that one shape as a no-op and everything else as
 * a conflict.
 */
export const storageAttachment = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("canvasFiles")
      .filter((q) => q.eq(q.field("storageId"), args.storageId))
      .take(1);
    const file = files[0];
    if (file) {
      return {
        scope: "file" as const,
        canvasId: file.canvasId,
        relPath: file.relPath,
        size: file.size,
      };
    }
    const artifacts = await ctx.db
      .query("artifacts")
      .filter((q) => q.eq(q.field("storageId"), args.storageId))
      .take(1);
    const artifact = artifacts[0];
    if (artifact) {
      return {
        scope: "artifact" as const,
        canvasId: artifact.canvasId,
        relPath: artifact.relPath,
        size: artifact.size,
      };
    }
    return null;
  },
});

/** Ref-addressed read backing `canvas_get`, with facets selected by the caller. */
export const detailByRef = internalQuery({
  args: {
    ref: v.string(),
    includeDoc: v.optional(v.boolean()),
    includeFiles: v.optional(v.boolean()),
    includeArtifacts: v.optional(v.boolean()),
    includeVersions: v.optional(v.boolean()),
    includeRenders: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    if (!canvas || canvas.archivedAt !== undefined) return null;
    const workspace = await ctx.db.get(canvas.workspaceId);
    const base = await getCanvas(ctx, canvas._id);
    if (!base) return null;

    const files = args.includeFiles
      ? (
          await ctx.db
            .query("canvasFiles")
            .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
            .take(500)
        ).map((f) => ({ path: f.relPath, size_bytes: f.size, content_hash: f.contentHash }))
      : undefined;

    const artifacts = args.includeArtifacts
      ? await Promise.all(
          (
            await ctx.db
              .query("artifacts")
              .withIndex("by_canvas_relPath", (q) => q.eq("canvasId", canvas._id))
              .take(500)
          ).map(async (a) => ({
            path: a.relPath,
            type: a.type,
            role: a.role,
            size_bytes: a.size,
            mime_type: a.mimeType,
            raw_url: await ctx.storage.getUrl(a.storageId),
          })),
        )
      : undefined;

    const versions = args.includeVersions
      ? await Promise.all(
          (
            await ctx.db
              .query("canvasVersions")
              .withIndex("by_canvas_version", (q) => q.eq("canvasId", canvas._id))
              .order("desc")
              .take(50)
          ).map(async (row) => {
            const author = await ctx.db.get(row.createdBy);
            return {
              version: row.version,
              note: row.note,
              created_at: row._creationTime,
              created_by_email: author?.email ?? null,
              is_current: canvas.currentVersionId === row._id,
            };
          }),
        )
      : undefined;

    const renders = args.includeRenders
      ? (
          await ctx.db
            .query("renders")
            .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
            .order("desc")
            .take(20)
        ).map((r) => ({
          entrypoint: r.entrypoint,
          format: r.format,
          status: r.status,
          duration_ms: r.durationMs,
          error_text: r.errorText,
          created_at: r._creationTime,
        }))
      : undefined;

    const author = await ctx.db.get(canvas.createdBy);
    return {
      canvas: base,
      workspace_slug: workspace?.slug ?? null,
      created_by_email: author?.email ?? null,
      storage: {
        used_bytes: canvas.storageBytesUsed ?? 0,
        quota_bytes: CANVAS_STORAGE_QUOTA_BYTES,
      },
      doc_included: args.includeDoc === true,
      files,
      artifacts,
      versions,
      renders,
    };
  },
});

/** Fast existence check for a current-version element ref before fetching the full CanvasDoc. */
export const currentNodeByRef = internalQuery({
  args: { ref: v.string(), nodeId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      version: v.number(),
      title: v.string(),
      eyebrow: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    if (!canvas?.currentVersionId || canvas.archivedAt !== undefined) return null;
    const version = await ctx.db.get(canvas.currentVersionId);
    if (!version) return null;
    const node = await ctx.db
      .query("canvasNodes")
      .withIndex("by_versionId_and_nodeId", (q) =>
        q
          .eq("versionId", canvas.currentVersionId as Id<"canvasVersions">)
          .eq("nodeId", args.nodeId),
      )
      .unique();
    return node
      ? { version: version.version, title: node.title, eyebrow: node.eyebrow ?? null }
      : null;
  },
});

/**
 * Backs `canvas_find` — the browse/search tool. v1 had list_workspaces and
 * list_canvases (both silently truncating at 200 with no cursor) and no
 * search at all over MCP, even though the SPA had one.
 */
export const findCanvases = internalQuery({
  args: {
    query: v.optional(v.string()),
    workspaceSlug: v.optional(v.string()),
    kind: v.optional(KindValidator),
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
    const term = args.query?.trim();

    let workspaceId: Id<"workspaces"> | undefined;
    if (args.workspaceSlug) {
      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_slug", (q) => q.eq("slug", args.workspaceSlug as string))
        .unique();
      if (!workspace || workspace.archivedAt !== undefined) {
        return { canvases: [], nodes: [], has_more: false };
      }
      workspaceId = workspace._id;
    }

    // Node-level full-text, when a query was given. Matching a node is the
    // most useful hit: it locates the right canvas AND the right place in it.
    const nodes = term
      ? (
          await ctx.db
            .query("canvasNodes")
            .withSearchIndex("search_text", (q) => q.search("searchText", term))
            .take(limit)
        ).slice(0, limit)
      : [];

    const nodeResults = (
      await Promise.all(
        nodes.map(async (row) => {
          const canvas = await ctx.db.get(row.canvasId);
          if (!canvas || canvas.archivedAt !== undefined) return null;
          const workspace = await ctx.db.get(canvas.workspaceId);
          if (workspaceId && canvas.workspaceId !== workspaceId) return null;
          return {
            ref: workspace ? `${workspace.slug}/${canvas.slug}` : canvas._id,
            canvas_id: canvas._id,
            node_id: row.nodeId,
            node_title: row.title,
            eyebrow: row.eyebrow,
          };
        }),
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null);

    // Canvas rows: scoped to a workspace when asked, otherwise across all of
    // them. Titles are matched here too — v1's search only ever looked at
    // canvas-node text, so a canvas whose title matched was unfindable.
    const candidates = workspaceId
      ? await ctx.db
          .query("canvases")
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", workspaceId))
          .order("desc")
          .take(200)
      : await ctx.db.query("canvases").take(200);

    const filtered = candidates.filter((c) => {
      if (c.archivedAt !== undefined) return false;
      if (args.kind && c.kind !== args.kind) return false;
      if (args.visibility && c.visibility !== args.visibility) return false;
      if (term && !c.title.toLowerCase().includes(term.toLowerCase())) return false;
      return true;
    });

    const page = filtered.slice(0, limit);
    const canvases = await Promise.all(
      page.map(async (c) => {
        const workspace = await ctx.db.get(c.workspaceId);
        return {
          ref: workspace ? `${workspace.slug}/${c.slug}` : c._id,
          canvas_id: c._id,
          title: c.title,
          kind: c.kind,
          visibility: c.visibility,
          public_slug: c.publicSlug,
          updated_at: c.updatedAt,
          thumbnail_url: c.thumbnailId ? await ctx.storage.getUrl(c.thumbnailId) : null,
        };
      }),
    );

    return { canvases, nodes: nodeResults, has_more: filtered.length > page.length };
  },
});

/** Workspace listing with canvas counts — the gallery's missing context. */
export const findWorkspaces = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = (await ctx.db.query("workspaces").take(200)).filter(
      (w) => w.archivedAt === undefined,
    );
    const page = rows.slice(0, limit);
    const workspaces = await Promise.all(
      page.map(async (w) => {
        const canvases = await ctx.db
          .query("canvases")
          .withIndex("by_workspace_updated", (q) => q.eq("workspaceId", w._id))
          .take(200);
        return {
          slug: w.slug,
          name: w.name,
          description: w.description,
          canvas_count: canvases.filter((c) => c.archivedAt === undefined).length,
        };
      }),
    );
    return { workspaces, has_more: rows.length > page.length };
  },
});

export const restoreVersionByRef = internalMutation({
  args: { ref: v.string(), version: v.number() },
  handler: async (ctx, args) => {
    const canvas = await findCanvasByRef(ctx, args.ref);
    if (!canvas) throw new Error(`No canvas found for ref "${args.ref}".`);
    return restoreVersion(ctx, canvas._id, args.version);
  },
});

/* --- Public, SPA-facing curator surface ------------------------------- */

export const renameMine = mutation({
  args: { canvasId: v.id("canvases"), title: v.string() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("Title must not be empty.");
    // Slug is intentionally untouched: it is the upsert key agents address
    // this canvas by, and every share link is built from it.
    await ctx.db.patch(args.canvasId, { title, updatedAt: Date.now() });
    return { title };
  },
});

export const archiveMine = mutation({
  args: { canvasId: v.id("canvases"), archived: v.boolean() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    await ctx.db.patch(args.canvasId, {
      archivedAt: args.archived ? Date.now() : undefined,
    });
    return { archived: args.archived };
  },
});

export const deleteMine = mutation({
  args: { canvasId: v.id("canvases") },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    const canvas = await ctx.db.get(args.canvasId);
    if (!canvas) throw new Error("Canvas not found.");
    const totals = await purgeCanvas(ctx, canvas);
    return { bytes_reclaimed: totals.bytesReclaimed };
  },
});

export const restoreVersionMine = mutation({
  args: { canvasId: v.id("canvases"), version: v.number() },
  handler: async (ctx, args) => {
    await requireIotaIdentity(ctx);
    return restoreVersion(ctx, args.canvasId, args.version);
  },
});
