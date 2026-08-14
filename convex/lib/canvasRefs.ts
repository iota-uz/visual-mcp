/**
 * Database-aware resolution for the `ref` addressing scheme in ./ref.ts.
 *
 * Kept out of ../canvases.ts so the same helpers back both the MCP action
 * layer and the SPA's public functions without either importing the other's
 * Convex function definitions.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parseRef, RefError } from "./ref";
import { slugify } from "./slug";

export type CanvasKind = "canvas" | "html" | "image" | "pdf";

/** Resolves a ref to an existing canvas, or null if nothing matches. */
export async function findCanvasByRef(
  ctx: QueryCtx,
  ref: string,
  label = "ref",
): Promise<Doc<"canvases"> | null> {
  const parsed = parseRef(ref, label);

  if (parsed.form === "id") {
    // normalizeId rather than a bare cast: an arbitrary string would make
    // ctx.db.get throw a raw Convex validator error, which surfaces to the
    // tool caller as noise instead of guidance.
    const canvasId = ctx.db.normalizeId("canvases", parsed.canvasId);
    if (!canvasId) {
      throw new RefError(
        `${label} "${ref}" is not a valid canvas id. If you meant a slug ref, ` +
          'write it as "workspace-slug/canvas-slug".',
      );
    }
    return await ctx.db.get(canvasId);
  }

  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", parsed.workspaceSlug))
    .unique();
  if (!workspace || workspace.archivedAt !== undefined) return null;

  return await ctx.db
    .query("canvases")
    .withIndex("by_workspace_slug", (q) =>
      q.eq("workspaceId", workspace._id).eq("slug", parsed.canvasSlug),
    )
    .unique();
}

/** Like {@link findCanvasByRef}, but throws an actionable error when absent. */
export async function requireCanvasByRef(
  ctx: QueryCtx,
  ref: string,
  label = "ref",
): Promise<Doc<"canvases">> {
  const canvas = await findCanvasByRef(ctx, ref, label);
  if (!canvas || canvas.archivedAt !== undefined) {
    throw new RefError(
      `No canvas found for ${label} "${ref}". Use canvas_find to list what exists, ` +
        "or canvas_save to create it.",
    );
  }
  return canvas;
}

/** Resolves the workspace a ref points into, without requiring the canvas to exist. */
export async function findWorkspaceForRef(
  ctx: QueryCtx,
  ref: string,
  label = "ref",
): Promise<Doc<"workspaces"> | null> {
  const parsed = parseRef(ref, label);
  if (parsed.form === "slug") {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_slug", (q) => q.eq("slug", parsed.workspaceSlug))
      .unique();
    return workspace && workspace.archivedAt === undefined ? workspace : null;
  }
  const canvas = await findCanvasByRef(ctx, ref, label);
  return canvas ? await ctx.db.get(canvas.workspaceId) : null;
}

/**
 * Resolves a workspace-only ref: either a bare `"osago"` slug or the
 * workspace half of `"osago/fast-settlement"`. Used by canvas_delete's
 * `target: "workspace"`, where naming a canvas would be misleading.
 */
export async function findWorkspaceByRef(
  ctx: QueryCtx,
  ref: string,
  label = "ref",
): Promise<Doc<"workspaces"> | null> {
  const trimmed = typeof ref === "string" ? ref.trim() : "";
  const slug = trimmed.includes("/") ? (trimmed.split("/")[0] as string) : trimmed;
  if (!slug) throw new RefError(`${label} must name a workspace.`);

  const bySlug = await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (bySlug) return bySlug.archivedAt === undefined ? bySlug : null;

  // Fall back to "it was a canvas id all along", so `canvas_delete` with a
  // canvas id and target:"workspace" does the obvious thing instead of 404ing.
  return await findWorkspaceForRef(ctx, ref, label);
}

export interface ResolveOrCreateArgs {
  ref: string;
  createdBy: Id<"users">;
  title?: string;
  kind?: CanvasKind;
  description?: string;
  theme?: string;
  /**
   * `upsert` (default) creates when absent and updates when present.
   * `create` refuses to touch an existing canvas — the safe choice when the
   * caller knows it is making something new, and the antidote to a retried
   * call silently overwriting someone else's work.
   * `update` refuses to create one.
   */
  mode?: "upsert" | "create" | "update";
  /**
   * Optimistic lock. When set, the canvas's current version must equal this
   * or the write is refused. Lets a caller detect that something else moved
   * the canvas underneath it — writes are org-wide, so "something else" can
   * be another person's agent.
   */
  expectedVersion?: number;
}

