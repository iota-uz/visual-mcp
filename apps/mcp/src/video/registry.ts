import { createHash } from "node:crypto";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  Brief,
  Format,
  Language,
  Patch,
  Script,
  StaleDependency,
  Timeline,
} from "@visual-canvas/video";
import { z } from "zod";
import { learningDefinitions } from "./learning.js";
import { providerDefinitions } from "./providers.js";
import { resourceDefinitions } from "./resources.js";
import { reviewDefinitions } from "./review.js";
import { workflowDefinitions } from "./workflow.js";

const id = z.string().min(1).max(200);
const write = {
  idempotency_key: id.describe(
    "Stable key for this logical operation; reuse unchanged on transport recovery.",
  ),
};
const projectInput = { project_id: id.describe("project_id from video_project_create/list/get.") };
const draftInput = {
  draft_id: id.describe("draft_id from video_project_get; identifies one language lane."),
};
const pageInput = {
  cursor: z
    .string()
    .max(16000)
    .optional()
    .describe(
      "Frozen snapshot cursor; keep filters/page size. First read capped at 100 rows/4 MiB; narrow filters if exceeded. Expires after one hour or server restart/eviction; restart without cursor.",
    ),
  limit: z.number().int().min(1).max(100).default(20),
};
const version = z.object({ project_id: id, language: Language, version_id: id }).strict();
const summary = z
  .object({
    project_id: id,
    workspace_id: id,
    title: z.string(),
    revision_id: id,
    updated_at: z.string(),
    review_url: z.string(),
  })
  .strict();
const project = summary.extend({
  brief: Brief,
  format: Format,
  drafts: z.array(
    z
      .object({
        draft_id: id,
        language: Language,
        script_revision: id,
        timeline_revision: id,
        current_version_id: id.nullable(),
      })
      .strict(),
  ),
});
const patchResult = z
  .object({
    revision_id: id,
    changed: z.boolean(),
    affected_scene_ids: z.array(z.string()),
    stale_dependents: z.array(StaleDependency),
  })
  .strict();
const checkpoint = z.object({ version, manifest_sha256: id, review_url: z.string() }).strict();
const operationReceipt = z
  .object({
    receipt_id: id,
    tool: z.literal("video_project_create"),
    workspace_id: id,
    idempotency_key: id,
  })
  .strict();
const operationLookupInput = {
  workspace_id: id,
  tool: z.literal("video_project_create"),
  idempotency_key: id,
  receipt_id: id.optional(),
};
const readAdvice = z.discriminatedUnion("tool", [
  z
    .object({
      tool: z.literal("video_comment_get"),
      arguments: z.object({ comment_id: id }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("video_profile_get"),
      arguments: z.object({ profile_id: id }).strict(),
    })
    .strict(),
  z
    .object({
      tool: z.literal("video_loop_get"),
      arguments: z.union([
        z.object({ loop_id: id }).strict(),
        z.object({ project_id: id, language: Language }).strict(),
      ]),
    })
    .strict(),
  z
    .object({ tool: z.literal("video_project_get"), arguments: z.object(projectInput).strict() })
    .strict(),
  z
    .object({
      tool: z.literal("video_operation_get"),
      arguments: z.object(operationLookupInput).strict(),
    })
    .strict(),
  z
    .object({ tool: z.literal("video_script_get"), arguments: z.object(draftInput).strict() })
    .strict(),
  z
    .object({ tool: z.literal("video_timeline_get"), arguments: z.object(draftInput).strict() })
    .strict(),
]);
const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    effect: z.enum(["none", "not_applied", "applied", "partial", "unknown"]),
    receipt: operationReceipt.optional(),
    recovery: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("fix_input"),
          fields: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
        })
        .strict(),
      z.object({ kind: z.literal("refresh_then_recompute"), read: readAdvice }).strict(),
      z.object({ kind: z.literal("request_human"), reason: z.string() }).strict(),
      z.object({ kind: z.literal("repeat_same_operation") }).strict(),
      z
        .object({
          kind: z.literal("inspect_operation"),
          read: z.object({
            tool: z.literal("video_operation_get"),
            arguments: z.object(operationLookupInput).strict(),
          }),
        })
        .strict(),
    ]),
  })
  .strict();
