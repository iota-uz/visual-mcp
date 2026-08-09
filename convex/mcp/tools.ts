/**
 * Real MCP tool handlers (PLAN.md section 6), replacing the A1.0 spike's
 * single `echo` tool. Registered per-request against a fresh `McpServer`
 * instance (see ../http.ts's factory) with the caller's verified
 * `McpPrincipal` closed over — every write is attributed via `createdBy`.
 *
 * Two zod majors are in play here on purpose (see ../http.ts's header
 * comment): tool `inputSchema`s use zod v4 (this file's `z` import, which
 * resolves to root's zod@4 — what `@modelcontextprotocol/server` itself
 * requires), while `CanvasDocSchema` is imported from `@visual-canvas/canvas`
 * and validates with its own bundled zod v3. Never mix the two schema
 * objects — each only knows how to `.parse()` values built for its own
 * major version's runtime.
 *
 * render_file and run_code delegate to the render worker (apps/worker, now
 * deployed on Railway) via getWorkerConfig/callWorker (../lib/worker.ts) —
 * the worker holds no Convex credential, only the short-lived signed
 * source/upload URLs each call passes it (PLAN.md section 3). A render
 * always creates a new canvasVersions row, even for non-"canvas" kinds
 * (PLAN.md section 1: "Claude re-rendering creates a new version, never
 * destroys the old one") — see canvases.ts's recordRender/recordExecArtifacts.
 *
 * list_templates is registered but, unlike PLAN.md section 6's "only
 * auth-free tool" note, still sits behind this endpoint's bearer gate for
 * now — exempting one tool from that gate would require inspecting the
 * JSON-RPC body before authenticating, which is a real change to the
 * request-handling flow, not a small one.
 */

import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { CanvasDocSchema } from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath, SandboxPathError } from "@visual-canvas/runtime/paths/index.js";
import { listTemplates as templateRegistryList } from "@visual-canvas/runtime/templates/index.js";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { inferArtifactInfo, isTextMime } from "../lib/artifactInfo";
import { bytesToBase64 } from "../lib/bytes";
import { sha256Hex } from "../lib/hash";
import { callWorker, extractStorageId, getWorkerConfig } from "../lib/worker";

export interface McpPrincipal {
  userId: Id<"users">;
  tokenId: Id<"mcpTokens">;
  email: string;
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && Array.isArray((err as { issues?: unknown }).issues)) {
    const issues = (err as { issues: { message: string }[] }).issues;
    return issues.map((i) => i.message).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return { content: [{ type: "text", text: describeError(err) }], isError: true };
  }
}

/** Signed download URLs for every file a canvas has (render_file/run_code's `sources`). */
async function resolveCanvasSources(
  ctx: ActionCtx,
  canvasId: Id<"canvases">,
): Promise<Array<{ relPath: string; getUrl: string }>> {
  const files = await ctx.runQuery(internal.canvases.listFilesForCanvas, { canvasId });
  const resolved = await Promise.all(
    files.map(async (f) => {
      const getUrl = await ctx.storage.getUrl(f.storageId);
      return getUrl ? { relPath: f.relPath, getUrl } : null;
    }),
  );
  return resolved.filter((s): s is { relPath: string; getUrl: string } => s !== null);
}

