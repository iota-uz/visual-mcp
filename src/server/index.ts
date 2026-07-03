#!/usr/bin/env node
/**
 * MCP server entrypoint & tool handlers (PLAN.md section 6, 13).
 *
 * Registers the 7 coarse-grained MCP tools from PLAN.md section 6 against
 * `@modelcontextprotocol/sdk`'s `McpServer` (the high-level tool-registration
 * API — see `registerTool` below), each backed by a handler in
 * tool-handlers.ts and validated against the zod schemas from ../types.ts
 * (the single shared source of truth for tool I/O shapes — see that file's
 * header comment).
 *
 * Tool registration mechanism: `McpServer#registerTool(name, config, cb)`.
 * `config.inputSchema` is passed as the zod object schema's raw shape
 * (`XInputSchema.shape`, a `Record<string, ZodTypeAny>`) — the SDK's
 * `ZodRawShapeCompat` form — so the SDK derives both runtime validation and
 * the JSON Schema advertised to MCP clients directly from the same zod
 * schemas ../types.ts defines, with no duplicated/hand-maintained schema.
 *
 * Session-map approach: a single process-lifetime `SessionStore` (see
 * session-store.ts) wraps an in-memory `Map<string, Session>`. The sandbox
 * module deliberately does not own this mapping (see its header comment) —
 * this is the "whoever wires create_visual_session end-to-end" spot it
 * defers to. All 6 session-scoped tools look the session up via
 * `sessions.get(session_id)`, which throws `UnknownSessionError` for an
 * unrecognized id; `list_templates` is the only tool that does not need a
 * session.
 *
 * Error handling convention: every tool callback is wrapped in
 * `runTool`, which calls the corresponding tool-handlers.ts function and
 * converts any thrown error into a `CallToolResult` with `isError: true`
 * (see errors.ts) rather than letting it propagate — a thrown error would
 * otherwise either crash the process or (depending on the SDK's own
 * try/catch) produce a much less specific error back to the client. Known
 * error types (UnknownSessionError, SandboxPathError, PathTraversalError,
 * ArtifactNotFoundError, D2RenderError) get a recognizable `[label]` prefix;
 * anything else (e.g. the Playwright renderer's plain `Error` for
 * unsupported format/entrypoint combinations) falls back to its message.
 *
 * Successful results are returned as a single `content: [{ type: "text",
 * text: JSON.stringify(output, null, 2) }]` block for the 6 "structured
 * data" tools (create_visual_session, run_code, write_file, render_file,
 * list_artifacts, list_templates) — no `outputSchema` is registered, so per
 * the SDK's own contract (see ToolCallback's doc comment) `content` is the
 * right field to populate, and JSON text is both human- and LLM-readable
 * without requiring MCP clients to understand a bespoke structured-content
 * shape. `export_artifact` is the one exception: it additionally returns an
 * embedded resource content block (base64 `blob` for binary artifact types,
 * inline `text` for text-ish ones) carrying the actual artifact bytes, per
 * this tool's job of handing the rendered file back to the client.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  CreateVisualSessionInputSchema,
  ExportArtifactInputSchema,
  ListArtifactsInputSchema,
  ListTemplatesInputSchema,
  RenderFileInputSchema,
  RunCodeInputSchema,
  WriteFileInputSchema,
} from "../types.js";

import { disposeD2Renderer } from "../render/diagrams/index.js";
import { SessionStore } from "./session-store.js";
import { toToolErrorResult } from "./errors.js";
import * as handlers from "./tool-handlers.js";

/** Text-ish MIME types get an inline `text` resource field; everything else gets base64 `blob`. */
function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "image/svg+xml" || mimeType === "application/json";
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Runs a tool handler, converting any thrown error into an `isError` tool result instead of throwing. */
async function runTool(fn: () => Promise<CallToolResult> | CallToolResult): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return toToolErrorResult(err);
  }
}