export const videoRecoverySchema = errorSchema.shape.recovery;
export type BrokerTool = {
  name: string;
  input: z.ZodType;
  output: z.ZodType;
  readOnly: boolean;
  invoke?: (input: Record<string, unknown>) => Promise<CallToolResult>;
};
export type DomainResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<{ contents: unknown[] }>;
};
export type VideoBackend = ((name: string, args: Record<string, unknown>) => Promise<unknown>) & {
  snapshotPrincipal?: string;
  resources?: DomainResource[];
  catalog?: {
    tools: BrokerTool[];
    checkScope: (
      name: string,
      input: Record<string, unknown>,
      workspaceId: string,
    ) => Promise<void>;
  };
};
export type Definition = {
  name: string;
  description: string;
  readOnly: boolean;
  input: z.ZodType;
  output: z.ZodType;
  run: (input: Record<string, unknown>, call: VideoBackend) => Promise<unknown>;
};
const obj = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const at = (value: unknown) => new Date(z.number().parse(value)).toISOString();
const reviewUrl = (path: unknown) =>
  new URL(z.string().parse(path), process.env.SPA_ORIGIN ?? "https://canvas.iota.uz").toString();
function projectSummary(raw: unknown) {
  const p = obj(raw);
  return {
    project_id: p.projectId,
    workspace_id: p.workspaceId,
    title: p.title,
    revision_id: p.revisionId,
    updated_at: at(p.updatedAt),
    review_url: reviewUrl(p.reviewUrl),
  };
}
function projectDetail(raw: unknown) {
  const p = obj(raw);
  return {
    ...projectSummary(p),
    brief: p.brief,
    format: p.format,
    drafts: z
      .array(z.record(z.string(), z.unknown()))
      .parse(p.drafts)
      .map((d) => ({
        draft_id: d.draftId,
        language: d.language,
        script_revision: d.scriptRevision,
        timeline_revision: d.timelineRevision,
        current_version_id: d.currentVersionId,
      })),
  };
}
function receiptForProjectCreate(input: Record<string, unknown>) {
  const workspaceId = id.parse(input.workspace_id);
  const idempotencyKey = id.parse(input.idempotency_key);
  return {
    receipt_id: createHash("sha256")
      .update(
        JSON.stringify(["video-operation-v1", "video_project_create", workspaceId, idempotencyKey]),
      )
      .digest("hex"),
    tool: "video_project_create" as const,
    workspace_id: workspaceId,
    idempotency_key: idempotencyKey,
  };
}
function versionDetail(raw: unknown) {
  const v = obj(raw);
  return {
    version: {
      project_id: obj(v.version).projectId,
      language: obj(v.version).language,
      version_id: obj(v.version).versionId,
    },
    manifest_sha256: v.manifestSha256,
    review_url: reviewUrl(v.reviewUrl),
  };
}
function page(schema: z.ZodType) {
  return z
    .object({ items: z.array(schema), next_cursor: z.string().nullable(), complete: z.boolean() })
    .strict();
}
const cursorEnvelope = z
  .object({ scope: z.string(), cursor: z.string(), expires: z.number() })
  .strict();