export function registerTools(server: McpServer, ctx: ActionCtx, principal: McpPrincipal): void {
  server.registerTool(
    "create_workspace",
    {
      description: 'Creates a workspace (a folder for canvases), e.g. "OSAGO" or "Billing".',
      inputSchema: z.object({
        name: z.string().min(1),
        slug: z.string().min(1).optional(),
        description: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const result = await ctx.runMutation(internal.workspaces.create, {
          name: input.name,
          slug: input.slug,
          description: input.description,
          createdBy: principal.userId,
        });
        return jsonResult({ workspace_id: result.workspaceId, slug: result.slug });
      }),
  );

  server.registerTool(
    "list_workspaces",
    {
      description: "Lists all workspaces.",
      inputSchema: z.object({}),
    },
    async () =>
      runTool(async () => {
        const workspaces = await ctx.runQuery(internal.workspaces.list, {});
        return jsonResult({ workspaces });
      }),
  );

  server.registerTool(
    "create_canvas",
    {
      description:
        'Creates a canvas inside a workspace. kind="canvas" is authored via put_canvas_doc; ' +
        'kind="html"/"image"/"pdf" are authored via write_file (render_file is not available yet).',
      inputSchema: z.object({
        workspace_id: z.string(),
        title: z.string().min(1),
        kind: z.enum(["canvas", "html", "image", "pdf"]),
        slug: z.string().min(1).optional(),
        theme: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const result = await ctx.runMutation(internal.canvases.create, {
          workspaceId: input.workspace_id as Id<"workspaces">,
          title: input.title,
          kind: input.kind,
          slug: input.slug,
          theme: input.theme,
          createdBy: principal.userId,
        });
        return jsonResult({ canvas_id: result.canvasId, slug: result.slug });
      }),
  );

  server.registerTool(
    "list_canvases",
    {
      description: "Lists canvases in a workspace, most recently updated first.",
      inputSchema: z.object({ workspace_id: z.string() }),
    },
    async (input) =>
      runTool(async () => {
        const canvases = await ctx.runQuery(internal.canvases.list, {
          workspaceId: input.workspace_id as Id<"workspaces">,
        });
        return jsonResult({ canvases });
      }),
  );

  server.registerTool(
    "get_canvas",
    {
      description:
        'Gets a canvas\'s metadata. For kind="canvas" canvases with a current version, also ' +
        "returns the CanvasDoc JSON.",
      inputSchema: z.object({ canvas_id: z.string() }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const canvas = await ctx.runQuery(internal.canvases.get, { canvasId });
        if (!canvas) throw new Error(`Unknown canvas: ${input.canvas_id}`);
        if (!canvas.doc_storage_id) {
          return jsonResult({ canvas });
        }
        const blob = await ctx.storage.get(canvas.doc_storage_id);
        const doc = blob ? JSON.parse(await blob.text()) : null;
        return jsonResult({ canvas, doc });
      }),
  );

  server.registerTool(
    "put_canvas_doc",
    {
      description:
        "Validates a CanvasDoc (PLAN.md section 2) and stores it as a new version of a canvas. " +
        "Node HTML content must be static (no <script>, on*=, javascript:, <iframe>, <object>) " +
        "and is rejected loudly, not silently stripped.",
      inputSchema: z.object({
        canvas_id: z.string(),
        doc: z.unknown(),
        note: z.string().optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const doc = CanvasDocSchema.parse(input.doc);

        const nodes = doc.nodes.map((node) => ({
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
            .filter((s): s is string => typeof s === "string" && s.length > 0)
            .join(" "),
        }));

        const docStorageId = await ctx.storage.store(
          new Blob([JSON.stringify(doc)], { type: "application/json" }),
        );
        const result = await ctx.runMutation(internal.canvases.putDoc, {
          canvasId,
          docStorageId,
          note: input.note,
          createdBy: principal.userId,
          nodes,
        });
        return jsonResult({ canvas_id: canvasId, version: result.version });
      }),
  );

  server.registerTool(
    "publish_canvas",
    {
      description: 'Sets a canvas\'s visibility. "public" mints a share slug on first publish.',
      inputSchema: z.object({
        canvas_id: z.string(),
        visibility: z.enum(["private", "public"]),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const newPublicSlug =
          input.visibility === "public" ? crypto.randomUUID().replace(/-/g, "") : undefined;
        const result = await ctx.runMutation(internal.canvases.publish, {
          canvasId,
          visibility: input.visibility,
          newPublicSlug,
        });
        return jsonResult({
          canvas_id: canvasId,
          visibility: result.visibility,
          public_slug: result.publicSlug,
        });
      }),
  );

  server.registerTool(
    "write_file",
    {
      description: "Writes UTF-8 text (HTML, D2, etc.) to a path under a canvas's /src or /output.",
      inputSchema: z.object({
        canvas_id: z.string(),
        path: z.string(),
        content: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        let normalized: ReturnType<typeof normalizeCanvasPath>;
        try {
          normalized = normalizeCanvasPath(input.path, "write", "path");
        } catch (err) {
          throw new Error(err instanceof SandboxPathError ? err.message : String(err));
        }
        const { mime } = inferArtifactInfo(normalized.relPath);
        const bytes = new TextEncoder().encode(input.content);
        const storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
        await ctx.runMutation(internal.canvases.upsertFile, {
          canvasId,
          relPath: normalized.displayPath,
          storageId,
          size: bytes.byteLength,
          contentHash: await sha256Hex(input.content),
        });
        return jsonResult({ path: normalized.displayPath, bytes_written: bytes.byteLength });
      }),
  );

  server.registerTool(
    "run_code",
    {
      description:
        "Executes JS/TS code in a sandboxed Node.js worker against a canvas's /src, /output, " +
        "/cache, /assets files. Files the code writes under /output are collected as new artifacts.",
      inputSchema: z.object({
        canvas_id: z.string(),
        code: z.string(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const config = getWorkerConfig();
        const sources = await resolveCanvasSources(ctx, canvasId);

        // run_code can produce an unpredictable number of /output files;
        // this pool size is an interim cap (apps/worker/src/schemas.ts's
        // own documented simplification) — outputs beyond it come back
        // reported with uploaded:false, never silently dropped.
        const UPLOAD_POOL_SIZE = 10;
        const uploads = await Promise.all(
          Array.from({ length: UPLOAD_POOL_SIZE }, () => ctx.storage.generateUploadUrl()),
        );

        const result = await callWorker<{
          success: boolean;
          stdout: string;
          stderr: string;
          error?: string;
          artifacts: Array<{
            relPath: string;
            size: number;
            uploaded: boolean;
            uploadStatus?: number;
            uploadBody?: unknown;
          }>;
        }>(config, "/exec", {
          sources,
          code: input.code,
          uploads: uploads.map((putUrl) => ({ putUrl })),
        });

        const uploaded = result.artifacts.filter((a) => a.uploaded);
        if (uploaded.length > 0) {
          await ctx.runMutation(internal.canvases.recordExecArtifacts, {
            canvasId,
            createdBy: principal.userId,
            artifacts: uploaded.map((a) => {
              const info = inferArtifactInfo(a.relPath);
              return {
                relPath: a.relPath,
                type: info.type,
                mimeType: info.mime,
                size: a.size,
                storageId: extractStorageId(a.uploadBody) as Id<"_storage">,
              };
            }),
          });
        }

        return jsonResult({
          success: result.success,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
          artifacts: result.artifacts.map((a) => ({
            path: a.relPath,
            size: a.size,
            uploaded: a.uploaded,
          })),
        });
      }),
  );

  server.registerTool(
    "render_file",
    {
      description:
        "Renders a canvas source file (HTML or D2) to PNG/SVG/PDF/HTML under /output or /cache. " +
        ".d2 entrypoints with format 'svg' render via the D2 compiler; everything else renders " +
        "via headless Chromium.",
      inputSchema: z.object({
        canvas_id: z.string(),
        entrypoint: z.string(),
        output_path: z.string(),
        format: z.enum(["png", "svg", "pdf", "html"]),
        viewport: z
          .object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            deviceScaleFactor: z.number().positive().optional(),
          })
          .optional(),
        pdf: z
          .object({
            format: z.enum(["A4", "A3", "Letter"]).optional(),
            orientation: z.enum(["portrait", "landscape"]).optional(),
            printBackground: z.boolean().optional(),
            displayHeaderFooter: z.boolean().optional(),
            headerTemplate: z.string().optional(),
            footerTemplate: z.string().optional(),
            margin: z
              .object({
                top: z.string().optional(),
                right: z.string().optional(),
                bottom: z.string().optional(),
                left: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const config = getWorkerConfig();
        const sources = await resolveCanvasSources(ctx, canvasId);
        const putUrl = await ctx.storage.generateUploadUrl();
        const started = Date.now();

        try {
          const result = await callWorker<{
            relPath: string;
            size: number;
            mimeType: string;
            uploadStatus: number;
            uploadBody: unknown;
          }>(config, "/render", {
            sources,
            entrypoint: input.entrypoint,
            outputPath: input.output_path,
            format: input.format,
            viewport: input.viewport,
            pdf: input.pdf,
            upload: { putUrl },
          });

          const { type } = inferArtifactInfo(result.relPath);
          let storageId: Id<"_storage">;
          try {
            storageId = extractStorageId(result.uploadBody) as Id<"_storage">;
          } catch (extractErr) {
            throw new Error(
              `${(extractErr as Error).message}; uploadStatus=${result.uploadStatus} uploadBody=${JSON.stringify(result.uploadBody)}`,
            );
          }
          const recorded = await ctx.runMutation(internal.canvases.recordRender, {
            canvasId,
            createdBy: principal.userId,
            relPath: result.relPath,
            type,
            mimeType: result.mimeType,
            size: result.size,
            storageId,
          });
          await ctx.runMutation(internal.canvases.logRender, {
            canvasId,
            entrypoint: input.entrypoint,
            format: input.format,
            status: "success",
            durationMs: Date.now() - started,
            createdBy: principal.userId,
          });
          return jsonResult({
            artifact: { path: recorded.artifact.relPath, type, role: recorded.artifact.role },
          });
        } catch (err) {
          await ctx.runMutation(internal.canvases.logRender, {
            canvasId,
            entrypoint: input.entrypoint,
            format: input.format,
            status: "error",
            durationMs: Date.now() - started,
            errorText: describeError(err),
            createdBy: principal.userId,
          });
          throw err;
        }
      }),
  );

  server.registerTool(
    "list_artifacts",
    {
      description: "Lists a canvas's rendered output artifacts.",
      inputSchema: z.object({ canvas_id: z.string() }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const artifacts = await ctx.runQuery(internal.canvases.listArtifactsForCanvas, {
          canvasId,
        });
        const primary = artifacts.find((a) => a.role === "primary")?.path ?? null;
        return jsonResult({ canvas_id: canvasId, primary, artifacts });
      }),
  );

  server.registerTool(
    "export_artifact",
    {
      description:
        "Returns a canvas artifact's metadata and a download URL. Bytes are inlined only below " +
        "~1MB; larger artifacts must be fetched from `url`.",
      inputSchema: z.object({ canvas_id: z.string(), path: z.string() }),
    },
    async (input) =>
      runTool(async () => {
        const canvasId = input.canvas_id as Id<"canvases">;
        const artifact = await ctx.runQuery(internal.canvases.getArtifact, {
          canvasId,
          relPath: input.path,
        });
        if (!artifact) throw new Error(`Unknown artifact: ${input.path}`);

        const url = await ctx.storage.getUrl(artifact.storageId);
        const summary = {
          artifact: { path: artifact.path, type: artifact.type, role: artifact.role },
          url,
          mime_type: artifact.mimeType,
          size_bytes: artifact.size,
        };

        const INLINE_LIMIT_BYTES = 1_000_000;
        if (artifact.size > INLINE_LIMIT_BYTES) {
          return jsonResult(summary);
        }

        const blob = await ctx.storage.get(artifact.storageId);
        if (!blob) {
          return jsonResult(summary);
        }
        const resourceBlock: CallToolResult["content"][number] = isTextMime(artifact.mimeType)
          ? {
              type: "resource",
              resource: {
                uri: `canvas://${canvasId}${artifact.path}`,
                mimeType: artifact.mimeType,
                text: await blob.text(),
              },
            }
          : {
              type: "resource",
              resource: {
                uri: `canvas://${canvasId}${artifact.path}`,
                mimeType: artifact.mimeType,
                blob: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
              },
            };
        const result: CallToolResult = {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }, resourceBlock],
        };
        return result;
      }),
  );

  server.registerTool(
    "list_templates",
    {
      description: "Lists built-in visual templates, optionally filtered by kind.",
      inputSchema: z.object({
        kind: z.enum(["mockup", "diagram", "report", "infographic", "chart"]).optional(),
      }),
    },
    async (input) =>
      runTool(async () => jsonResult({ templates: templateRegistryList(input.kind) })),
  );
}