export function createServer(): { server: McpServer; sessions: SessionStore } {
  const sessions = new SessionStore();
  const ctx = { sessions };

  const server = new McpServer({
    name: "visual-runtime",
    version: "0.1.0",
  });

  server.registerTool(
    "create_visual_session",
    {
      title: "Create visual session",
      description:
        "Creates a new isolated Node.js sandbox session workspace (/src, /output, /assets, " +
        "/templates, /cache) for generating visual artifacts. Optionally seeds /src from a " +
        "template of the given kind.",
      inputSchema: CreateVisualSessionInputSchema.shape,
    },
    async (input) => runTool(async () => jsonResult(await handlers.createVisualSession(input, ctx))),
  );

  server.registerTool(
    "run_code",
    {
      title: "Run code",
      description: "Executes JS/TS code inside a session's sandboxed Node.js worker.",
      inputSchema: RunCodeInputSchema.shape,
    },
    async (input) => runTool(async () => jsonResult(await handlers.runCode(input, ctx))),
  );

  server.registerTool(
    "write_file",
    {
      title: "Write file",
      description:
        "Writes raw HTML, D2, or other source text to a path under a session's /src or /output.",
      inputSchema: WriteFileInputSchema.shape,
    },
    async (input) => runTool(() => jsonResult(handlers.writeFile(input, ctx))),
  );

  server.registerTool(
    "render_file",
    {
      title: "Render file",
      description:
        "Renders a session source file (HTML or D2) to PNG/SVG/PDF/HTML under /output or /cache. " +
        ".d2 entrypoints with format 'svg' render via the D2 compiler; everything else renders " +
        "via headless Chromium (Playwright).",
      inputSchema: RenderFileInputSchema.shape,
    },
    async (input) => runTool(async () => jsonResult(await handlers.renderFile(input, ctx))),
  );

  server.registerTool(
    "list_artifacts",
    {
      title: "List artifacts",
      description: "Lists a session's registered output artifacts and its primary artifact.",
      inputSchema: ListArtifactsInputSchema.shape,
    },
    async (input) => runTool(async () => jsonResult(await handlers.listArtifacts(input, ctx))),
  );

  server.registerTool(
    "export_artifact",
    {
      title: "Export artifact",
      description: "Returns a session /output artifact's bytes and metadata to the MCP client.",
      inputSchema: ExportArtifactInputSchema.shape,
    },
    async (input) =>
      runTool(async () => {
        const result = await handlers.exportArtifact(input, ctx);
        const uri = `session://${input.session_id}${result.artifact.path}`;
        const resourceBlock = isTextMime(result.mime_type)
          ? {
              type: "resource" as const,
              resource: { uri, mimeType: result.mime_type, text: result.data.toString("utf8") },
            }
          : {
              type: "resource" as const,
              resource: { uri, mimeType: result.mime_type, blob: result.data.toString("base64") },
            };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  artifact: result.artifact,
                  absolute_path: result.absolute_path,
                  mime_type: result.mime_type,
                },
                null,
                2,
              ),
            },
            resourceBlock,
          ],
        };
      }),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description: "Lists built-in visual templates, optionally filtered by kind.",
      inputSchema: ListTemplatesInputSchema.shape,
    },
    async (input) => runTool(() => jsonResult(handlers.listTemplates(input))),
  );

  return { server, sessions };
}

async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      await disposeD2Renderer();
    }
    process.stderr.write(`visual-runtime: shut down on ${signal}\n`);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await server.connect(transport);
}

// Only auto-start when this module is the process entrypoint (not when
// imported by tests via `createServer`/`../tool-handlers.js` directly).
//
// Resolve symlinks on both sides before comparing: npm/npx always invoke
// this file through the `node_modules/.bin/visual-runtime` bin symlink, so
// `process.argv[1]` is the symlink path while `import.meta.url` is already
// the fully-resolved real path — a naive string comparison never matches
// under npx, silently skipping `main()` with no error and no output.
function resolveMainModulePath(): string | undefined {
  if (!process.argv[1]) {
    return undefined;
  }
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1];
  }
}

const isMainModule = resolveMainModulePath() === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`visual-runtime: fatal error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
