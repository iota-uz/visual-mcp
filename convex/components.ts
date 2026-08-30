import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { renderWorkpool } from "./lib/renderWorkpool";

const MAX_GRAPH_NODES = 500;
const COMPONENT_IMPORT_RE =
  /(?:https?:\/\/[^/]+)?\/components\/([^/"'`\s]+)\/([^/"'`?\s]+)\.js(?:\?[^"'`\s]*)?/g;

export const syncVersionUsages = internalAction({
  args: { canvasId: v.id("canvases"), versionId: v.id("canvasVersions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sources = await ctx.runQuery(internal.canvases.listSourcesForVersion, args);
    const usages: Array<{
      entrypoint: string;
      workspaceSlug: string;
      componentSlug: string;
    }> = [];
    for (const source of sources.files) {
      if (
        !source.relPath.startsWith("/src/") ||
        !/\.(?:html?|[cm]?[jt]sx?)$/i.test(source.relPath)
      ) {
        continue;
      }
      const blob = await ctx.storage.get(source.storageId);
      if (!blob) continue;
      for (const match of (await blob.text()).matchAll(COMPONENT_IMPORT_RE)) {
        const workspaceSlug = match[1];
        const componentSlug = match[2];
        if (workspaceSlug && componentSlug) {
          usages.push({ entrypoint: source.relPath, workspaceSlug, componentSlug });
        }
      }
    }
    await ctx.runMutation(internal.components.registerVersionUsages, { ...args, usages });
    return null;
  },
});

export const registerVersionUsages = internalMutation({
  args: {
    canvasId: v.id("canvases"),
    versionId: v.id("canvasVersions"),
    usages: v.array(
      v.object({ entrypoint: v.string(), workspaceSlug: v.string(), componentSlug: v.string() }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const canvas = await ctx.db.get(args.canvasId);
    const version = await ctx.db.get(args.versionId);
    if (!canvas || !version || version.canvasId !== canvas._id) {
      throw new Error("component_usage_target_not_found");
    }
    const workspace = await ctx.db.get(canvas.workspaceId);
    if (!workspace) throw new Error("component_usage_workspace_not_found");
    const previous = await ctx.db
      .query("canvasComponentUsages")
      .withIndex("by_version", (q) => q.eq("versionId", args.versionId))
      .take(1_000);
    for (const row of previous) await ctx.db.delete(row._id);

    const unique = new Set<string>();
    let inserted = 0;
    for (const usage of args.usages) {
      if (usage.workspaceSlug !== workspace.slug) {
        throw new Error(`component_workspace_mismatch: ${usage.workspaceSlug}`);
      }
      const component = await ctx.db
        .query("components")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", workspace._id).eq("slug", usage.componentSlug),
        )
        .unique();
      if (!component || component.archivedAt !== undefined) {
        throw new Error(`component_not_found: ${workspace.slug}/${usage.componentSlug}`);
      }
      const key = `${usage.entrypoint}\n${component._id}`;
      if (unique.has(key)) continue;
      unique.add(key);
      await ctx.db.insert("canvasComponentUsages", {
        canvasId: canvas._id,
        versionId: version._id,
        entrypoint: usage.entrypoint,
        componentId: component._id,
      });
      inserted += 1;
    }
    return inserted;
  },
});

export const publish = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    slug: v.string(),
    name: v.string(),
    contentHash: v.string(),
    dependencyIds: v.array(v.id("components")),
  },
  returns: v.object({
    componentId: v.id("components"),
    generation: v.number(),
    affectedCanvases: v.number(),
    queuedRenders: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("components")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.slug),
      )
      .unique();
    const changed = !existing || existing.contentHash !== args.contentHash;
    const componentId = existing
      ? existing._id
      : await ctx.db.insert("components", {
          workspaceId: args.workspaceId,
          slug: args.slug,
          name: args.name,
          contentHash: args.contentHash,
          publishedGeneration: 1,
          updatedAt: now,
        });

    for (const dependencyId of args.dependencyIds) {
      const dependency = await ctx.db.get(dependencyId);
      if (
        !dependency ||
        dependency.workspaceId !== args.workspaceId ||
        dependency.archivedAt !== undefined
      ) {
        throw new Error("component_dependency_not_found");
      }
    }
    const previousDependencies = await ctx.db
      .query("componentDependencies")
      .withIndex("by_component", (q) => q.eq("componentId", componentId))
      .take(MAX_GRAPH_NODES);
    for (const row of previousDependencies) await ctx.db.delete(row._id);
    for (const dependencyId of new Set(args.dependencyIds)) {
      await ctx.db.insert("componentDependencies", { componentId, dependencyId });
    }

    // Reject a dependency path that reaches the component being published.
    const seen = new Set<string>();
    const queue = [...args.dependencyIds];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      if (current === componentId) throw new Error("component_dependency_cycle");
      seen.add(current);
      if (seen.size > MAX_GRAPH_NODES) throw new Error("component_dependency_graph_too_large");
      const dependencies = await ctx.db
        .query("componentDependencies")
        .withIndex("by_component", (q) => q.eq("componentId", current))
        .take(MAX_GRAPH_NODES);
      queue.push(...dependencies.map((row) => row.dependencyId));
    }

    const generation = existing ? existing.publishedGeneration + (changed ? 1 : 0) : 1;
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        contentHash: args.contentHash,
        publishedGeneration: generation,
        updatedAt: now,
        archivedAt: undefined,
      });
    }
    if (!changed) {
      return { componentId, generation, affectedCanvases: 0, queuedRenders: 0 };
    }

    // A changed dependency affects components that depend on it, recursively.
    const affectedComponents = new Set<Id<"components">>([componentId]);
    const reverseQueue = [componentId];
    while (reverseQueue.length > 0) {
      const dependencyId = reverseQueue.shift();
      if (!dependencyId) continue;
      const dependents = await ctx.db
        .query("componentDependencies")
        .withIndex("by_dependency", (q) => q.eq("dependencyId", dependencyId))
        .take(MAX_GRAPH_NODES);
      for (const row of dependents) {
        if (affectedComponents.has(row.componentId)) continue;
        affectedComponents.add(row.componentId);
        reverseQueue.push(row.componentId);
      }
      if (affectedComponents.size > MAX_GRAPH_NODES) {
        throw new Error("component_dependency_graph_too_large");
      }
    }
    for (const affectedComponentId of affectedComponents) {
      if (affectedComponentId === componentId) continue;
      const dependent = await ctx.db.get(affectedComponentId);
      if (dependent) {
        await ctx.db.patch(dependent._id, {
          publishedGeneration: dependent.publishedGeneration + 1,
          updatedAt: now,
        });
      }
    }

    const affectedCanvasIds = new Set<Id<"canvases">>();
    for (const affectedComponentId of affectedComponents) {
      const usages = await ctx.db
        .query("canvasComponentUsages")
        .withIndex("by_component", (q) => q.eq("componentId", affectedComponentId))
        .take(1_000);
      for (const usage of usages) {
        const canvas = await ctx.db.get(usage.canvasId);
        if (
          canvas?.visibility === "public" &&
          canvas.archivedAt === undefined &&
          canvas.publishedVersionId === usage.versionId
        ) {
          affectedCanvasIds.add(canvas._id);
        }
      }
    }

    let queuedRenders = 0;
    for (const canvasId of affectedCanvasIds) {
      const canvas = await ctx.db.get(canvasId);
      if (!canvas) continue;
      await ctx.db.patch(canvas._id, {
        staticRenderStatus: "stale",
        staticRenderError: undefined,
        staticRenderUpdatedAt: now,
      });
      const embeds = await ctx.db
        .query("canvasEmbeds")
        .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
        .take(500);
      for (const embed of embeds) {
        const desiredGeneration = embed.desiredGeneration + 1;
        if (embed.status === "queued" || embed.status === "updating" || embed.status === "stale") {
          await ctx.db.patch(embed._id, {
            desiredGeneration,
            status: embed.objectKey ? "stale" : "queued",
            errorText: undefined,
            updatedAt: now,
          });
          continue;
        }
        const attemptObjectKey = `embeds/${canvas._id}/component/g${desiredGeneration}-${now}-${embed._id}.png`;
        await ctx.db.patch(embed._id, {
          desiredGeneration,
          status: embed.objectKey ? "stale" : "queued",
          attemptObjectKey,
          errorText: undefined,
          updatedAt: now,
        });
        const workId = await renderWorkpool.enqueueAction(
          ctx,
          internal.embedRender.run,
          { embedId: embed._id, generation: desiredGeneration, attemptObjectKey },
          {
            onComplete: internal.embeds.renderCompleted,
            context: { embedId: embed._id, generation: desiredGeneration, attemptObjectKey },
          },
        );
        await ctx.db.patch(embed._id, { workId });
        queuedRenders += 1;
      }
      const recipes = await ctx.db
        .query("canvasRenderRecipes")
        .withIndex("by_canvas", (q) => q.eq("canvasId", canvas._id))
        .take(100);
      for (const recipe of recipes) {
        const desiredGeneration = recipe.desiredGeneration + 1;
        await ctx.db.patch(recipe._id, {
          desiredGeneration,
          status: "stale",
          errorText: undefined,
          updatedAt: now,
        });
        if (
          recipe.status === "queued" ||
          recipe.status === "updating" ||
          recipe.status === "stale"
        ) {
          continue;
        }
        const workId = await renderWorkpool.enqueueAction(
          ctx,
          internal.staticRenders.run,
          { recipeId: recipe._id, generation: desiredGeneration },
          {
            onComplete: internal.staticRenders.completed,
            context: { recipeId: recipe._id, generation: desiredGeneration },
          },
        );
        await ctx.db.patch(recipe._id, { workId });
        queuedRenders += 1;
      }
    }

    return {
      componentId,
      generation,
      affectedCanvases: affectedCanvasIds.size,
      queuedRenders,
    };
  },
});