function cursorScope(input: Record<string, unknown>, name: string) {
  const { cursor: _cursor, ...filters } = input;
  return createHash("sha256")
    .update(JSON.stringify([name, filters]))
    .digest("hex");
}
export function continuation(input: Record<string, unknown>, name: string) {
  if (input.cursor === undefined) return null;
  let saved: z.infer<typeof cursorEnvelope>;
  try {
    saved = cursorEnvelope.parse(
      JSON.parse(Buffer.from(String(input.cursor), "base64url").toString("utf8")),
    );
  } catch {
    throw new VideoDomainError(
      "CURSOR_MISMATCH",
      "Invalid cursor. Start a new list query without a cursor.",
    );
  }
  if (saved.scope !== cursorScope(input, name))
    throw new VideoDomainError(
      "CURSOR_MISMATCH",
      "Cursor belongs to different filters or page size. Start a new list query.",
    );
  if (saved.expires < Date.now())
    throw new VideoDomainError(
      "CURSOR_EXPIRED",
      "Cursor expired. Restart the list query without a cursor.",
    );
  return saved.cursor;
}
export function pageResult(
  raw: unknown,
  map: (v: unknown) => unknown,
  input: Record<string, unknown>,
  name: string,
) {
  const p = obj(raw);
  return {
    items: z.array(z.unknown()).parse(p.page).map(map),
    next_cursor: p.isDone
      ? null
      : Buffer.from(
          JSON.stringify({
            scope: cursorScope(input, name),
            cursor: z.string().parse(p.continueCursor),
            expires: Date.now() + 3600000,
          }),
        ).toString("base64url"),
    complete: p.isDone,
  };
}

const snapshots = new Map<
  string,
  {
    principal: string;
    scope: string;
    expires: number;
    bytes: number;
    rows: unknown[];
    issuedOffsets: Set<number>;
  }
>();
/** One atomic bounded Convex query, then immutable process-local pages. No live fallback. */
export async function snapshotQuery(
  call: VideoBackend,
  operation: string,
  args: Record<string, unknown>,
  input: Record<string, unknown>,
  name: string,
) {
  const principal = call.snapshotPrincipal;
  if (!principal)
    throw new VideoDomainError(
      "SNAPSHOT_UNAVAILABLE",
      "Authenticated snapshot identity unavailable; restart through the MCP endpoint.",
    );
  const scope = cursorScope(input, name),
    cursor = continuation(input, name);
  const now = Date.now();
  for (const [key, value] of snapshots) if (value.expires < now) snapshots.delete(key);
  let key: string,
    offset = 0;
  if (cursor) {
    const parsed = /^([a-f0-9]{64}):(\d+)$/.exec(cursor);
    key = parsed?.[1] ?? "";
    offset = Number(parsed?.[2]);
    const saved = snapshots.get(key);
    if (
      !saved ||
      saved.principal !== principal ||
      saved.scope !== scope ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !saved.issuedOffsets.has(offset)
    )
      throw new VideoDomainError(
        "SNAPSHOT_EXPIRED",
        "Snapshot expired, was evicted, or belongs to another principal/filter. Restart without cursor.",
        "not_applied",
        {
          kind: "fix_input",
          fields: [
            {
              path: "/cursor",
              reason:
                "Remove cursor and restart the list; never combine pages from different snapshots.",
            },
          ],
        },
      );
  } else {
    const raw = obj(
      await call(
        operation,
        operation === "listVoices"
          ? { ...(input.query ? { query: input.query } : {}), limit: 100 }
          : {
              ...args,
              paginationOpts: { numItems: 100, cursor: null, maximumBytesRead: 4 * 1024 * 1024 },
            },
      ),
    );
    const result =
      operation === "listVoices" ? { page: raw.voices, isDone: raw.hasMore === false } : raw;
    const rows = z.array(z.unknown()).max(100).parse(result.page);
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    if (result.isDone !== true || bytes > 4 * 1024 * 1024)
      throw new VideoDomainError(
        "SNAPSHOT_TOO_LARGE",
        "Atomic snapshot exceeds 100 records or 4 MiB; narrow project/query/state/kind/target/language filters. No partial live snapshot returned.",
        "not_applied",
        {
          kind: "fix_input",
          fields: [
            {
              path: "/",
              reason:
                "Narrow the collection filters; reducing page size does not reduce snapshot size.",
            },
          ],
        },
      );
    while (
      snapshots.size >= 128 ||
      [...snapshots.values()].reduce((n, s) => n + s.bytes, bytes) > 32 * 1024 * 1024
    ) {
      const oldest = snapshots.keys().next().value;
      if (!oldest) break;
      snapshots.delete(oldest);
    }
    key = createHash("sha256").update(`${globalThis.crypto.randomUUID()}:${now}`).digest("hex");
    snapshots.set(key, {
      principal,
      scope,
      expires: now + 3600000,
      bytes,
      rows: structuredClone(rows),
      issuedOffsets: new Set<number>(),
    });
  }
  const saved = snapshots.get(key);
  if (!saved) throw new VideoDomainError("SNAPSHOT_EXPIRED", "Restart the list without cursor.");
  const end = offset + Number(input.limit);
  if (end < saved.rows.length) saved.issuedOffsets.add(end);
  return {
    page: saved.rows.slice(offset, end),
    isDone: end >= saved.rows.length,
    continueCursor: `${key}:${end}`,
  };
}

