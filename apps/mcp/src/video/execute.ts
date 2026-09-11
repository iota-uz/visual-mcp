import { createHash, randomBytes } from "node:crypto";
import { ExecutionResult as executionResult, JobResult } from "@visual-canvas/video/results";
import type { Hono } from "hono";
import { z } from "zod";
import { getWorkerConfig } from "../lib/worker.js";
import { openCursor, sealCursor } from "./cursor.js";
import {
  callVideoTool,
  continuation,
  type Definition,
  inputFailure,
  pageResult,
  snapshotQuery,
  type VideoBackend,
  VideoDomainError,
  videoRegistry,
} from "./registry.js";

const id = z.string().min(1).max(200);
export const executeInput = z
  .object({
    workspace_id: id,
    idempotency_key: id,
    code: z
      .string()
      .min(1)
      .refine((v) => Buffer.byteLength(v) <= 65536, "Code exceeds 65536 UTF-8 bytes"),
    inputs: z
      .record(z.string(), z.json())
      .default({})
      .refine(
        (v) => Buffer.byteLength(JSON.stringify(v)) <= 262144,
        "Inputs exceed 262144 UTF-8 bytes",
      ),
    tool_access: z
      .enum(["read_only", "read_write"])
      .default("read_only")
      .describe("Restricts tools.* only, not direct network calls."),
    timeout_ms: z.number().int().min(1).max(60000).default(5000),
    memory_limit_mb: z
      .number()
      .int()
      .min(16)
      .max(1024)
      .default(128)
      .describe("V8 heap limit, not RSS or VM RAM quota."),
    max_tool_calls: z.number().int().min(1).max(100).default(30),
    max_concurrency: z.number().int().min(1).max(4).default(1),
    max_output_bytes: z.number().int().min(256).max(131072).default(32768),
  })
  .strict();
const jobKind = z.enum([
  "execute",
  "image",
  "voice",
  "shot",
  "critique",
  "render",
  "media",
  "memory_validation",
  "offline_eval",
  "analytics_import",
]);
const state = z.enum([
  "queued",
  "running",
  "cancel_requested",
  "cancelled",
  "succeeded",
  "failed",
  "outcome_unknown",
]);
const receiptSchema = z
  .object({
    job_id: id,
    run_id: id,
    state,
    replayed: z.boolean(),
    poll_after_ms: z.number(),
    operation: z.object({ idempotency_key: id, tool: jobKind }).strict(),
  })
  .strict();
const jobSchema = receiptSchema.extend({
  workspace_id: id,
  project_id: id.nullable(),
  version_id: id.nullable(),
  stale: z.boolean(),
  context: z
    .object({ draftId: id, scriptRevision: id, sceneId: id, shotId: id, profileId: id })
    .strict()
    .nullable(),
  stage: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  result: JobResult.nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      effect: z.string(),
      recovery: z
        .object({
          kind: z.enum(["configure_service", "reconcile", "inspect_job", "regenerate"]),
          safeToRegenerate: z.boolean(),
        })
        .optional(),
    })
    .nullable(),
  effects: z
    .object({
      items: z.array(
        z
          .object({
            call_id: id,
            tool: id,
            input_hash: id,
            state: z.enum(["dispatching", "succeeded", "failed", "unknown"]),
            result_available: z.boolean(),
          })
          .strict(),
      ),
      complete: z.boolean(),
      next_cursor: z.string().nullable(),
    })
    .strict(),
});
const record = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
function receipt(raw: unknown) {
  const j = record(raw),
    operation = record(j.operation);
  return {
    job_id: j.jobId,
    run_id: j.jobId,
    state: j.state,
    replayed: j.replayed,
    poll_after_ms: j.pollAfterMs,
    operation: { tool: jobKind.parse(j.kind), idempotency_key: operation.idempotencyKey },
  };
}
async function jobResult(raw: unknown, call: VideoBackend) {
  const j = record(raw);
  const effects = record(
    await call("getJobEffects", {
      jobId: j.jobId,
      paginationOpts: { numItems: 100, cursor: null },
    }),
  );
  return {
    ...receipt(j),
    workspace_id: j.workspaceId,
    project_id: j.projectId ?? null,
    version_id: j.versionId ?? null,
    stale: j.stale ?? false,
    context: j.context ?? null,
    stage: j.stage,
    created_at: new Date(z.number().parse(j.createdAt)).toISOString(),
    updated_at: new Date(z.number().parse(j.updatedAt)).toISOString(),
    result: j.result,
    error: j.error,
    effects: {
      items: z
        .array(z.record(z.string(), z.unknown()))
        .parse(effects.page)
        .map((e) => ({
          call_id: e.callId,
          tool: e.tool,
          input_hash: e.inputHash,
          state: e.state,
          result_available: e.result !== null,
        })),
      complete: effects.isDone,
      next_cursor: effects.isDone ? null : effects.continueCursor,
    },
  };
}
function registryRevision(call?: VideoBackend) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        (call?.catalog?.tools ?? videoRegistry).map((d) => ({
          name: d.name,
          readOnly: d.readOnly,
          input: z.toJSONSchema(d.input, { io: "input" }),
          output: z.toJSONSchema(d.output),
        })),
      ),
    )
    .digest("hex");
}
type Active = {
  input: z.infer<typeof executeInput>;
  call: VideoBackend;
  fence: number;
  revision: string;
  calls: number;
  concurrent: number;
  expires: number;
  jobId: string;
  seen: Set<string>;
};
const active = new Map<string, Active>();

