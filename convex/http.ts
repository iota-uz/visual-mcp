/**
 * A1.0 SPIKE (PLAN.md section 6, section 9 milestone A1) — proves
 * `createMcpHandler` from the official MCP TypeScript SDK v2
 * (`@modelcontextprotocol/server`) runs inside a Convex `httpAction`.
 *
 * This is deliberately not the real `/mcp` endpoint: one `echo` tool, no
 * `ToolContext`/`RenderClient` wiring, no bearer-token auth. If this file
 * deploys and `POST /mcp` round-trips a tool call, the spike is proven and
 * the real tool handlers (transport-agnostic per PLAN.md section 6) get
 * wired in for A1. If it fails to bundle or throws at runtime, PLAN.md
 * section 6's documented fallback applies immediately — a small Hono
 * service on Railway using `@modelcontextprotocol/hono` — no polyfilling
 * or debugging session against Convex's runtime.
 *
 * Why this should work: Convex's default httpAction runtime is a V8
 * isolate "very similar to the Cloudflare Workers runtime" (Convex docs),
 * and the SDK's main entry (`@modelcontextprotocol/server`'s `index.mjs`)
 * has no real `node:` imports of its own — `createMcpHandler` returns a
 * plain `{ fetch(request): Promise<Response> }` web-standard handler. The
 * one thing it does import conditionally, a JSON-schema-validator shim from
 * its own `/_shims` subpath export, ships dedicated `workerd` and `browser`
 * variants with zero `node:` imports (only the Node-targeted variant pulls
 * in `node:process`) — so this only fails if Convex's bundler resolves that
 * shim to the Node variant AND the isolate can't satisfy `node:process`
 * (the default runtime does expose a `process.env` shim per Convex's docs,
 * so even that path may be fine — this spike is what actually settles it).
 */

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { httpRouter } from "convex/server";
import { z } from "zod";
import { httpAction } from "./_generated/server";

const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({ name: "visual-canvas-spike", version: "0.0.0" });
  server.registerTool(
    "echo",
    {
      description:
        "Echoes back the provided text. Spike-only tool proving the MCP SDK v2 runs inside a Convex httpAction (PLAN.md A1.0).",
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  return server;
});

const http = httpRouter();

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (_ctx, request) => mcpHandler.fetch(request)),
});

export default http;