export const videoRegistry: Definition[] = [
  ...reviewDefinitions,
  ...resourceDefinitions,
  ...providerDefinitions,
  ...learningDefinitions,
  ...workflowDefinitions,
  {
    name: "video_project_create",
    readOnly: false,
    description:
      "Create a durable video project and independent RU/UZ drafts. Returns IDs and review URL. Does not generate media, render or approve anything.",
    input: z
      .object({
        workspace_id: id.describe(
          "Existing workspace ID or exact slug from Canvas workspace lookup.",
        ),
        ...write,
        title: z.string().trim().min(1).max(500),
        brief: Brief,
        format: Format,
        languages: z
          .array(Language)
          .min(1)
          .max(2)
          .refine((v) => new Set(v).size === v.length, "Languages must be unique"),
      })
      .strict(),
    output: project.extend({ operation_receipt: operationReceipt }),
    run: async (i, call) => {
      const operation_receipt = receiptForProjectCreate(i);
      return {
        ...projectDetail(
          await call("createProject", {
            workspaceId: i.workspace_id,
            idempotencyKey: i.idempotency_key,
            title: i.title,
            brief: i.brief,
            format: i.format,
            languages: i.languages,
          }),
        ),
        operation_receipt,
      };
    },
  },
  {
    name: "video_operation_get",
    readOnly: true,
    description:
      "Reconcile one project-create attempt by its original workspace/idempotency key or returned receipt. Applied returns the original project without repeating it; unknown means no durable result was visible at lookup time and only the exact original same-key create may be replayed.",
    input: z.object(operationLookupInput).strict(),
    output: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("applied"),
          effect: z.literal("applied"),
          receipt: operationReceipt,
          result: project,
        })
        .strict(),
      z
        .object({
          state: z.literal("unknown"),
          effect: z.literal("unknown"),
          receipt: operationReceipt,
          recovery: z.object({ kind: z.literal("repeat_same_operation") }).strict(),
        })
        .strict(),
    ]),
    run: async (i, call) => {
      const receipt = receiptForProjectCreate(i);
      if (i.receipt_id !== undefined && i.receipt_id !== receipt.receipt_id)
        throw new VideoDomainError(
          "RECEIPT_MISMATCH",
          "Receipt does not match the original workspace, tool and idempotency key.",
          "none",
          {
            kind: "fix_input",
            fields: [
              {
                path: "/receipt_id",
                reason: "Use the unchanged receipt or omit it and query by the original key.",
              },
            ],
          },
        );
      const raw = obj(
        await call("getOperation", {
          workspaceId: i.workspace_id,
          tool: "createProject",
          idempotencyKey: i.idempotency_key,
        }),
      );
      if (raw.state !== "applied")
        return {
          state: "unknown",
          effect: "unknown",
          receipt,
          recovery: { kind: "repeat_same_operation" },
        };
      return {
        state: "applied",
        effect: "applied",
        receipt,
        result: projectDetail(raw.result),
      };
    },
  },
  {
    name: "video_project_get",
    readOnly: true,
    description:
      "Read a project, brief and language draft IDs/revisions. Use these exact IDs for document reads and checkpoint guards.",
    input: z.object(projectInput).strict(),
    output: project,
    run: async (i, call) => projectDetail(await call("getProject", { projectId: i.project_id })),
  },
  {
    name: "video_project_list",
    readOnly: true,
    description:
      "List a frozen project snapshot by exact workspace ID or slug, maximum 100 records/4 MiB before title filtering. Oversized workspaces require direct known-ID reads; no partial live fallback. Cursor expires after one hour or restart/eviction. Names discover; IDs write.",
    input: z
      .object({ workspace_id: id, query: z.string().max(500).optional(), ...pageInput })
      .strict(),
    output: page(summary),
    run: async (i, call) =>
      pageResult(
        await snapshotQuery(
          call,
          "listProjects",
          {
            workspaceId: i.workspace_id,
            ...(i.query === undefined ? {} : { query: i.query }),
            paginationOpts: { numItems: i.limit, cursor: continuation(i, "projects") },
          },
          i,
          "projects",
        ),
        projectSummary,
        i,
        "projects",
      ),
  },
  ...(["script", "timeline"] as const).flatMap((kind): Definition[] => [
    {
      name: `video_${kind}_get`,
      readOnly: true,
      description: `Read the complete ${kind} document for one language draft, with its revision. Patch paths use this canonical keyed document; replace order arrays as a whole.`,
      input: z.object(draftInput).strict(),
      output: z
        .object({
          draft_id: id,
          project_id: id,
          language: Language,
          revision_id: id,
          complete: z.literal(true),
          document: kind === "script" ? Script : Timeline,
        })
        .strict(),
      run: async (i, call) => {
        const d = obj(await call("getDraft", { draftId: i.draft_id }));
        return {
          draft_id: d.draftId,
          project_id: d.projectId,
          language: d.language,
          revision_id: d[kind === "script" ? "scriptRevision" : "timelineRevision"],
          complete: true,
          document: d[kind],
        };
      },
    },
    {
      name: `video_${kind}_patch`,
      readOnly: false,
      description: `Atomically patch the ${kind} of one language draft. Read current revision first; on conflict reread and recompute, never just replace the guard. Does not start media jobs or approve a render.`,
      input: z
        .object({
          ...draftInput,
          ...write,
          expected_revision: id.describe(`revision_id from video_${kind}_get.`),
          operations: Patch,
        })
        .strict(),
      output: patchResult,
      run: async (i, call) => {
        const r = obj(
          await call(kind === "script" ? "patchScript" : "patchTimeline", {
            draftId: i.draft_id,
            idempotencyKey: i.idempotency_key,
            expectedRevision: i.expected_revision,
            operations: i.operations,
          }),
        );
        return {
          revision_id: r.revisionId,
          changed: r.changed,
          affected_scene_ids: r.affectedSceneIds,
          stale_dependents: r.staleDependents,
        };
      },
    },
  ]),
  {
    name: "video_checkpoint",
    readOnly: false,
    description:
      "Snapshot exact project/script/timeline revisions into an immutable version. Not a render, publication or human approval. Get guards from project_get and both document reads.",
    input: z
      .object({
        ...draftInput,
        ...write,
        expected_project_revision: id,
        expected_script_revision: id,
        expected_timeline_revision: id,
        label: z.string().trim().min(1).max(500),
        note: z.string().max(16000).optional(),
      })
      .strict(),
    output: checkpoint,
    run: async (i, call) =>
      versionDetail(
        await call("checkpoint", {
          draftId: i.draft_id,
          idempotencyKey: i.idempotency_key,
          expectedProjectRevision: i.expected_project_revision,
          expectedScriptRevision: i.expected_script_revision,
          expectedTimelineRevision: i.expected_timeline_revision,
          label: i.label,
          ...(i.note === undefined ? {} : { note: i.note }),
        }),
      ),
  },
  {
    name: "video_version_list",
    readOnly: true,
    description:
      "List a frozen checkpoint collection, optionally narrowed by language. Snapshot cap 100 records/4 MiB; oversized collections fail explicitly. These are build inputs, not rendered or human-approved video. Follow next_cursor; restart on expiry/eviction.",
    input: z.object({ ...projectInput, language: Language.optional(), ...pageInput }).strict(),
    output: page(checkpoint.extend({ label: z.string(), created_at: z.string() })),
    run: async (i, call) =>
      pageResult(
        await snapshotQuery(
          call,
          "listVersions",
          {
            projectId: i.project_id,
            ...(i.language === undefined ? {} : { language: i.language }),
            paginationOpts: { numItems: i.limit, cursor: continuation(i, "versions") },
          },
          i,
          "versions",
        ),
        (raw) => {
          const v = obj(raw);
          return { ...versionDetail(v), label: v.label, created_at: at(v.createdAt) };
        },
        i,
        "versions",
      ),
  },
  {
    name: "video_version_get",
    readOnly: true,
    description:
      "Read immutable checkpoint script/timeline and pinned input revisions. Get version_id from video_checkpoint/version_list. This does not imply a render or approval exists.",
    input: z.object({ version_id: id }).strict(),
    output: z
      .object({
        version,
        script: Script,
        timeline: Timeline,
        project_revision: id,
        script_revision: id,
        timeline_revision: id,
        label: z.string(),
        manifest_sha256: id,
      })
      .strict(),
    run: async (i, call) => {
      const v = obj(await call("getVersion", { versionId: i.version_id }));
      const ref = obj(v.version);
      return {
        version: { project_id: ref.projectId, language: ref.language, version_id: ref.versionId },
        script: v.script,
        timeline: v.timeline,
        project_revision: v.projectRevision,
        script_revision: v.scriptRevision,
        timeline_revision: v.timelineRevision,
        label: v.label,
        manifest_sha256: v.manifestSha256,
      };
    },
  },
];

