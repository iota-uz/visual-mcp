/**
 * Session workspace lifecycle (PLAN.md sections 2.2, 6.1, 7, 13).
 *
 * Owns the on-disk layout:
 *
 *   <SESSIONS_ROOT>/<session_id>/{src,output,assets,templates,cache}
 *
 * Base directory choice: `SESSIONS_ROOT` is resolved relative to this
 * *package's* install location (two directories up from this file, i.e.
 * `dist/sandbox/workspace.js` -> package root in prod, `src/sandbox/
 * workspace.ts` -> package root in dev), NOT `process.cwd()`. An MCP
 * server is typically launched by a host process (Claude Desktop, an
 * agent runtime, etc.) with an arbitrary/unpredictable working directory,
 * so anchoring to the package's own location is the only choice that
 * reliably lands sessions in the same place every run. This matches the
 * `.gitignore` convention (`sessions/` at the repo root).
 *
 * `template` (PLAN.md 6.1) is accepted and recorded on request, but this
 * module does not populate `/templates` with template content — that is
 * the template registry's job (see src/templates). Populating the
 * workspace's read-only /templates directory from a chosen template id is
 * left as an integration point for whichever module wires
 * create_visual_session end-to-end (likely src/server, calling into
 * src/templates).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Session } from "../types.js";

/**
 * Exported (not just module-private) so `../storage/workspace.ts`'s
 * `hydrate()` — the mkdtemp-based workspace builder used by the render
 * worker — creates the identical directory shape without a second,
 * independently-maintained copy of this list.
 */
export const WORKSPACE_SUBDIRS = ["src", "output", "assets", "templates", "cache"] as const;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute path to the directory that contains all session workspaces. */
export const SESSIONS_ROOT = path.join(PACKAGE_ROOT, "sessions");

/** Session ids must be filesystem-safe and unambiguous — no ".." or path separators. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertValidSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      `Invalid session_id: ${JSON.stringify(sessionId)} (must match ${SESSION_ID_PATTERN})`,
    );
  }
}

/** Generates a fresh, collision-resistant session id, e.g. "sess_<uuid>". */
export function generateSessionId(): string {
  return `sess_${randomUUID()}`;
}

/**
 * Returns the absolute workspace directory for a session id without
 * touching the filesystem. Validates the id is safe to join onto
 * `SESSIONS_ROOT` (rejects traversal via the id itself).
 */
export function getSessionWorkspaceDir(sessionId: string): string {
  assertValidSessionId(sessionId);
  return path.join(SESSIONS_ROOT, sessionId);
}

/**
 * Creates (or re-creates missing subdirectories of) a session workspace on
 * disk and returns its `Session` descriptor. Idempotent: safe to call
 * again for an existing session id.
 *
 * `template` is accepted for forward compatibility with `create_visual_session`
 * (PLAN.md 6.1) but is not applied here — see module header comment.
 */
export function createSessionWorkspace(sessionId: string, _template?: string): Session {
  const workspace = getSessionWorkspaceDir(sessionId);
  for (const sub of WORKSPACE_SUBDIRS) {
    fs.mkdirSync(path.join(workspace, sub), { recursive: true });
  }
  return {
    session_id: sessionId,
    workspace,
    created_at: new Date().toISOString(),
  };
}

/** True if a workspace directory already exists on disk for this session id. */
export function sessionWorkspaceExists(sessionId: string): boolean {
  return fs.existsSync(getSessionWorkspaceDir(sessionId));
}

/** Tears down a session workspace and everything under it. Best-effort. */
export function removeSessionWorkspace(sessionId: string): void {
  fs.rmSync(getSessionWorkspaceDir(sessionId), { recursive: true, force: true });
}