async function checkScope(run: Active, name: string, input: Record<string, unknown>) {
  const d = (run.call.catalog?.tools ?? videoRegistry).find((tool) => tool.name === name);
  if (!d || name === "execute" || name === "canvas_run")
    throw new VideoDomainError("TOOL_NOT_AVAILABLE", "Nested code execution is not permitted.");
  if (run.input.tool_access === "read_only" && !d.readOnly)
    throw new VideoDomainError(
      "READ_ONLY",
      "This run permits only read-only broker calls; raw network is not covered.",
    );
  if ("invoke" in d && d.invoke) {
    await run.call.catalog?.checkScope(name, input, run.input.workspace_id);
    return;
  }
  let workspace =
    input.workspace_id ?? (input.operation ? record(input.operation).workspace_id : undefined);
  if (name === "resource_get" && String(input.uri).startsWith("video://reports/")) {
    const jobId = /^video:\/\/reports\/([^/]+)\//.exec(String(input.uri))?.[1];
    const job = record(await run.call("getJob", { jobId: decodeURIComponent(jobId ?? "") }));
    if (job.workspaceId !== run.input.workspace_id)
      throw new VideoDomainError("SCOPE_MISMATCH", "Report belongs to another execute workspace.");
    return;
  }
  if (["video_rubric_resolve", "voice_list", "resource_get", "resource_find"].includes(name))
    workspace = run.input.workspace_id;
  let project = input.project_id;
  if (input.comment_id && name.startsWith("video_comment_"))
    workspace = record(
      await run.call("getVideoComment", { commentId: input.comment_id }),
    ).workspaceId;
  if (input.target) {
    const target = record(input.target);
    if (target.draftId)
      project = record(await run.call("getDraft", { draftId: target.draftId })).projectId;
    if (target.jobId)
      workspace = record(await run.call("getJob", { jobId: target.jobId })).workspaceId;
  }
  if (input.draft_id)
    project = record(await run.call("getDraft", { draftId: input.draft_id })).projectId;
  if (input.version_id)
    project = record(
      record(await run.call("getVersion", { versionId: input.version_id })).version,
    ).projectId;
  if (input.profile_id)
    project = record(await run.call("getProfile", { profileId: input.profile_id })).projectId;
  if (input.loop_id)
    project = record(await run.call("getLoop", { loopId: input.loop_id })).projectId;
  if (input.publication_id)
    project = record(
      record(await run.call("getPublication", { publicationId: input.publication_id })).record,
    ).projectId;
  if (input.memory_id)
    workspace = record(
      await run.call("getMemoryRecord", { memoryId: input.memory_id }),
    ).workspaceId;
  if (input.eval_id)
    workspace = record(await run.call("getEval", { evalId: input.eval_id })).workspaceId;
  if (input.upload_id)
    workspace = record(await run.call("getUpload", { uploadId: input.upload_id })).workspaceId;
  if (project) workspace = record(await run.call("getProject", { projectId: project })).workspaceId;
  if (input.job_id)
    workspace = record(await run.call("getJob", { jobId: input.job_id })).workspaceId;
  if (workspace !== run.input.workspace_id)
    throw new VideoDomainError("SCOPE_MISMATCH", "Tool target is outside this execute workspace.");
}
async function brokerCall(run: Active, name: string, args: Record<string, unknown>) {
  const tool = run.call.catalog?.tools.find((tool) => tool.name === name);
  if (!tool?.invoke) return callVideoTool(name, args, run.call);
  const parsed = tool.input.safeParse(args);
  if (!parsed.success)
    return failure(
      new VideoDomainError(
        "VALIDATION_ERROR",
        "Invalid Canvas tool arguments; no business handler ran.",
        "not_applied",
        {
          kind: "fix_input",
          fields: parsed.error.issues.map((issue) => ({
            path: `/${issue.path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`,
            reason: issue.message,
          })),
        },
      ),
    );
  const result = await tool.invoke(record(parsed.data));
  if (!result.isError) tool.output.parse(result.structuredContent);
  return result;
}
function unknownEffect(result: { isError?: boolean; structuredContent?: unknown }) {
  if (!result.isError) return false;
  const payload = result.structuredContent;
  if (!payload || typeof payload !== "object") return true;
  const error = record(payload).error;
  if (!error || typeof error !== "object") return true;
  const effect = record(error).effect ?? record(error).write_outcome;
  return !["none", "not_applied"].includes(String(effect));
}
function failure(error: unknown) {
  const known = error instanceof VideoDomainError;
  const payload = {
    ok: false,
    error: {
      code: known ? error.code : "BROKER_UNAVAILABLE",
      message: known
        ? error.message
        : "Broker outcome could not be confirmed; inspect the run journal.",
      effect: known ? error.effect : "unknown",
      recovery:
        known && error.recovery
          ? error.recovery
          : {
              kind: "request_human",
              reason: "Inspect this execution before choosing further writes.",
            },
    },
  };
  return {
    isError: true,
    structuredContent: payload,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}
export function registerExecuteCallback(app: Hono) {
  app.post("/internal/video-execute-broker", async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer /, "");
    const run = token ? active.get(token) : undefined;
    if (!run || run.expires < Date.now())
      return c.json({ error: "Execution capability unavailable" }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({ runId: id, callId: id, name: id, args: z.record(z.string(), z.json()) })
      .strict()
      .safeParse(body);
    if (!parsed.success || parsed.data.runId !== run.jobId)
      return c.json({ error: "Invalid execution call" }, 400);
    const { callId, name, args } = parsed.data;
    if (run.seen.has(callId))
      return c.json(
        failure(
          new VideoDomainError("DUPLICATE_CALL", "A broker call ID cannot be dispatched twice."),
        ),
      );
    run.seen.add(callId);
    if (++run.calls > run.input.max_tool_calls || run.concurrent >= run.input.max_concurrency)
      return c.json(
        failure(new VideoDomainError("CALL_LIMIT", "Execute call/concurrency limit exceeded.")),
      );
    run.concurrent++;
    let dispatched = false;
    const inputHash = createHash("sha256")
      .update(JSON.stringify([name, args]))
      .digest("hex");
    try {
      if (run.revision !== registryRevision(run.call))
        throw new VideoDomainError(
          "SCHEMA_CHANGED",
          "Tool registry changed. No new call was dispatched.",
        );
      const job = record(await run.call("getJob", { jobId: run.jobId }));
      if (job.state !== "running")
        throw new VideoDomainError(
          "EXECUTION_STOPPED",
          "Execution is no longer running; no new calls allowed.",
        );
      const definition = (run.call.catalog?.tools ?? videoRegistry).find(
        (tool) => tool.name === name,
      );
      if (!definition)
        throw new VideoDomainError("TOOL_NOT_AVAILABLE", "Tool is not in this endpoint catalog.");
      const validated = definition.input.safeParse(args);
      if (!validated.success) return c.json(inputFailure(validated.error));
      await checkScope(run, name, record(validated.data));
      const admitted = await run.call("recordEffect", {
        jobId: run.jobId,
        fence: run.fence,
        callId,
        tool: name,
        inputHash,
        state: "dispatching",
      });
      if (admitted && record(admitted).created === false)
        throw new VideoDomainError(
          "DUPLICATE_CALL",
          "A durable broker call already exists; it will not be repeated.",
        );
      dispatched = true;
      const result = await brokerCall(run, name, args);
      await run.call("recordEffect", {
        jobId: run.jobId,
        fence: run.fence,
        callId,
        tool: name,
        inputHash,
        state: result.isError ? (unknownEffect(result) ? "unknown" : "failed") : "succeeded",
        result,
      });
      return c.json(result);
    } catch (error) {
      if (dispatched)
        await run
          .call("recordEffect", {
            jobId: run.jobId,
            fence: run.fence,
            callId,
            tool: name,
            inputHash,
            state: "unknown",
          })
          .catch(() => {});
      return c.json(failure(error));
    } finally {
      run.concurrent--;
    }
  });
}

