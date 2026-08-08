/**
 * Error -> MCP tool error result mapping.
 *
 * Every tool handler in tool-handlers.ts is wrapped (see index.ts) so a
 * thrown error never crashes the server process or the stdio transport —
 * it is always turned into a `CallToolResult` with `isError: true` and a
 * human-readable `content` text block an LLM caller can act on.
 *
 * Known error classes from sibling modules are given a short, recognizable
 * prefix so a caller (or a human reading logs) can tell at a glance which
 * layer rejected the request:
 *
 *   - UnknownSessionError (this module's session-store.ts)
 *   - SandboxPathError    (src/sandbox — write_file / run_code / render_file path confinement)
 *   - PathTraversalError  (src/render/artifact-store — export_artifact escaping /output)
 *   - ArtifactNotFoundError (src/render/artifact-store — export_artifact on a missing file)
 *   - D2RenderError       (src/render/diagrams — D2 compile/render failures)
 *   - anything else (Playwright renderer errors, zod validation errors, etc.)
 *     falls back to a generic "<Error name>: <message>" text.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ArtifactNotFoundError, PathTraversalError } from "../render/artifact-store/index.js";
import { D2RenderError } from "../render/diagrams/index.js";
import { SandboxPathError } from "../sandbox/index.js";
import { UnknownSessionError } from "./session-store.js";

function labelFor(err: unknown): string {
  if (err instanceof UnknownSessionError) return "unknown_session_id";
  if (err instanceof SandboxPathError) return "sandbox_path_error";
  if (err instanceof PathTraversalError) return "artifact_path_traversal";
  if (err instanceof ArtifactNotFoundError) return "artifact_not_found";
  if (err instanceof D2RenderError) return "d2_render_error";
  if (err instanceof Error) return err.name || "error";
  return "error";
}

function messageFor(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Converts any thrown value from a tool handler into a `CallToolResult`
 * shape (`{ isError: true, content: [...] }`). Never throws itself.
 */
export function toToolErrorResult(err: unknown): CallToolResult {
  const label = labelFor(err);
  const message = messageFor(err);
  return {
    isError: true,
    content: [{ type: "text", text: `[${label}] ${message}` }],
  };
}
