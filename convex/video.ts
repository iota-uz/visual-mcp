import { paginationOptsValidator } from "convex/server";
import { ConvexError, type ObjectType, type PropertyValidators, v } from "convex/values";
import { ZodError } from "zod";
import {
  type StaleDependency as Dependency,
  PatchFailure,
  StaleDependency,
} from "../packages/video/src/contracts";
import { patchDependencies } from "./lib/videoDependencies";
import { purgeVideoProject } from "./lib/videoPurge";
import { initializeVideoWorkflow } from "./lib/videoWorkflow";

const pointer = (path: readonly PropertyKey[]) =>
  "/" + path.map((v) => String(v).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
function validation(error: unknown, prefix = ""): never {
  const fields =
    error instanceof ZodError
      ? error.issues.map((issue) => ({
          path: prefix + pointer(issue.path),
          reason: issue.message,
        }))
      : error instanceof PatchFailure
        ? [{ path: error.path, reason: error.message }]
        : [
            {
              path: prefix || "/",
              reason: "Input violates document constraints",
            },
          ];
  throw new ConvexError({
    code: "VALIDATION_ERROR",
    message: "Correct the identified fields; no changes applied",
    effect: "not_applied",
    recovery: { kind: "fix_input", fields },
  });
}

import {
  applyPatch,
  Brief,
  bounded,
  canonical,
  Format,
  Script,
  Timeline,
} from "../packages/video/src/contracts";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256HexBytes } from "./lib/hash";