export interface ResolveOrCreateResult {
  canvas: Doc<"canvases">;
  workspace: Doc<"workspaces">;
  created: boolean;
  /** True when the existing canvas was authored by someone other than the caller. */
  overwroteOtherAuthor: boolean;
}

async function currentVersionNumber(ctx: MutationCtx, canvas: Doc<"canvases">): Promise<number> {
  if (!canvas.currentVersionId) return 0;
  const version = await ctx.db.get(canvas.currentVersionId);
  return version?.version ?? 0;
}

/**
 * The upsert at the heart of `canvas_save`: finds the canvas a ref names,
 * creating it (and its workspace) when the slug form points at something
 * that does not exist yet.
 *
 * This is what makes a retried tool call idempotent. v1's `create_workspace`
 * always inserted, appending `-2`/`-3` on slug collision, which is why the
 * live deployment ended up with two workspaces both named "OSAGO". Here the
 * slug *is* the key.
 *
 * Slugs are immutable once created; `title` is not. Renaming a slug would
 * break both the upsert key and every share link built from it, so a later
 * `canvas_save` with a different `title` updates the title and leaves the
 * slug alone.
 */
export async function resolveOrCreateCanvas(
  ctx: MutationCtx,
  args: ResolveOrCreateArgs,
): Promise<ResolveOrCreateResult> {
  const parsed = parseRef(args.ref);
  const mode = args.mode ?? "upsert";
  const existing = await findCanvasByRef(ctx, args.ref);

  if (existing && existing.archivedAt === undefined) {
    if (mode === "create") {
      throw new RefError(
        `A canvas already exists at "${args.ref}" and mode is "create". ` +
          'Use mode "upsert" to update it, or pick a different ref.',
      );
    }
    if (args.expectedVersion !== undefined) {
      const actual = await currentVersionNumber(ctx, existing);
      if (actual !== args.expectedVersion) {
        throw new RefError(
          `expected_version ${args.expectedVersion} but "${args.ref}" is at version ${actual}. ` +
            "Someone else changed it — re-read it with canvas_get before writing.",
        );
      }
    }

    const patch: Partial<Doc<"canvases">> = {};
    if (args.title !== undefined && args.title !== existing.title) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.theme !== undefined) patch.theme = args.theme;
    // `kind` is deliberately NOT patched: it decides how the canvas is
    // rendered and served, and flipping it under an existing canvas would
    // orphan its artifacts.
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);

    const workspace = await ctx.db.get(existing.workspaceId);
    if (!workspace) throw new Error(`Canvas ${existing._id} points at a missing workspace`);
    const refreshed = await ctx.db.get(existing._id);
    if (!refreshed) throw new Error("unreachable: canvas vanished mid-mutation");

    return {
      canvas: refreshed,
      workspace,
      created: false,
      overwroteOtherAuthor: existing.createdBy !== args.createdBy,
    };
  }

  if (mode === "update") {
    throw new RefError(
      `No canvas at "${args.ref}" and mode is "update". Use mode "upsert" to create it.`,
    );
  }
  if (parsed.form === "id") {
    throw new RefError(
      `No canvas with id "${args.ref}". A canvas can only be created through a slug ref ` +
        'like "workspace-slug/canvas-slug" — ids are assigned by the server.',
    );
  }

  // Find-or-create the workspace. Same slug-is-the-key rule as canvases.
  let workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", parsed.workspaceSlug))
    .unique();
  if (workspace && workspace.archivedAt !== undefined) {
    // Writing into an archived workspace un-archives it rather than failing:
    // the caller named it explicitly, and a tombstone should not be a wall.
    await ctx.db.patch(workspace._id, { archivedAt: undefined });
    workspace = await ctx.db.get(workspace._id);
  }
  if (!workspace) {
    const slug = slugify(parsed.workspaceSlug);
    const workspaceId = await ctx.db.insert("workspaces", {
      slug,
      name: args.title && parsed.canvasSlug === slug ? args.title : parsed.workspaceSlug,
      createdBy: args.createdBy,
    });
    const inserted = await ctx.db.get(workspaceId);
    if (!inserted) throw new Error("unreachable: workspace vanished after insert");
    workspace = inserted;
  }

  const now = Date.now();
  const canvasId = await ctx.db.insert("canvases", {
    workspaceId: workspace._id,
    slug: slugify(parsed.canvasSlug),
    title: args.title ?? parsed.canvasSlug,
    description: args.description,
    kind: args.kind ?? "html",
    visibility: "private",
    theme: args.theme,
    createdBy: args.createdBy,
    updatedAt: now,
  });
  const canvas = await ctx.db.get(canvasId);
  if (!canvas) throw new Error("unreachable: canvas vanished after insert");

  return { canvas, workspace, created: true, overwroteOtherAuthor: false };
}
