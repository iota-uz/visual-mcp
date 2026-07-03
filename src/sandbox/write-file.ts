/**
 * `write_file` MCP tool semantics (PLAN.md section 6.3, 7).
 *
 * Writes are confined to the session workspace and restricted to the
 * `/src` and `/output` subtrees (see path-guard.ts for the exact rules).
 */

import fs from "node:fs";
import path from "node:path";
import type { Session, WriteFileOutput } from "../types.js";
import { resolveWorkspacePath, toWorkspaceDisplayPath } from "./path-guard.js";

/**
 * Writes `content` to `requestedPath` inside `session`'s workspace.
 *
 * @throws {SandboxPathError} if `requestedPath` escapes the workspace, or
 *   is outside `/src` or `/output`.
 */
export function writeFile(
  session: Session,
  requestedPath: string,
  content: string,
): WriteFileOutput {
  const absolutePath = resolveWorkspacePath(session.workspace, requestedPath, "write");
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");

  return {
    path: toWorkspaceDisplayPath(session.workspace, absolutePath),
    bytes_written: Buffer.byteLength(content, "utf8"),
  };
}