const language = v.union(v.literal("ru"), v.literal("uz"));
const fail = (code: string, message: string): never => {
  throw new ConvexError({ code, message, effect: "not_applied" });
};
async function user(ctx: QueryCtx | MutationCtx) {
  if ("videoPrincipalId" in ctx) {
    const id = ctx.videoPrincipalId as Id<"users">;
    if (!(await ctx.db.get(id))) fail("NOT_FOUND_OR_FORBIDDEN", "Principal unavailable");
    return id;
  }
  return requireUserId(ctx, await requireIotaIdentity(ctx));
}
async function workspace(ctx: QueryCtx | MutationCtx, ref: string): Promise<Doc<"workspaces">> {
  const workspaceId = ctx.db.normalizeId("workspaces", ref);
  const value = workspaceId
    ? await ctx.db.get(workspaceId)
    : await ctx.db
        .query("workspaces")
        .withIndex("by_slug", (q) => q.eq("slug", ref))
        .unique();
  if (!value || value.archivedAt !== undefined)
    fail("NOT_FOUND_OR_FORBIDDEN", "Workspace unavailable");
  return value as Doc<"workspaces">;
}
function mutationDefinition<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: MutationCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return d;
}
function queryDefinition<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: QueryCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return d;
}
function agentMutation<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: MutationCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return internalMutation({
    args: { ...d.args, videoPrincipalId: v.id("users") },
    handler: async (ctx, args) => {
      const { videoPrincipalId, ...rest } = args;
      return d.handler(Object.assign({}, ctx, { videoPrincipalId }), rest as ObjectType<A>);
    },
  });
}
function agentQuery<A extends PropertyValidators, R>(d: {
  args: A;
  handler: (ctx: QueryCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return internalQuery({
    args: { ...d.args, videoPrincipalId: v.id("users") },
    handler: async (ctx, args) => {
      const { videoPrincipalId, ...rest } = args;
      return d.handler(Object.assign({}, ctx, { videoPrincipalId }), rest as ObjectType<A>);
    },
  });
}
async function project(ctx: QueryCtx | MutationCtx, id: Id<"videoProjects">) {
  const p = await ctx.db.get(id);
  if (!p || !(await ctx.db.get(p.workspaceId)))
    return fail("NOT_FOUND_OR_FORBIDDEN", "Video project unavailable");
  return p;
}
async function draft(ctx: QueryCtx | MutationCtx, id: Id<"videoDrafts">) {
  const d = await ctx.db.get(id);
  if (!d) return fail("NOT_FOUND_OR_FORBIDDEN", "Video draft unavailable");
  await project(ctx, d.projectId);
  return d;
}
const digest = (value: unknown) => sha256HexBytes(new TextEncoder().encode(canonical(value)));
async function detail(ctx: QueryCtx | MutationCtx, id: Id<"videoProjects">) {
  const p = await project(ctx, id);
  const drafts = await ctx.db
    .query("videoDrafts")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", id))
    .take(2);
  return {
    projectId: p._id,
    workspaceId: p.workspaceId,
    title: p.title,
    brief: Brief.parse(JSON.parse(p.brief)),
    format: Format.parse(JSON.parse(p.format)),
    revisionId: p.revisionId,
    updatedAt: p.updatedAt,
    reviewUrl: `/v/${p._id}`,
    drafts: drafts.map((d) => ({
      draftId: d._id,
      language: d.language,
      scriptRevision: d.scriptRevision,
      timelineRevision: d.timelineRevision,
      currentVersionId: d.currentVersionId,
    })),
  };
}
async function replay(
  ctx: MutationCtx,
  principalId: Id<"users">,
  workspaceId: Id<"workspaces">,
  tool: string,
  key: string,
  input: unknown,
) {
  if (!key || key.length > 200)
    fail("VALIDATION_ERROR", "idempotencyKey must contain 1–200 characters");
  try {
    bounded(input, 600000);
  } catch {
    fail("VALIDATION_ERROR", "Request exceeds 600000 bytes");
  }
  const inputHash = await digest(input);
  const previous = await ctx.db
    .query("videoOperations")
    .withIndex("by_principalId_and_workspaceId_and_tool_and_key", (q) =>
      q
        .eq("principalId", principalId)
        .eq("workspaceId", workspaceId)
        .eq("tool", tool)
        .eq("key", key),
    )
    .unique();
  if (previous && previous.inputHash !== inputHash)
    fail(
      "IDEMPOTENCY_CONFLICT",
      "Key belongs to a different operation; inspect original operation before creating another",
    );
  return { previous, inputHash, principalId, workspaceId, tool, key };
}
async function remember(
  ctx: MutationCtx,
  receipt: Awaited<ReturnType<typeof replay>>,
  result: unknown,
) {
  const { previous, ...fields } = receipt;
  await ctx.db.insert("videoOperations", {
    ...fields,
    result: canonical(result),
  });
}
const getOperationDefinition = queryDefinition({
  args: {
    workspaceId: v.string(),
    tool: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const principalId = await user(ctx);
    const selectedWorkspace = await workspace(ctx, args.workspaceId);
    if (!args.idempotencyKey || args.idempotencyKey.length > 200)
      fail("VALIDATION_ERROR", "idempotencyKey must contain 1–200 characters");
    const operation = await ctx.db
      .query("videoOperations")
      .withIndex("by_principalId_and_workspaceId_and_tool_and_key", (q) =>
        q
          .eq("principalId", principalId)
          .eq("workspaceId", selectedWorkspace._id)
          .eq("tool", args.tool)
          .eq("key", args.idempotencyKey),
      )
      .unique();
    return operation
      ? { state: "applied" as const, result: JSON.parse(operation.result) as unknown }
      : { state: "unknown" as const };
  },
});
async function references(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  value: unknown,
): Promise<void> {
  if (!value || typeof value !== "object") return;
  if ("assetId" in value && "revisionId" in value) {
    const r = value as { assetId: string; revisionId: string };
    const a = ctx.db.normalizeId("assets", r.assetId);
    const av = ctx.db.normalizeId("assetVersions", r.revisionId);
    const asset = a ? await ctx.db.get(a) : null;
    const version = av ? await ctx.db.get(av) : null;
    if (
      !asset ||
      asset.archivedAt !== undefined ||
      !(asset.workspaceId === workspaceId || asset.scope === "shared") ||
      !version ||
      version.assetId !== asset._id
    )
      fail("NOT_FOUND_OR_FORBIDDEN", "Asset revision does not belong to this workspace");
  }
  for (const child of Object.values(value)) await references(ctx, workspaceId, child);
}

const createProjectDefinition = mutationDefinition({
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
    title: v.string(),
    brief: v.object({
      topic: v.string(),
      direction: v.string(),
      audience: v.optional(v.string()),
      objective: v.optional(v.string()),
      callToAction: v.optional(v.string()),
      mustInclude: v.optional(v.array(v.string())),
      mustAvoid: v.optional(v.array(v.string())),
    }),
    languages: v.array(language),
    format: v.object({
      width: v.number(),
      height: v.number(),
      fps: v.object({ numerator: v.number(), denominator: v.number() }),
      plannedDurationMs: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const principal = await user(ctx);
    const selectedWorkspace = await workspace(ctx, args.workspaceId);
    const validatedBrief = Brief.safeParse(args.brief),
      validatedFormat = Format.safeParse(args.format);
    if (!validatedBrief.success) validation(validatedBrief.error, "/brief");
    if (!validatedFormat.success) validation(validatedFormat.error, "/format");
    const brief = validatedBrief.data!,
      format = validatedFormat.data!;
    const receipt = await replay(
      ctx,
      principal,
      selectedWorkspace._id,
      "createProject",
      args.idempotencyKey,
      { ...args, brief, format },
    );
    if (receipt.previous)
      return JSON.parse(receipt.previous.result) as Awaited<ReturnType<typeof detail>>;
    if (
      format.fps.numerator / format.fps.denominator < 1 ||
      format.fps.numerator / format.fps.denominator > 60
    )
      fail("VALIDATION_ERROR", "FPS must be between 1 and 60");
    try {
      bounded(brief, 65536);
    } catch {
      fail("VALIDATION_ERROR", "Brief exceeds 65536 bytes");
    }
    if (
      !args.title.trim() ||
      args.title.length > 500 ||
      !args.languages.length ||
      new Set(args.languages).size !== args.languages.length
    )
      fail("VALIDATION_ERROR", "A title and unique nonempty languages are required");
    const revisionId = await digest({ title: args.title, brief, format });
    const projectId = await ctx.db.insert("videoProjects", {
      workspaceId: selectedWorkspace._id,
      title: args.title,
      brief: canonical(brief),
      format: canonical(format),
      revisionId,
      createdBy: principal,
      updatedAt: Date.now(),
    });
    for (const lang of args.languages) {
      const script = Script.parse({
        language: lang,
        writingSystem: lang === "ru" ? "cyrillic" : "latin",
        title: args.title,
        premise: "",
        sceneOrder: [],
        scenesById: {},
      });
      const timeline = Timeline.parse({
        fps: format.fps,
        durationFrames: Math.max(
          1,
          Math.round(
            ((format.plannedDurationMs ?? 30000) * format.fps.numerator) /
              format.fps.denominator /
              1000,
          ),
        ),
        trackOrder: [],
        tracksById: {},
      });
      const scriptRevision = await digest(script),
        timelineRevision = await digest(timeline);
      const draftId = await ctx.db.insert("videoDrafts", {
        projectId,
        language: lang,
        script: canonical(script),
        timeline: canonical(timeline),
        scriptRevision,
        timelineRevision,
        currentVersionId: null,
      });
      for (const [kind, revisionId, content] of [
        ["script", scriptRevision, canonical(script)],
        ["timeline", timelineRevision, canonical(timeline)],
      ] as const)
        await ctx.db.insert("videoDocumentRevisions", {
          draftId,
          kind,
          revisionId,
          content,
        });
    }
    await initializeVideoWorkflow(ctx, {
      projectId,
      workspaceId: selectedWorkspace._id,
      languages: args.languages,
    });
    const result = await detail(ctx, projectId);
    await remember(ctx, receipt, result);
    return result;
  },
});
const getProjectDefinition = queryDefinition({
  args: { projectId: v.id("videoProjects") },
  handler: async (ctx, args) => {
    await user(ctx);
    return detail(ctx, args.projectId);
  },
});
const listProjectsDefinition = queryDefinition({
  args: {
    workspaceId: v.string(),
    paginationOpts: paginationOptsValidator,
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await user(ctx);
    const selectedWorkspace = await workspace(ctx, args.workspaceId);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      fail("VALIDATION_ERROR", "Page size must be 1–100");
    const rows = await ctx.db
      .query("videoProjects")
      .withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", selectedWorkspace._id))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...rows,
      page: await Promise.all(
        rows.page
          .filter((p) => !args.query || p.title.toLowerCase().includes(args.query.toLowerCase()))
          .map((p) => summarizeProject(ctx, p)),
      ),
    };
  },
});
async function summarizeProject(
  ctx: QueryCtx | MutationCtx,
  p: {
    _id: Id<"videoProjects">;
    workspaceId: Id<"workspaces">;
    title: string;
    brief: string;
    revisionId: string;
    updatedAt: number;
  },
) {
  const brief = Brief.parse(JSON.parse(p.brief));
  const drafts = await ctx.db
    .query("videoDrafts")
    .withIndex("by_projectId_and_language", (q) => q.eq("projectId", p._id))
    .take(2);
  return {
    projectId: p._id,
    workspaceId: p.workspaceId,
    title: p.title,
    revisionId: p.revisionId,
    updatedAt: p.updatedAt,
    reviewUrl: `/v/${p._id}`,
    topic: brief.topic,
    languages: drafts.map((d) => d.language),
  };
}
const listMineDefinition = queryDefinition({
  args: {},
  handler: async (ctx) => {
    await user(ctx);
    const workspaces = (await ctx.db.query("workspaces").take(50)).filter(
      (workspace) => workspace.archivedAt === undefined,
    );
    const groups = [];
    for (const workspace of workspaces) {
      const rows = await ctx.db
        .query("videoProjects")
        .withIndex("by_workspaceId_and_updatedAt", (q) => q.eq("workspaceId", workspace._id))
        .order("desc")
        .take(20);
      if (rows.length === 0) continue;
      groups.push({
        workspaceId: workspace._id,
        slug: workspace.slug,
        name: workspace.name,
        projects: await Promise.all(rows.map((p) => summarizeProject(ctx, p))),
      });
    }
    return groups;
  },
});
const renameProjectDefinition = mutationDefinition({
  args: { projectId: v.id("videoProjects"), title: v.string() },
  handler: async (ctx, args) => {
    await user(ctx);
    const p = await project(ctx, args.projectId);
    const title = args.title.trim();
    if (!title || title.length > 500) fail("VALIDATION_ERROR", "A nonempty title is required");
    const brief = Brief.parse(JSON.parse(p.brief));
    const format = Format.parse(JSON.parse(p.format));
    const revisionId = await digest({ title, brief, format });
    await ctx.db.patch(p._id, { title, revisionId, updatedAt: Date.now() });
    return { title, revisionId };
  },
});
const deleteProjectDefinition = mutationDefinition({
  args: { projectId: v.id("videoProjects") },
  handler: async (ctx, args) => {
    await user(ctx);
    await project(ctx, args.projectId);
    await purgeVideoProject(ctx, args.projectId);
    return { deleted: true };
  },
});
const latestRenderDefinition = queryDefinition({
  args: {
    projectId: v.id("videoProjects"),
    language: language,
  },
  handler: async (ctx, args) => {
    await user(ctx);
    await project(ctx, args.projectId);
    const states = ["succeeded"] as const;
    for (const state of states) {
      const jobs = await ctx.db
        .query("videoJobs")
        .withIndex("by_projectId_and_state", (q) =>
          q.eq("projectId", args.projectId).eq("state", state),
        )
        .take(32);
      const renders = jobs
        .filter((job) => job.kind === "render" && job.versionId)
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const job of renders) {
        const version = job.versionId ? await ctx.db.get(job.versionId) : null;
        if (version?.language === args.language)
          return { jobId: job._id, versionId: version._id, createdAt: job.createdAt };
      }
    }
    return null;
  },
});
const getDraftDefinition = queryDefinition({
  args: { draftId: v.id("videoDrafts") },
  handler: async (ctx, args) => {
    await user(ctx);
    const d = await draft(ctx, args.draftId);
    return {
      draftId: d._id,
      projectId: d.projectId,
      language: d.language,
      scriptRevision: d.scriptRevision,
      timelineRevision: d.timelineRevision,
      script: Script.parse(JSON.parse(d.script)),
      timeline: Timeline.parse(JSON.parse(d.timeline)),
    };
  },
});
const patchArgs = {
  draftId: v.id("videoDrafts"),
  idempotencyKey: v.string(),
  expectedRevision: v.string(),
  operations: v.array(
    v.union(
      v.object({ op: v.literal("add"), path: v.string(), value: v.any() }),
      v.object({ op: v.literal("replace"), path: v.string(), value: v.any() }),
      v.object({ op: v.literal("test"), path: v.string(), value: v.any() }),
      v.object({ op: v.literal("remove"), path: v.string() }),
    ),
  ),
};
async function patch(
  ctx: MutationCtx,
  args: {
    draftId: Id<"videoDrafts">;
    idempotencyKey: string;
    expectedRevision: string;
    operations: unknown[];
  },
  kind: "script" | "timeline",
) {
  const principal = await user(ctx),
    d = await draft(ctx, args.draftId),
    p = await project(ctx, d.projectId);
  const receipt = await replay(
    ctx,
    principal,
    p.workspaceId,
    `patch${kind}`,
    args.idempotencyKey,
    args,
  );
  if (receipt.previous)
    return JSON.parse(receipt.previous.result) as {
      revisionId: string;
      changed: boolean;
      affectedSceneIds: string[];
      staleDependents: Dependency[];
    };
  const current = kind === "script" ? d.scriptRevision : d.timelineRevision;
  if (current !== args.expectedRevision)
    fail(
      "REVISION_CONFLICT",
      "Read the current document and recompute the patch; do not merely replace expectedRevision",
    );
  let next: unknown;
  try {
    next =
      kind === "script"
        ? applyPatch(JSON.parse(d.script), args.operations, Script)
        : applyPatch(JSON.parse(d.timeline), args.operations, Timeline);
  } catch (error) {
    validation(error);
  }
  const script = kind === "script" ? Script.parse(next) : Script.parse(JSON.parse(d.script));
  if (kind === "script")
    for (const [sceneId, scene] of Object.entries(script.scenesById))
      for (const [shotId, shot] of Object.entries(scene.shotsById)) {
        if (!shot.selectedVideoJobId) continue;
        const jobId = ctx.db.normalizeId("videoJobs", shot.selectedVideoJobId),
          job = jobId ? await ctx.db.get(jobId) : null;
        const request = job ? JSON.parse(job.request) : null,
          result = job?.result ? JSON.parse(job.result) : null;
        if (
          !job ||
          job.workspaceId !== p.workspaceId ||
          job.kind !== "shot" ||
          job.state !== "succeeded" ||
          request?.draftId !== d._id ||
          request.sceneId !== sceneId ||
          request.shotId !== shotId ||
          !shot.selectedVideo ||
          !result?.artifacts?.some(
            (a: { asset?: { assetId: string; revisionId: string } }) =>
              a.asset?.assetId === shot.selectedVideo!.assetId &&
              a.asset.revisionId === shot.selectedVideo!.revisionId,
          )
        )
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "Selected shot provenance does not match exact completed job output",
            effect: "not_applied",
            recovery: {
              kind: "fix_input",
              fields: [
                {
                  path: `/scenesById/${sceneId}/shotsById/${shotId}/selectedVideoJobId`,
                  reason: "Use a completed candidate for this shot and its exact asset revision",
                },
              ],
            },
          });
      }
  const timeline =
    kind === "timeline" ? Timeline.parse(next) : Timeline.parse(JSON.parse(d.timeline));
  if (script.language !== d.language) fail("VALIDATION_ERROR", "Draft language is immutable");
  const format = Format.parse(JSON.parse(p.format));
  if (canonical(timeline.fps) !== canonical(format.fps))
    fail("VALIDATION_ERROR", "Timeline FPS must match project");
  for (const track of Object.values(timeline.tracksById))
    for (const clip of Object.values(track.clipsById)) {
      if (clip.sceneId && !script.scenesById[clip.sceneId])
        fail("VALIDATION_ERROR", "Timeline references a missing scene");
      if (
        clip.shotId &&
        (!clip.sceneId || !script.scenesById[clip.sceneId]?.shotsById[clip.shotId])
      )
        fail("VALIDATION_ERROR", "Timeline shotId requires an existing shot in its sceneId");
    }
  await references(ctx, p.workspaceId, next);
  const changed = canonical(next) !== d[kind];
  // Revision identity includes its parent: an A→B→A edit must not revive an old CAS token.
  const revisionId = changed ? await digest({ parent: current, document: next }) : current;
  if (changed) {
    await ctx.db.patch(
      d._id,
      kind === "script"
        ? { script: canonical(next), scriptRevision: revisionId }
        : { timeline: canonical(next), timelineRevision: revisionId },
    );
    await ctx.db.insert("videoDocumentRevisions", {
      draftId: d._id,
      kind,
      revisionId,
      content: canonical(next),
    });
    await ctx.db.patch(p._id, { updatedAt: Date.now() });
  }
  const dependencies = changed
    ? patchDependencies({
        draftId: d._id,
        timelineRevision: d.timelineRevision,
        kind,
        beforeScript: Script.parse(JSON.parse(d.script)),
        script,
        beforeTimeline: Timeline.parse(JSON.parse(d.timeline)),
        timeline,
      })
    : { affectedSceneIds: [], staleDependents: [] as Dependency[] };
  if (changed && d.currentVersionId) {
    const reason = kind === "script" ? ("script_changed" as const) : ("timeline_changed" as const);
    dependencies.staleDependents.unshift({
      kind: "checkpoint",
      versionId: d.currentVersionId,
      reason,
    });
    const renders = await ctx.db
      .query("videoJobs")
      .withIndex("by_versionId_and_kind", (q) =>
        q.eq("versionId", d.currentVersionId!).eq("kind", "render"),
      )
      .take(21);
    dependencies.staleDependents.push(
      ...renders.slice(0, 20).map((job) => ({
        kind: "job" as const,
        jobId: job._id,
        versionId: d.currentVersionId!,
        reason,
      })),
    );
    if (renders.length > 20)
      dependencies.staleDependents.push({
        kind: "job_collection",
        projectId: p._id,
        versionId: d.currentVersionId,
        jobKind: "render",
        reason: "additional_dependencies_require_review",
      });
  }
  const result = {
    revisionId,
    changed,
    affectedSceneIds: dependencies.affectedSceneIds,
    staleDependents: dependencies.staleDependents.map((value) => StaleDependency.parse(value)),
  };
  await remember(ctx, receipt, result);
  return result;
}
const patchScriptDefinition = mutationDefinition({
  args: patchArgs,
  handler: (ctx, args) => patch(ctx, args, "script"),
});
const patchTimelineDefinition = mutationDefinition({
  args: patchArgs,
  handler: (ctx, args) => patch(ctx, args, "timeline"),
});
const checkpointDefinition = mutationDefinition({
  args: {
    draftId: v.id("videoDrafts"),
    idempotencyKey: v.string(),
    expectedProjectRevision: v.string(),
    expectedScriptRevision: v.string(),
    expectedTimelineRevision: v.string(),
    label: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const principal = await user(ctx),
      d = await draft(ctx, args.draftId),
      p = await project(ctx, d.projectId);
    const receipt = await replay(
      ctx,
      principal,
      p.workspaceId,
      "checkpoint",
      args.idempotencyKey,
      args,
    );
    if (receipt.previous)
      return JSON.parse(receipt.previous.result) as {
        version: {
          projectId: Id<"videoProjects">;
          language: "ru" | "uz";
          versionId: Id<"videoVersions">;
        };
        manifestSha256: string;
        reviewUrl: string;
      };
    if (
      p.revisionId !== args.expectedProjectRevision ||
      d.scriptRevision !== args.expectedScriptRevision ||
      d.timelineRevision !== args.expectedTimelineRevision
    )
      fail("REVISION_CONFLICT", "Read all current revisions and recompute checkpoint");
    if (!args.label.trim() || args.label.length > 500 || (args.note?.length ?? 0) > 16000)
      fail("VALIDATION_ERROR", "Checkpoint label/note invalid");
    await references(ctx, p.workspaceId, JSON.parse(d.script));
    await references(ctx, p.workspaceId, JSON.parse(d.timeline));
    const profile = await ctx.db
      .query("videoProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", p._id))
      .unique();
    const manifest = canonical({
      profile: profile ? { profileId: profile._id, revisionId: profile.revisionId } : null,
      brief: JSON.parse(p.brief),
      format: JSON.parse(p.format),
      script: JSON.parse(d.script),
      timeline: JSON.parse(d.timeline),
    });
    const manifestSha256 = await digest(JSON.parse(manifest));
    const versionId = await ctx.db.insert("videoVersions", {
      ...(d.currentVersionId ? { parentVersionId: d.currentVersionId } : {}),
      projectId: p._id,
      draftId: d._id,
      language: d.language,
      label: args.label,
      ...(args.note ? { note: args.note } : {}),
      projectRevision: p.revisionId,
      scriptRevision: d.scriptRevision,
      timelineRevision: d.timelineRevision,
      manifest,
      manifestSha256,
      createdAt: Date.now(),
    });
    await ctx.db.patch(d._id, { currentVersionId: versionId });
    const result = {
      version: { projectId: p._id, language: d.language, versionId },
      manifestSha256,
      reviewUrl: `/v/${p._id}?version=${versionId}`,
    };
    await remember(ctx, receipt, result);
    return result;
  },
});
const listVersionsDefinition = queryDefinition({
  args: {
    projectId: v.id("videoProjects"),
    language: v.optional(language),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await user(ctx);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      fail("VALIDATION_ERROR", "Page size must be 1–100");
    await project(ctx, args.projectId);
    const result = await ctx.db
      .query("videoVersions")
      .withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .filter((q) =>
        args.language
          ? q.eq(q.field("language"), args.language)
          : q.eq(q.field("projectId"), args.projectId),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((row) => ({
        version: {
          projectId: row.projectId,
          language: row.language,
          versionId: row._id,
        },
        label: row.label,
        manifestSha256: row.manifestSha256,
        createdAt: row.createdAt,
        reviewUrl: `/v/${row.projectId}?version=${row._id}`,
      })),
    };
  },
});