async function coordinate(
  jobId: string,
  input: z.infer<typeof executeInput>,
  revision: string,
  call: VideoBackend,
) {
  let fence: number | undefined;
  let token: string | undefined;
  try {
    const claimed = await call("claimJob", { jobId });
    if (!claimed) return;
    fence = z.number().parse(record(claimed).fence);
    token = randomBytes(32).toString("hex");
    active.set(token, {
      input,
      call,
      fence,
      revision,
      calls: 0,
      concurrent: 0,
      expires: Date.now() + input.timeout_ms + 10000,
      jobId,
      seen: new Set(),
    });
    const worker = getWorkerConfig();
    const response = await fetch(new URL("/execute", worker.url), {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${worker.token}`,
      },
      signal: AbortSignal.timeout(input.timeout_ms + 10000),
      body: JSON.stringify({
        code: input.code,
        inputs: input.inputs,
        context: { workspace_id: input.workspace_id, run_id: jobId },
        toolNames: (call.catalog?.tools ?? videoRegistry)
          .filter((d) => d.name !== "execute" && d.name !== "canvas_run")
          .map((d) => d.name),
        timeoutMs: input.timeout_ms,
        memoryLimitMb: input.memory_limit_mb,
        maxToolCalls: input.max_tool_calls,
        maxConcurrency: input.max_concurrency,
        maxOutputBytes: input.max_output_bytes,
        callback: {
          url: new URL(
            "/internal/video-execute-broker",
            process.env.MCP_EXECUTE_BROKER_ORIGIN,
          ).toString(),
          token,
        },
      }),
    });
    if (!response.ok) throw new Error("Worker unavailable");
    const output = record(await response.json());
    const result = executionResult.parse({
      run_id: jobId,
      success: output.success,
      emitted: output.emitted ?? [],
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
      output_truncated: output.outputTruncated ?? false,
      ...(output.error ? { error: output.error } : {}),
      accounting: "broker_only",
      untracked_network_effects_possible: true,
    });
    // Complete stores the execution result even when user code failed; job state
    // and code success are separate. Effects already have their own durable rows.
    await call("completeJob", { jobId, fence, result });
  } catch {
    if (fence !== undefined)
      await call("failJob", {
        jobId,
        fence,
        code: "EXECUTION_OUTCOME_UNKNOWN",
        outcomeUnknown: true,
      }).catch(() => {});
  } finally {
    if (token) active.delete(token);
  }
}
const definitions: Definition[] = [
  {
    name: "job_effect_get",
    readOnly: true,
    description:
      "Recover one durable tools.* effect by job_id and call_id from job_get.effects. Returns the original MCP result as bounded JSON text, including IDs that code failed to emit before crashing. Concatenate result_json chunks then JSON.parse only when complete. Does not rerun the operation; unknown remains unknown.",
    input: z
      .object({
        job_id: id,
        call_id: id,
        max_bytes: z.number().int().min(2048).max(131072).default(32768),
        cursor: z.string().max(3000).optional(),
      })
      .strict(),
    output: z
      .object({
        call_id: id,
        tool: id,
        input_hash: id,
        state: z.enum(["dispatching", "succeeded", "failed", "unknown"]),
        result_available: z.boolean(),
        result_sha256: z.string().nullable(),
        result_json: z.string().nullable(),
        complete: z.boolean(),
        next_cursor: z.string().nullable(),
      })
      .strict(),
    run: async (input, call) => {
      const value = await call("getJobEffect", { jobId: input.job_id, callId: input.call_id });
      if (!value)
        throw new VideoDomainError(
          "EFFECT_NOT_FOUND",
          "No effect row for this execution and call ID; do not infer absence of raw network effects.",
        );
      const row = record(value),
        text = row.result === null || row.result === undefined ? null : JSON.stringify(row.result),
        sha = text === null ? null : createHash("sha256").update(text).digest("hex"),
        key = createHash("sha256")
          .update(JSON.stringify([input.job_id, input.call_id, sha, input.max_bytes]))
          .digest("hex");
      let offset = 0;
      if (input.cursor) {
        try {
          const cursor = z
            .object({
              key: z.string(),
              offset: z.number().int().nonnegative(),
              expires: z.number(),
            })
            .strict()
            .parse(openCursor(String(input.cursor)));
          if (cursor.key !== key || cursor.expires < Date.now()) throw new Error();
          offset = cursor.offset;
        } catch {
          throw new VideoDomainError(
            "CURSOR_MISMATCH",
            "Effect result/cursor changed; read from the start.",
          );
        }
      }
      const bytes = Buffer.from(text ?? "");
      if (offset > bytes.length)
        throw new VideoDomainError("CURSOR_MISMATCH", "Effect cursor exceeds result length.");
      let end = Math.min(bytes.length, offset + Math.floor((Number(input.max_bytes) - 1024) / 6));
      while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
      const complete = end >= bytes.length;
      return {
        call_id: row.callId,
        tool: row.tool,
        input_hash: row.inputHash,
        state: row.state,
        result_available: text !== null,
        result_sha256: sha,
        result_json: text === null ? null : bytes.subarray(offset, end).toString("utf8"),
        complete,
        next_cursor: complete
          ? null
          : sealCursor({ key, offset: end, expires: Date.now() + 3600000 }),
      };
    },
  },
  {
    name: "job_list",
    readOnly: true,
    description:
      "List a frozen bounded job snapshot with optional project/state/kind filters. Maximum 100 records/4 MiB; narrow filters if exceeded. Cursor expires after one hour or server restart/eviction. Metadata only; job_get reads current results/effects.",
    input: z
      .object({
        workspace_id: id,
        project_id: id.optional(),
        state: state.optional(),
        kind: jobKind.optional(),
        cursor: z.string().max(16000).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    output: z
      .object({
        items: z.array(
          receiptSchema.extend({
            workspace_id: id,
            project_id: id.nullable(),
            version_id: id.nullable(),
            stage: z.string(),
            stale: z.boolean(),
            updated_at: z.string(),
          }),
        ),
        next_cursor: z.string().nullable(),
        complete: z.boolean(),
      })
      .strict(),
    run: async (input, call) =>
      pageResult(
        await snapshotQuery(
          call,
          "listJobs",
          {
            workspaceId: input.workspace_id,
            ...(input.project_id ? { projectId: input.project_id } : {}),
            ...(input.state ? { state: input.state } : {}),
            ...(input.kind ? { kind: input.kind } : {}),
            paginationOpts: { numItems: input.limit, cursor: continuation(input, "job_list") },
          },
          input,
          "job_list",
        ),
        (value) => {
          const row = record(value);
          return {
            ...receipt(row),
            workspace_id: row.workspaceId,
            project_id: row.projectId ?? null,
            version_id: row.versionId ?? null,
            stage: row.stage,
            stale: row.stale ?? false,
            updated_at: new Date(z.number().parse(row.updatedAt)).toISOString(),
          };
        },
        input,
        "job_list",
      ),
  },
  {
    name: "execute",
    readOnly: false,
    description:
      "Compose Video Studio tools in TypeScript with top-level await; no wrapper needed. Use tools.<published_name>(args), inputs, context and emit(value). Returns a durable job receipt; poll job_get. Not a transaction: tool_access limits only broker calls, arbitrary network remains possible and untracked. No automatic code replay. Use a direct tool for a single simple call.",
    input: executeInput,
    output: receiptSchema,
    run: async (raw, call) => {
      const input = executeInput.parse(raw);
      if (
        !process.env.WORKER_URL ||
        !process.env.WORKER_TOKEN ||
        !process.env.MCP_EXECUTE_BROKER_ORIGIN
      )
        throw new VideoDomainError(
          "CAPABILITY_NOT_AVAILABLE",
          "Execute worker/broker is not configured.",
        );
      const revision = registryRevision(call);
      const result = record(
        await call("submitJob", {
          workspaceId: input.workspace_id,
          idempotencyKey: input.idempotency_key,
          request: {
            kind: "execute",
            code: input.code,
            inputs: input.inputs,
            toolAccess: input.tool_access,
            timeoutMs: input.timeout_ms,
            memoryLimitMb: input.memory_limit_mb,
            maxToolCalls: input.max_tool_calls,
            maxConcurrency: input.max_concurrency,
            maxOutputBytes: input.max_output_bytes,
            registryRevision: revision,
          },
        }),
      );
      // A replayed queued receipt has not executed code; atomic claim decides the
      // single owner. Running/terminal receipts never restart user code.
      if (result.state === "queued")
        setTimeout(() => {
          void coordinate(id.parse(result.jobId), input, revision, call);
        }, 0);
      return receipt(result);
    },
  },
  {
    name: "job_get",
    readOnly: true,
    description:
      "Read an execution/media/learning job and typed result. Failed work is data, not a failed read. Reconcile by exact ID or original operation kind/key. Never create a new operation to recover unknown effects unless recovery.kind=regenerate and safeToRegenerate=true explicitly authorize a new idempotency key for a local render/media operation whose stored bytes are proven unavailable.",
    input: z
      .object({
        job_id: id.optional(),
        operation: z
          .object({ workspace_id: id, idempotency_key: id, tool: jobKind.default("execute") })
          .strict()
          .optional(),
      })
      .strict()
      .refine(
        (v) => Number(v.job_id !== undefined) + Number(v.operation !== undefined) === 1,
        "Provide either job_id or original operation key, not both.",
      ),
    output: jobSchema,
    run: async (i, call) =>
      jobResult(
        await (i.job_id
          ? call("getJob", { jobId: i.job_id })
          : call("lookupJob", {
              workspaceId: record(i.operation).workspace_id,
              idempotencyKey: record(i.operation).idempotency_key,
              kind: record(i.operation).tool,
            })),
        call,
      ),
  },
  {
    name: "job_cancel",
    readOnly: false,
    description:
      "Request job cancellation. Stops new broker/producer dispatch where possible; running provider work may still complete and be charged. Cancellation request is not confirmation and never rolls back earlier effects.",
    input: z.object({ job_id: id }).strict(),
    output: jobSchema,
    run: async (i, call) => jobResult(await call("cancelJob", { jobId: i.job_id }), call),
  },
];
/** Advertise only once worker transport is configured; no unavailable tool stubs. */
export function enableExecuteTools() {
  for (const definition of definitions.filter((d) => d.name !== "execute"))
    if (!videoRegistry.some((d) => d.name === definition.name)) videoRegistry.push(definition);
  if (
    process.env.WORKER_URL &&
    process.env.WORKER_TOKEN &&
    process.env.MCP_EXECUTE_BROKER_ORIGIN &&
    !videoRegistry.some((d) => d.name === "execute")
  )
    videoRegistry.push(...definitions.filter((d) => d.name === "execute"));
}
