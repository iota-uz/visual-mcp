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
 * Scope cut for this pass (see PLAN.md section 9 milestone A1): render_file
 * and run_code are NOT wired here — both need the render worker deployed
 * somewhere reachable (Railway), which hasn't happened yet. Wiring them
 * against an unreachable worker would be untestable dead code, so they're
 * left out entirely rather than stubbed. list_templates is registered but,
 * unlike PLAN.md section 6's "only auth-free tool" note, still sits behind
 * this endpoint's bearer gate for now — exempting one tool from that gate
 * would require inspecting the JSON-RPC body before authenticating, which
 * is a real change to the request-handling flow, not a small one.
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