const getVersionDefinition = queryDefinition({
  args: { versionId: v.id("videoVersions") },
  handler: async (ctx, args) => {
    await user(ctx);
    const row = await ctx.db.get(args.versionId);
    if (!row) return fail("NOT_FOUND_OR_FORBIDDEN", "Version unavailable");
    await project(ctx, row.projectId);
    const manifest = JSON.parse(row.manifest) as {
      script: unknown;
      timeline: unknown;
    };
    return {
      version: {
        projectId: row.projectId,
        language: row.language,
        versionId: row._id,
      },
      script: Script.parse(manifest.script),
      timeline: Timeline.parse(manifest.timeline),
      projectRevision: row.projectRevision,
      scriptRevision: row.scriptRevision,
      timelineRevision: row.timelineRevision,
      label: row.label,
      manifestSha256: row.manifestSha256,
    };
  },
});
export const createProject = mutation(createProjectDefinition);
export const getProject = query(getProjectDefinition);
export const listProjects = query(listProjectsDefinition);
export const listMine = query(listMineDefinition);
export const renameProject = mutation(renameProjectDefinition);
export const deleteProject = mutation(deleteProjectDefinition);
export const latestRender = query(latestRenderDefinition);
export const getDraft = query(getDraftDefinition);
export const patchScript = mutation(patchScriptDefinition);
export const patchTimeline = mutation(patchTimelineDefinition);
export const checkpoint = mutation(checkpointDefinition);
export const listVersions = query(listVersionsDefinition);
export const getVersion = query(getVersionDefinition);
export const agentCreateProject = agentMutation(createProjectDefinition);
export const agentGetProject = agentQuery(getProjectDefinition);
export const agentGetOperation = agentQuery(getOperationDefinition);
export const agentListProjects = agentQuery(listProjectsDefinition);
export const agentGetDraft = agentQuery(getDraftDefinition);
export const agentPatchScript = agentMutation(patchScriptDefinition);
export const agentPatchTimeline = agentMutation(patchTimelineDefinition);
export const agentCheckpoint = agentMutation(checkpointDefinition);
export const agentListVersions = agentQuery(listVersionsDefinition);
export const agentGetVersion = agentQuery(getVersionDefinition);
export const agentGetCanvasCommentScope = internalQuery({
  args: { commentId: v.id("canvasComments"), videoPrincipalId: v.id("users") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.videoPrincipalId)))
      fail("NOT_FOUND_OR_FORBIDDEN", "Principal unavailable");
    const comment = await ctx.db.get(args.commentId);
    const canvas = comment ? await ctx.db.get(comment.canvasId) : null;
    if (!comment || !canvas) fail("NOT_FOUND_OR_FORBIDDEN", "Comment unavailable");
    return { workspaceId: canvas!.workspaceId, canvasId: canvas!._id };
  },
});
export const agentPrincipal = internalQuery({
  args: { tokenId: v.id("mcpTokens"), now: v.number() },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt !== undefined || token.expiresAt <= args.now) return null;
    return (await ctx.db.get(token.userId)) ? token.userId : null;
  },
});
