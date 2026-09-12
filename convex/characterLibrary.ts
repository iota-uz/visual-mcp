import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  CharacterActionDefinition,
  canonicalActionDefinition,
} from "../packages/video/src/character-action-library";
import { canonical } from "../packages/video/src/contracts";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { sha256Hex } from "./lib/hash";

const scope = v.union(v.literal("project"), v.literal("shared"));
const identity = { videoPrincipalId: v.id("users"), workspaceId: v.id("workspaces") };
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message, effect: "not_applied" });
};
// Only the authenticated agent gateway can supply this internal principal.
async function access(
  ctx: QueryCtx | MutationCtx,
  args: {
    videoPrincipalId: Id<"users">;
    workspaceId: Id<"workspaces">;
    scope: "project" | "shared";
    projectId?: Id<"videoProjects">;
  },
) {
  const principal = await ctx.db.get(args.videoPrincipalId);
  const workspace = await ctx.db.get(args.workspaceId);
  if (!principal || !principal.email.endsWith("@iota.uz") || !workspace || workspace.archivedAt)
    fail("NOT_FOUND_OR_FORBIDDEN", "Workspace or principal unavailable");
  if (args.scope === "shared") {
    if (args.projectId)
      fail("VALIDATION_ERROR", "Shared definitions are workspace-scoped, without projectId");
  } else {
    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (!project || project.workspaceId !== args.workspaceId)
      fail("NOT_FOUND_OR_FORBIDDEN", "Project does not belong to this workspace");
  }
}
async function exact(
  ctx: QueryCtx | MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    scope: "project" | "shared";
    projectId?: Id<"videoProjects">;
    revisionId: string;
  },
) {
  return ctx.db
    .query("characterActions")
    .withIndex("by_workspaceId_and_scope_and_projectId_and_revisionId", (q) =>
      q
        .eq("workspaceId", args.workspaceId)
        .eq("scope", args.scope)
        .eq("projectId", args.projectId)
        .eq("revisionId", args.revisionId),
    )
    .unique();
}
async function replay(
  ctx: MutationCtx,
  args: {
    videoPrincipalId: Id<"users">;
    workspaceId: Id<"workspaces">;
    idempotencyKey: string;
  },
  tool: string,
  input: unknown,
) {
  if (!args.idempotencyKey.trim() || args.idempotencyKey.length > 200)
    fail("VALIDATION_ERROR", "Idempotency key must be 1–200 characters");
  const inputHash = await sha256Hex(canonical(input));
  const fields = {
    principalId: args.videoPrincipalId,
    workspaceId: args.workspaceId,
    tool,
    key: args.idempotencyKey,
    inputHash,
  };
  const previous = await ctx.db
    .query("videoOperations")
    .withIndex("by_principalId_and_workspaceId_and_tool_and_key", (q) =>
      q
        .eq("principalId", fields.principalId)
        .eq("workspaceId", fields.workspaceId)
        .eq("tool", tool)
        .eq("key", fields.key),
    )
    .unique();
  if (previous && previous.inputHash !== inputHash)
    fail("IDEMPOTENCY_CONFLICT", "Key was already used with different input");
  return { fields, previous };
}
export const agentRegister = internalMutation({
  args: {
    ...identity,
    projectId: v.id("videoProjects"),
    definition: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await access(ctx, { ...args, scope: "project" });
    if (new TextEncoder().encode(args.definition).byteLength > 128 * 1024)
      fail("VALIDATION_ERROR", "Definition exceeds 128 KiB");
    let definition: CharacterActionDefinition;
    try {
      definition = CharacterActionDefinition.parse(JSON.parse(args.definition));
    } catch {
      return fail("VALIDATION_ERROR", "Invalid action definition");
    }
    if ((await sha256Hex(canonicalActionDefinition(definition))) !== definition.revisionId)
      fail("HASH_MISMATCH", "revisionId must be SHA-256 of canonical action definition");
    const r = await replay(ctx, args, "character_action_register", {
      projectId: args.projectId,
      definition,
    });
    if (r.previous) return JSON.parse(r.previous.result);
    const old = await exact(ctx, { ...args, scope: "project", revisionId: definition.revisionId });
    const result = {
      id: definition.id,
      revisionId: definition.revisionId,
      scope: "project",
      projectId: args.projectId,
      workspaceId: args.workspaceId,
    };
    if (!old)
      await ctx.db.insert("characterActions", {
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        scope: "project",
        actionId: definition.id,
        revisionId: definition.revisionId,
        definition: canonical(definition),
      });
    await ctx.db.insert("videoOperations", { ...r.fields, result: canonical(result) });
    return result;
  },
});
export const agentPromote = internalMutation({
  args: {
    ...identity,
    projectId: v.id("videoProjects"),
    revisionId: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await access(ctx, { ...args, scope: "project" });
    const r = await replay(ctx, args, "character_action_promote", {
      projectId: args.projectId,
      revisionId: args.revisionId,
    });
    if (r.previous) return JSON.parse(r.previous.result);
    const source = await exact(ctx, { ...args, scope: "project" });
    if (!source) return fail("NOT_FOUND_OR_FORBIDDEN", "Exact project-local revision unavailable");
    const old = await exact(ctx, {
      workspaceId: args.workspaceId,
      scope: "shared",
      revisionId: args.revisionId,
    });
    if (!old)
      await ctx.db.insert("characterActions", {
        workspaceId: args.workspaceId,
        scope: "shared",
        actionId: source.actionId,
        revisionId: source.revisionId,
        definition: source.definition,
      });
    const result = {
      id: source.actionId,
      revisionId: source.revisionId,
      scope: "shared",
      workspaceId: args.workspaceId,
    };
    await ctx.db.insert("videoOperations", { ...r.fields, result: canonical(result) });
    return result;
  },
});
export const agentGet = internalQuery({
  args: {
    ...identity,
    scope,
    projectId: v.optional(v.id("videoProjects")),
    revisionId: v.string(),
  },
  handler: async (ctx, args) => {
    await access(ctx, args);
    const row = await exact(ctx, args);
    if (!row) return fail("NOT_FOUND_OR_FORBIDDEN", "Exact action revision unavailable");
    return {
      definition: JSON.parse(row.definition),
      scope: row.scope,
      workspaceId: row.workspaceId,
      projectId: row.projectId ?? null,
    };
  },
});
export const agentList = internalQuery({
  args: {
    ...identity,
    scope,
    projectId: v.optional(v.id("videoProjects")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await access(ctx, args);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 50)
      return fail("VALIDATION_ERROR", "Page size must be 1–50");
    const page = await ctx.db
      .query("characterActions")
      .withIndex("by_workspaceId_and_scope_and_projectId", (q) =>
        q
          .eq("workspaceId", args.workspaceId)
          .eq("scope", args.scope)
          .eq("projectId", args.projectId),
      )
      .paginate(args.paginationOpts);
    return {
      ...page,
      page: page.page.map((row) => ({
        id: row.actionId,
        revisionId: row.revisionId,
        label: CharacterActionDefinition.parse(JSON.parse(row.definition)).label,
      })),
    };
  },
});
