import {
  makeFunctionReference,
  type PaginationOptions,
  paginationOptsValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { bounded, canonical, Script } from "../packages/video/src/contracts";
import { JobRequest, JobState, resolvedCritiquePolicy } from "../packages/video/src/jobs";
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
import { emitVideoMetric } from "./lib/videoObservability";
import {
  markSourceUnavailable,
  PersistenceReceiptValidator,
  persistenceStage,
} from "./lib/videoPersistence";
import { assertVideoProductionAllowed } from "./lib/videoWorkflow";

const error = (code: string, message: string, effect = "not_applied"): never => {
  throw new ConvexError({ code, message, effect });
};
async function identity(ctx: QueryCtx | MutationCtx, principal?: Id<"users">) {
  if (principal) {
    if (!(await ctx.db.get(principal))) error("NOT_FOUND_OR_FORBIDDEN", "Principal unavailable");
    return principal;
  }
  return requireUserId(ctx, await requireIotaIdentity(ctx));
}
async function job(ctx: QueryCtx | MutationCtx, jobId: Id<"videoJobs">) {
  const j = await ctx.db.get(jobId);
  if (!j || !(await ctx.db.get(j.workspaceId)))
    return error("NOT_FOUND_OR_FORBIDDEN", "Job unavailable");
  return j;
}
function reservedObjectKeys(j: Doc<"videoJobs">) {
  return (j.persistenceReceipt?.artifacts ?? [])
    .map((artifact) => artifact.objectKey)
    .filter((objectKey) => objectKey.startsWith(`video-results/${j._id}/`));
}
async function releaseReservedObjectLeases(ctx: MutationCtx, j: Doc<"videoJobs">) {
  for (const objectKey of reservedObjectKeys(j)) {
    const leases = await ctx.db
      .query("assetObjectLeases")
      .withIndex("by_objectKey", (q) => q.eq("objectKey", objectKey))
      .collect();
    for (const lease of leases)
      if (lease.leaseId.startsWith(`${j._id}:`)) await ctx.db.delete(lease._id);
  }
}
function receipt(j: Doc<"videoJobs">, replayed: boolean) {
  return {
    jobId: j._id,
    state: j.state,
    replayed,
    pollAfterMs: 1000,
    kind: j.kind,
    operation: { toolName: j.kind, idempotencyKey: j.idempotencyKey },
    operationId: j.operationId,
    attemptNumber: j.attemptNumber,
    retryOfJobId: j.retryOfJobId ?? null,
    statusUrl: j.projectId ? `/v/${j.projectId}?job=${j._id}` : `/jobs/${j._id}`,
  };
}
const submitArgs = {
  workspaceId: v.id("workspaces"),
  projectId: v.optional(v.id("videoProjects")),
  versionId: v.optional(v.id("videoVersions")),
  idempotencyKey: v.string(),
  request: v.any(),
};
async function submitJob(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"videoProjects">;
    versionId?: Id<"videoVersions">;
    idempotencyKey: string;
    request: unknown;
  },
  principal?: Id<"users">,
  retry?: {
    operationId: string;
    attemptNumber: number;
    retryOfJobId: Id<"videoJobs">;
  },
) {
  const principalId = await identity(ctx, principal);
  if (!(await ctx.db.get(args.workspaceId)))
    error("NOT_FOUND_OR_FORBIDDEN", "Workspace unavailable");
  const parsed = JobRequest.safeParse(args.request);
  if (!parsed.success)
    throw new ConvexError({
      code: "VALIDATION_ERROR",
      message: "Invalid job request",
      effect: "not_applied",
      recovery: {
        kind: "fix_input",
        fields: parsed.error.issues.map((i) => ({
          path: `/request/${i.path.join("/")}`,
          reason: i.message,
        })),
      },
    });
  const request = parsed.data;
  if (request.kind === "render" && request.rubricHash) {
    if (
      !request.rubricPolicy ||
      (await sha256HexBytes(
        new TextEncoder().encode(canonical(resolvedCritiquePolicy(request.rubricPolicy))),
      )) !== request.rubricHash
    )
      error(
        "VALIDATION_ERROR",
        "Render evidence requires exact frozen rubricPolicy matching rubricHash; no creative criteria are claimed by technical measurements",
      );
  }
  try {
    bounded(request, 262144);
  } catch {
    error("VALIDATION_ERROR", "Job request exceeds 262144 bytes");
  }
  if (!args.idempotencyKey || args.idempotencyKey.length > 200)
    error("VALIDATION_ERROR", "Invalid idempotency key");
  const canonicalInput = canonical({
    request,
    projectId: args.projectId ?? null,
    versionId: args.versionId ?? null,
  });
  const inputHash = await sha256HexBytes(new TextEncoder().encode(canonicalInput));
  const existing = await ctx.db
    .query("videoJobs")
    .withIndex("by_principalId_and_workspaceId_and_kind_and_idempotencyKey", (q) =>
      q
        .eq("principalId", principalId)
        .eq("workspaceId", args.workspaceId)
        .eq("kind", request.kind)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (existing.inputHash !== inputHash)
      error("IDEMPOTENCY_CONFLICT", "Key belongs to another request; inspect existing job");
    return receipt(existing, true);
  }
  if (args.projectId) {
    const p = await ctx.db.get(args.projectId);
    if (!p || p.workspaceId !== args.workspaceId)
      error("NOT_FOUND_OR_FORBIDDEN", "Project does not belong to workspace");
  }
  if (args.versionId) {
    const version = await ctx.db.get(args.versionId);
    if (!version || !args.projectId || version.projectId !== args.projectId)
      error("NOT_FOUND_OR_FORBIDDEN", "Version does not belong to project");
  }
  if (request.kind === "render" && request.versionId !== args.versionId)
    error("VALIDATION_ERROR", "Render must pin the submitted version");
  if (request.kind === "shot") {
    const id = ctx.db.normalizeId("videoDrafts", request.draftId);
    const draft = id ? await ctx.db.get(id) : null;
    if (!draft || draft.projectId !== args.projectId)
      return error("NOT_FOUND_OR_FORBIDDEN", "Shot draft unavailable");
    if (draft.scriptRevision !== request.scriptRevision)
      error("REVISION_CONFLICT", "Read current shot before generation");
    const script = Script.parse(JSON.parse(draft.script));
    if (!script.scenesById[request.sceneId]?.shotsById[request.shotId])
      error("NOT_FOUND_OR_FORBIDDEN", "Shot unavailable");
  }
  const refs: unknown[] = [];
  function collect(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("assetId" in value && "revisionId" in value) refs.push(value);
    Object.values(value).forEach(collect);
  }
  collect(request);
  for (const value of refs) {
    const ref = value as { assetId: string; revisionId: string };
    const a = ctx.db.normalizeId("assets", ref.assetId),
      r = ctx.db.normalizeId("assetVersions", ref.revisionId);
    const asset = a ? await ctx.db.get(a) : null,
      version = r ? await ctx.db.get(r) : null;
    if (
      !asset ||
      asset.archivedAt !== undefined ||
      !(asset.workspaceId === args.workspaceId || asset.scope === "shared") ||
      !version ||
      version.assetId !== a
    )
      error("NOT_FOUND_OR_FORBIDDEN", "Asset revision unavailable in workspace");
  }
  const now = Date.now();
  await assertVideoProductionAllowed(ctx, args);
  const id = await ctx.db.insert("videoJobs", {
    workspaceId: args.workspaceId,
    principalId,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    ...(args.versionId ? { versionId: args.versionId } : {}),
    idempotencyKey: args.idempotencyKey,
    operationId: retry?.operationId ?? crypto.randomUUID(),
    attemptNumber: retry?.attemptNumber ?? 1,
    ...(retry ? { retryOfJobId: retry.retryOfJobId } : {}),
    inputHash,
    request: canonical(request),
    kind: request.kind,
    state: "queued",
    fence: 0,
    createdAt: now,
    updatedAt: now,
    stage: "queued",
  });
  if (request.kind === "render")
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoRender:run"), {
      jobId: id,
    });
  if (request.kind === "image" || request.kind === "voice")
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoProviders:run"), {
      jobId: id,
    });
  if (request.kind === "shot")
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoShots:run"), {
      jobId: id,
    });
  if (request.kind === "critique")
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoCritique:run"), {
      jobId: id,
    });
  if (request.kind === "media")
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoProcessing:run"), {
      jobId: id,
    });
  if (
    request.kind === "memory_validation" ||
    request.kind === "offline_eval" ||
    request.kind === "analytics_import"
  )
    await ctx.scheduler.runAfter(0, makeFunctionReference<"action">("videoLearning:run"), {
      jobId: id,
    });
  if (request.kind === "execute")
    await ctx.scheduler.runAfter(
      120000,
      makeFunctionReference<"mutation">("videoExecuteRecovery:expireQueued"),
      { jobId: id, createdAt: now },
    );
  const inserted = await ctx.db.get(id);
  if (!inserted) throw new Error("New video job was not readable after insert");
  return receipt(inserted, false);
}
export const submit = mutation({
  args: submitArgs,
  handler: (ctx, args) => submitJob(ctx, args),
});
export const agentSubmit = internalMutation({
  args: { ...submitArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => submitJob(ctx, args, videoPrincipalId),
});
function publicJob(j: Doc<"videoJobs">) {
  const request = JobRequest.parse(JSON.parse(j.request));
  const safeToRegenerate =
    ["render", "media"].includes(j.kind) &&
    !j.errorCode?.endsWith("NOT_CONFIGURED") &&
    (j.persistenceReceipt?.state === "source_unavailable" || j.errorEffect === "not_applied");
  const canReconcile =
    Boolean(j.persistenceReceipt) &&
    j.persistenceReceipt?.state !== "source_unavailable" &&
    !safeToRegenerate;
  return {
    ...receipt(j, false),
    workspaceId: j.workspaceId,
    context:
      request.kind === "shot"
        ? {
            draftId: request.draftId,
            scriptRevision: request.scriptRevision,
            sceneId: request.sceneId,
            shotId: request.shotId,
            profileId: request.profileId,
          }
        : null,
    projectId: j.projectId ?? null,
    versionId: j.versionId ?? null,
    stage: j.stage,
    fence: j.fence,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    stale: j.stale ?? false,
    persistence: j.persistenceReceipt
      ? {
          state: j.persistenceReceipt.state,
          artifactCount: j.persistenceReceipt.artifacts.length,
          persistedRoles: j.persistenceReceipt.persistedRoles ?? [],
        }
      : null,
    result: j.result ? JSON.parse(j.result) : null,
    error: j.errorCode
      ? {
          code: j.errorCode,
          reasonCode: j.errorReasonCode ?? null,
          message: safeToRegenerate
            ? "Reserved output is unavailable. This local media operation may be submitted again with a new idempotency key"
            : j.errorCode === "EXECUTE_NOT_STARTED"
              ? "Code never started. You may intentionally choose a new execution with a new key; this operation is never replayed automatically"
              : j.errorCode === "WORKER_NOT_CONFIGURED"
                ? "Ask the service operator to configure WORKER_URL and WORKER_TOKEN; no rendering started"
                : j.errorCode === "PROVIDER_NOT_CONFIGURED"
                  ? "Ask the service operator to configure the provider credential; no paid request sent"
                  : canReconcile
                    ? "Persisted output is available for reconciliation; do not generate again"
                    : "Inspect job state; do not automatically repeat generation",
          recovery: {
            kind: safeToRegenerate
              ? "regenerate"
              : j.errorCode.endsWith("NOT_CONFIGURED")
                ? "configure_service"
                : canReconcile
                  ? "reconcile"
                  : "inspect_job",
            safeToRegenerate,
          },
          effect: j.errorEffect ?? "unknown",
        }
      : null,
  };
}
const getArgs = { jobId: v.id("videoJobs") };
export const getJob = query({
  args: getArgs,
  handler: async (ctx, args) => {
    await identity(ctx);
    return publicJob(await job(ctx, args.jobId));
  },
});
export const agentGetJob = internalQuery({
  args: { ...getArgs, videoPrincipalId: v.id("users") },
  handler: async (ctx, args) => {
    await identity(ctx, args.videoPrincipalId);
    return publicJob(await job(ctx, args.jobId));
  },
});
export const agentLookupJob = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    kind: v.string(),
    idempotencyKey: v.string(),
    videoPrincipalId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await identity(ctx, args.videoPrincipalId);
    const j = await ctx.db
      .query("videoJobs")
      .withIndex("by_principalId_and_workspaceId_and_kind_and_idempotencyKey", (q) =>
        q
          .eq("principalId", args.videoPrincipalId)
          .eq("workspaceId", args.workspaceId)
          .eq("kind", args.kind)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (!j)
      return error(
        "NOT_FOUND_OR_FORBIDDEN",
        "Operation unavailable; this does not prove absence of external effects",
      );
    return publicJob(j);
  },
});
export const agentGetEffects = internalQuery({
  args: {
    jobId: v.id("videoJobs"),
    videoPrincipalId: v.id("users"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await identity(ctx, args.videoPrincipalId);
    await job(ctx, args.jobId);
    if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
      error("VALIDATION_ERROR", "Page size must be 1–100");
    const result = await ctx.db
      .query("videoJobEffects")
      .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", args.jobId))
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((r) => ({
        callId: r.callId,
        tool: r.tool,
        inputHash: r.inputHash,
        state: r.state,
        result: r.result ? JSON.parse(r.result) : null,
      })),
    };
  },
});
export const agentGetEffect = internalQuery({
  args: { jobId: v.id("videoJobs"), callId: v.string(), videoPrincipalId: v.id("users") },
  handler: async (ctx, args) => {
    await identity(ctx, args.videoPrincipalId);
    await job(ctx, args.jobId);
    const row = await ctx.db
      .query("videoJobEffects")
      .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", args.jobId).eq("callId", args.callId))
      .unique();
    return row
      ? {
          callId: row.callId,
          tool: row.tool,
          inputHash: row.inputHash,
          state: row.state,
          result: row.result ? JSON.parse(row.result) : null,
        }
      : null;
  },
});
const listJobArgs = {
  workspaceId: v.id("workspaces"),
  projectId: v.optional(v.id("videoProjects")),
  state: v.optional(v.string()),
  kind: v.optional(v.string()),
  paginationOpts: paginationOptsValidator,
};
async function listJobRows(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"videoProjects">;
    state?: string;
    kind?: string;
    paginationOpts: PaginationOptions;
  },
  principal?: Id<"users">,
) {
  await identity(ctx, principal);
  if (args.state && !JobState.safeParse(args.state).success)
    error("VALIDATION_ERROR", "Unknown job state");
  if (args.kind && !JobRequest.options.some((option) => option.shape.kind.value === args.kind))
    error("VALIDATION_ERROR", "Unknown job kind");
  if (args.projectId && (await ctx.db.get(args.projectId))?.workspaceId !== args.workspaceId)
    error("NOT_FOUND_OR_FORBIDDEN", "Project unavailable");
  if (args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100)
    error("VALIDATION_ERROR", "Page size must be 1–100");
  const rows = await ctx.db
    .query("videoJobs")
    .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
    .order("desc")
    .filter((q) =>
      q.and(
        ...[
          ...(args.projectId ? [q.eq(q.field("projectId"), args.projectId)] : []),
          ...(args.state ? [q.eq(q.field("state"), args.state)] : []),
          ...(args.kind ? [q.eq(q.field("kind"), args.kind)] : []),
        ],
      ),
    )
    .paginate(args.paginationOpts);
  return {
    ...rows,
    page: rows.page.map(publicJob),
  };
}
export const listJobs = query({
  args: listJobArgs,
  handler: (ctx, args) => listJobRows(ctx, args),
});
export const agentListJobs = internalQuery({
  args: { ...listJobArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => listJobRows(ctx, args, videoPrincipalId),
});

const listOperationArgs = {
  workspaceId: v.id("workspaces"),
  projectId: v.optional(v.id("videoProjects")),
  kind: v.optional(v.string()),
  limit: v.optional(v.number()),
};
async function listOperationRows(
  ctx: QueryCtx,
  args: {
    workspaceId: Id<"workspaces">;
    projectId?: Id<"videoProjects">;
    kind?: string;
    limit?: number;
  },
  principal?: Id<"users">,
) {
  await identity(ctx, principal);
  const limit = args.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    error("VALIDATION_ERROR", "Operation limit must be 1–50");
  if (args.projectId && (await ctx.db.get(args.projectId))?.workspaceId !== args.workspaceId)
    error("NOT_FOUND_OR_FORBIDDEN", "Project unavailable");
  const rows = await ctx.db
    .query("videoJobs")
    .withIndex("by_workspaceId_and_createdAt", (q) => q.eq("workspaceId", args.workspaceId))
    .order("desc")
    .filter((q) =>
      q.and(
        ...[
          ...(args.projectId ? [q.eq(q.field("projectId"), args.projectId)] : []),
          ...(args.kind ? [q.eq(q.field("kind"), args.kind)] : []),
        ],
      ),
    )
    .take(100);
  const operationIds: string[] = [];
  for (const row of rows) {
    if (!operationIds.includes(row.operationId)) operationIds.push(row.operationId);
    if (operationIds.length === limit) break;
  }
  return Promise.all(
    operationIds.map(async (operationId) => {
      const attempts = (
        await ctx.db
          .query("videoJobs")
          .withIndex("by_operationId_and_attemptNumber", (q) => q.eq("operationId", operationId))
          .order("desc")
          .collect()
      ).map(publicJob);
      const latestAttempt = attempts[0];
      if (!latestAttempt) throw new Error("Video operation has no attempts");
      const latestSuccessfulAttempt =
        attempts.find((attempt) => attempt.state === "succeeded") ?? null;
      return {
        operationId,
        kind: latestAttempt.kind,
        latestAttempt,
        latestSuccessfulAttempt,
        attempts,
        retryCount: Math.max(0, attempts.length - 1),
      };
    }),
  );
}
export const listOperations = query({
  args: listOperationArgs,
  handler: (ctx, args) => listOperationRows(ctx, args),
});
export const agentListOperations = internalQuery({
  args: { ...listOperationArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, { videoPrincipalId, ...args }) => listOperationRows(ctx, args, videoPrincipalId),
});

export const regenerate = mutation({
  args: { jobId: v.id("videoJobs") },
  handler: async (ctx, args) => {
    const principalId = await identity(ctx);
    const source = await job(ctx, args.jobId);
    const exposed = publicJob(source);
    if (
      exposed.error?.recovery.kind !== "regenerate" ||
      exposed.error.recovery.safeToRegenerate !== true ||
      !["render", "media"].includes(source.kind)
    )
      error("REGENERATION_UNSAFE", "This operation is not explicitly safe to regenerate");
    const latest = await ctx.db
      .query("videoJobs")
      .withIndex("by_operationId_and_attemptNumber", (q) => q.eq("operationId", source.operationId))
      .order("desc")
      .first();
    if (!latest || latest._id !== source._id)
      error("REGENERATION_CONFLICT", "A newer attempt already exists; inspect the operation");
    const request = JobRequest.parse(JSON.parse(source.request));
    const next = await submitJob(
      ctx,
      {
        workspaceId: source.workspaceId,
        ...(source.projectId ? { projectId: source.projectId } : {}),
        ...(source.versionId ? { versionId: source.versionId } : {}),
        idempotencyKey: crypto.randomUUID(),
        request,
      },
      principalId,
      {
        operationId: source.operationId,
        attemptNumber: source.attemptNumber + 1,
        retryOfJobId: source._id,
      },
    );
    emitVideoMetric("retry_count", {
      jobId: next.jobId,
      operationId: source.operationId,
      value: source.attemptNumber,
      kind: source.kind,
    });
    return next;
  },
});
async function cancelJob(
  ctx: MutationCtx,
  args: { jobId: Id<"videoJobs"> },
  principal?: Id<"users">,
) {
  await identity(ctx, principal);
  const j = await job(ctx, args.jobId);
  if (["succeeded", "failed", "cancelled", "outcome_unknown"].includes(j.state))
    return publicJob(j);
  const state = j.state === "queued" ? "cancelled" : "cancel_requested";
  await ctx.db.patch(j._id, {
    state,
    cancelRequestedAt: j.cancelRequestedAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  return publicJob({ ...j, state });
}
export const cancel = mutation({
  args: getArgs,
  handler: (ctx, args) => cancelJob(ctx, args),
});
export const agentCancel = internalMutation({
  args: { ...getArgs, videoPrincipalId: v.id("users") },
  handler: (ctx, args) => cancelJob(ctx, args, args.videoPrincipalId),
});
export const claim = internalMutation({
  args: { ...getArgs, videoPrincipalId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const j = await job(ctx, args.jobId);
    if (args.videoPrincipalId && j.kind !== "execute")
      error("NOT_FOUND_OR_FORBIDDEN", "Only the trusted provider executor may claim media jobs");
    if (args.videoPrincipalId && j.principalId !== args.videoPrincipalId)
      error("NOT_FOUND_OR_FORBIDDEN", "Cannot claim another principal's execution");
    if (j.state !== "queued") return null;
    await assertVideoProductionAllowed(ctx, j);
    const active = await ctx.db
      .query("videoJobs")
      .withIndex("by_state_and_createdAt", (q) => q.eq("state", "running"))
      .take(4);
    if (active.length >= 3)
      error("CAPACITY_EXCEEDED", "Wait for an existing job; do not resubmit provider request");
    const fence = j.fence + 1;
    await ctx.db.patch(j._id, {
      state: "running",
      stage: "claimed",
      fence,
      updatedAt: Date.now(),
    });
    const request = JobRequest.parse(JSON.parse(j.request));
    await ctx.scheduler.runAfter(
      request.kind === "execute" ? request.timeoutMs + 10000 : 900000,
      makeFunctionReference<"mutation">("videoJobs:expireClaim"),
      { jobId: j._id, fence },
    );
    return {
      ...j,
      state: "running" as const,
      fence,
      request: JobRequest.parse(JSON.parse(j.request)),
    };
  },
});
export const failAdmission = internalMutation({
  args: { jobId: v.id("videoJobs"), code: v.string() },
  handler: async (ctx, args) => {
    const j = await job(ctx, args.jobId);
    if (j.state !== "queued") return;
    await ctx.db.patch(j._id, {
      state: "failed",
      stage: "admission_exhausted",
      errorCode: args.code,
      errorEffect: "not_applied",
      updatedAt: Date.now(),
    });
  },
});
const fenceArgs = {
  jobId: v.id("videoJobs"),
  fence: v.number(),
  videoPrincipalId: v.optional(v.id("users")),
};
async function fenced(
  ctx: MutationCtx,
  args: {
    jobId: Id<"videoJobs">;
    fence: number;
    videoPrincipalId?: Id<"users">;
  },
) {
  const j = await job(ctx, args.jobId);
  if (args.videoPrincipalId && j.kind !== "execute")
    error("NOT_FOUND_OR_FORBIDDEN", "Only the trusted provider executor may complete media jobs");
  if (args.videoPrincipalId && j.principalId !== args.videoPrincipalId)
    error("NOT_FOUND_OR_FORBIDDEN", "Execution principal mismatch");
  if (j.fence !== args.fence || !["running", "cancel_requested"].includes(j.state))
    error("STALE_FENCE", "Job claim no longer owns completion");
  return j;
}
export const markDispatch = internalMutation({
  args: { ...fenceArgs, providerRequestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const j = await fenced(ctx, args);
    if (!args.providerRequestId) await assertVideoProductionAllowed(ctx, j);
    await ctx.db.patch(args.jobId, {
      stage: "dispatched",
      ...(args.providerRequestId ? { providerRequestId: args.providerRequestId } : {}),
      updatedAt: Date.now(),
    });
  },
});
export const retryBusyRender = internalMutation({
  args: { jobId: v.id("videoJobs"), fence: v.number(), attempt: v.number() },
  handler: async (ctx, args) => {
    const j = await fenced(ctx, args);
    if (j.kind !== "render") throw new Error("Only unpaid render may retry worker admission");
    if (args.attempt >= 30) {
      await ctx.db.patch(j._id, {
        state: "failed",
        stage: "worker_capacity_exhausted",
        errorCode: "WORKER_BUSY",
        errorEffect: "not_applied",
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(j._id, {
      state: "queued",
      stage: "waiting_worker",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(5000, makeFunctionReference<"action">("videoRender:run"), {
      jobId: j._id,
      admissionAttempt: args.attempt + 1,
    });
  },
});
export const confirmCancelled = internalMutation({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    await fenced(ctx, args);
    await ctx.db.patch(args.jobId, {
      state: "cancelled",
      stage: "provider_confirmed_cancel",
      updatedAt: Date.now(),
    });
  },
});
export const savePersistenceReceipt = internalMutation({
  args: {
    jobId: v.id("videoJobs"),
    fence: v.number(),
    receipt: PersistenceReceiptValidator,
  },
  handler: async (ctx, args) => {
    const j = await fenced(ctx, args);
    bounded(args.receipt, 262144);
    if (args.receipt.kind !== j.kind)
      error("PERSISTENCE_RECEIPT_INVALID", "Receipt kind differs from job");
    const previous = j.persistenceReceipt;
    const rank = { reserved: 0, partially_persisted: 1, persisted: 2, source_unavailable: 3 };
    if (
      previous &&
      (previous.kind !== args.receipt.kind ||
        previous.state === "source_unavailable" ||
        (args.receipt.state !== "source_unavailable" &&
          rank[args.receipt.state] < rank[previous.state]))
    )
      error("PERSISTENCE_RECEIPT_INVALID", "Persistence state cannot move backwards");
    await ctx.db.patch(args.jobId, {
      persistenceReceipt: args.receipt,
      stage: persistenceStage(args.receipt),
      updatedAt: Date.now(),
    });
  },
});
export async function completeVideoJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<"videoJobs">;
    fence: number;
    videoPrincipalId?: Id<"users">;
    result: unknown;
  },
) {
  const j = await fenced(ctx, args);
  bounded(args.result, 262144);
  let stale = false;
  if (j.kind === "shot") {
    const request = JobRequest.parse(JSON.parse(j.request));
    if (request.kind === "shot") {
      const draftId = ctx.db.normalizeId("videoDrafts", request.draftId),
        draft = draftId ? await ctx.db.get(draftId) : null;
      stale = !draft || draft.scriptRevision !== request.scriptRevision;
    }
  }
  if (j.versionId) {
    const version = await ctx.db.get(j.versionId);
    const d = version ? await ctx.db.get(version.draftId) : null;
    stale =
      stale ||
      (!!d &&
        (d.scriptRevision !== version?.scriptRevision ||
          d.timelineRevision !== version?.timelineRevision));
  }
  const executionFailed =
    j.kind === "execute" &&
    typeof args.result === "object" &&
    args.result !== null &&
    "success" in args.result &&
    args.result.success === false;
  await ctx.db.patch(j._id, {
    state: executionFailed ? "failed" : "succeeded",
    stage: "persisted",
    result: canonical(args.result),
    ...(executionFailed
      ? { errorCode: "CODE_EXECUTION_FAILED", errorEffect: "unknown" as const }
      : { errorCode: undefined, errorReasonCode: undefined, errorEffect: undefined }),
    stale,
    updatedAt: Date.now(),
  });
  const completed = await ctx.db.get(j._id);
  if (!completed) throw new Error("Completed video job was not readable after patch");
  return publicJob(completed);
}
export const complete = internalMutation({
  args: { ...fenceArgs, result: v.any() },
  handler: completeVideoJob,
});
export const fail = internalMutation({
  args: {
    ...fenceArgs,
    code: v.string(),
    reasonCode: v.optional(v.string()),
    outcomeUnknown: v.boolean(),
    stage: v.optional(v.string()),
    persistenceSourceUnavailable: v.optional(v.boolean()),
    effect: v.optional(
      v.union(
        v.literal("none"),
        v.literal("not_applied"),
        v.literal("applied"),
        v.literal("partial"),
        v.literal("unknown"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const j = await fenced(ctx, args);
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(args.code)) error("VALIDATION_ERROR", "Invalid error code");
    if (args.reasonCode && !/^[A-Z][A-Z0-9_]{0,79}$/.test(args.reasonCode))
      error("VALIDATION_ERROR", "Invalid error reason code");
    if (
      ["render", "media"].includes(j.kind) &&
      (args.effect === "not_applied" ||
        args.persistenceSourceUnavailable === true ||
        args.stage === "recovery_source_unavailable")
    )
      await releaseReservedObjectLeases(ctx, j);
    await ctx.db.patch(j._id, {
      state: args.outcomeUnknown ? "outcome_unknown" : "failed",
      ...(args.persistenceSourceUnavailable && j.persistenceReceipt
        ? {
            persistenceReceipt: markSourceUnavailable(j.persistenceReceipt),
            stage: "recovery_source_unavailable",
          }
        : args.stage
          ? { stage: args.stage }
          : {}),
      errorCode: args.code,
      errorReasonCode: args.reasonCode,
      errorEffect: args.effect ?? "unknown",
      updatedAt: Date.now(),
    });
    if (args.code === "RESULT_PERSISTENCE_FAILED")
      emitVideoMetric(
        "result_persistence_failed",
        {
          jobId: j._id,
          operationId: j.operationId,
          attemptNumber: j.attemptNumber,
          kind: j.kind,
          effect: args.effect ?? "unknown",
        },
        { alert: args.outcomeUnknown },
      );
    if (args.persistenceSourceUnavailable)
      emitVideoMetric(
        "recovery_source_unavailable",
        {
          jobId: j._id,
          operationId: j.operationId,
          kind: j.kind,
        },
        { alert: true },
      );
  },
});
export const recordEffect = internalMutation({
  args: {
    ...fenceArgs,
    callId: v.string(),
    tool: v.string(),
    inputHash: v.string(),
    state: v.union(
      v.literal("dispatching"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await fenced(ctx, args);
    const existing = await ctx.db
      .query("videoJobEffects")
      .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", args.jobId).eq("callId", args.callId))
      .unique();
    if (existing && (existing.inputHash !== args.inputHash || existing.tool !== args.tool))
      error("IDEMPOTENCY_CONFLICT", "Effect call ID reused");
    if (existing && args.state === "dispatching")
      return {
        created: false,
        existing: {
          state: existing.state,
          result: existing.result ? JSON.parse(existing.result) : null,
        },
      };
    if (existing && existing.state !== "dispatching")
      return {
        created: false,
        existing: {
          state: existing.state,
          result: existing.result ? JSON.parse(existing.result) : null,
        },
      };
    if (!existing && args.state !== "dispatching")
      error("INVALID_EFFECT_STATE", "An effect must be durably admitted before dispatch");
    if (args.result !== undefined) bounded(args.result, 131072);
    const data = {
      jobId: args.jobId,
      callId: args.callId,
      tool: args.tool,
      inputHash: args.inputHash,
      state: args.state,
      ...(args.result !== undefined ? { result: canonical(args.result) } : {}),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, data);
    else await ctx.db.insert("videoJobEffects", data);
    return { created: !existing };
  },
});
export const expireClaim = internalMutation({
  args: { jobId: v.id("videoJobs"), fence: v.number() },
  handler: async (ctx, args) => {
    const j = await job(ctx, args.jobId);
    if (j.fence !== args.fence || !["running", "cancel_requested"].includes(j.state)) return;
    await ctx.db.patch(j._id, {
      state: "outcome_unknown",
      stage: "lease_expired",
      errorCode: "EXECUTOR_DISCONNECTED",
      updatedAt: Date.now(),
    });
    const effects = await ctx.db
      .query("videoJobEffects")
      .withIndex("by_jobId_and_callId", (q) => q.eq("jobId", j._id))
      .take(100);
    for (const effect of effects)
      if (effect.state === "dispatching")
        await ctx.db.patch(effect._id, {
          state: "unknown",
          updatedAt: Date.now(),
        });
  },
});