export class VideoDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly effect: "none" | "not_applied" | "applied" | "partial" | "unknown" = "not_applied",
    readonly recovery?: z.infer<typeof videoRecoverySchema>,
  ) {
    super(message);
  }
}
function errorResult(error: z.infer<typeof errorSchema>) {
  return { ok: false as const, error: errorSchema.parse(error) };
}
function wire(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: payload.ok === false,
  };
}
export function inputFailure(error: z.ZodError) {
  return wire(
    errorResult({
      code: "VALIDATION_ERROR",
      message: "Invalid arguments; no operation was submitted.",
      effect: "not_applied",
      recovery: {
        kind: "fix_input",
        fields: error.issues.map((issue) => ({
          path: `/${issue.path.map((p) => String(p).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`,
          reason: issue.message,
        })),
      },
    }),
  );
}
/** One execution boundary for direct calls and a future tools.* broker. */
export async function callVideoTool(name: string, input: unknown, call: VideoBackend) {
  const definition = videoRegistry.find((d) => d.name === name);
  if (!definition) throw new Error("Unknown video tool");
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) return inputFailure(parsed.error);
  try {
    const data = definition.output.parse(await definition.run(obj(parsed.data), call));
    return wire({ ok: true, data });
  } catch (error) {
    const inputData = obj(parsed.data);
    const known = error instanceof VideoDomainError;
    const code = known ? error.code : "BACKEND_UNAVAILABLE";
    const effect = known ? error.effect : definition.readOnly ? "none" : "unknown";
    const receipt =
      name === "video_project_create" ? receiptForProjectCreate(inputData) : undefined;
    let recovery: z.infer<typeof errorSchema>["recovery"] = receipt
      ? {
          kind: "inspect_operation",
          read: {
            tool: "video_operation_get",
            arguments: {
              workspace_id: receipt.workspace_id,
              tool: receipt.tool,
              idempotency_key: receipt.idempotency_key,
              receipt_id: receipt.receipt_id,
            },
          },
        }
      : {
          kind: "request_human",
          reason:
            effect === "unknown"
              ? "The write outcome is unknown. Do not submit a new key; reconcile the existing operation."
              : "Check the selected object and server availability; no alternative workspace was selected.",
        };
    if (code === "REVISION_CONFLICT" && name.startsWith("video_comment_"))
      recovery = {
        kind: "refresh_then_recompute",
        read: {
          tool: "video_comment_get",
          arguments: { comment_id: id.parse(inputData.comment_id) },
        },
      };
    else if (code === "REVISION_CONFLICT" && name === "video_profile_patch")
      recovery = {
        kind: "refresh_then_recompute",
        read: {
          tool: "video_profile_get",
          arguments: { profile_id: id.parse(inputData.profile_id) },
        },
      };
    else if (code === "REVISION_CONFLICT" && name.startsWith("video_loop_"))
      recovery = {
        kind: "refresh_then_recompute",
        read: {
          tool: "video_loop_get",
          arguments: inputData.loop_id
            ? { loop_id: id.parse(inputData.loop_id) }
            : {
                project_id: id.parse(inputData.project_id),
                language: Language.parse(inputData.language),
              },
        },
      };
    else if (code === "REVISION_CONFLICT" && name.includes("_patch"))
      recovery = {
        kind: "refresh_then_recompute",
        read: {
          tool: name === "video_script_patch" ? "video_script_get" : "video_timeline_get",
          arguments: { draft_id: id.parse(inputData.draft_id) },
        },
      };
    if (code === "CURSOR_MISMATCH" || code === "CURSOR_EXPIRED")
      recovery = {
        kind: "fix_input",
        fields: [
          {
            path: "/cursor",
            reason: "Remove cursor and restart the query with the intended filters.",
          },
        ],
      };
    return wire(
      errorResult({
        code,
        message: known
          ? error.message
          : "Video operation could not be confirmed. No automatic retry was performed.",
        effect,
        ...(receipt ? { receipt } : {}),
        recovery: known && error.recovery ? error.recovery : recovery,
      }),
    );
  }
}
// Legacy Canvas asset_upload_url remains compatible; verified uploads use reserve.
export const sharedMediaTools = new Set([
  "resource_get",
  "resource_find",
  "image_generate",
  "image_edit",
  "voice_list",
  "asset_upload_reserve",
  "asset_upload_status",
  "asset_upload_finalize",
  "job_get",
  "job_list",
  "job_effect_get",
  "job_cancel",
  "job_reconcile",
]);
export function registerVideoTools(
  server: McpServer,
  call: VideoBackend,
  names?: ReadonlySet<string>,
) {
  for (const d of videoRegistry.filter((definition) => !names || names.has(definition.name))) {
    // Keep the exact public schema but defer validation into the common handler.
    // SDK 2.0 otherwise turns validation failures into text-only errors before
    // our handler; this preserves error/outputSchema parity at the real boundary.
    const inputSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "visual-video",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => z.toJSONSchema(d.input, { io: "input" }),
          output: () => z.toJSONSchema(d.input, { io: "output" }),
        },
      },
    };
    server.registerTool(
      d.name,
      {
        description: d.description,
        inputSchema,
        outputSchema: z.union([
          z.object({ ok: z.literal(true), data: d.output }).strict(),
          z.object({ ok: z.literal(false), error: errorSchema }).strict(),
        ]),
        annotations: {
          readOnlyHint: d.readOnly,
          destructiveHint: false,
          idempotentHint: d.name !== "execute",
          openWorldHint: false,
        },
      },
      async (input) => callVideoTool(d.name, input, call),
    );
  }
}
