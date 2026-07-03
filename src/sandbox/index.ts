/**
 * Node.js sandbox runner — public API (PLAN.md section 9).
 *
 * Owns the session workspace lifecycle, `write_file` semantics, and
 * `run_code` execution. See workspace.ts, write-file.ts and run-code.ts
 * for the implementation and design notes; this file just re-exports the
 * stable surface other modules (notably the future src/server MCP tool
 * handlers) should call.
 *
 * Public API summary for integrators:
 *
 *   generateSessionId(): string
 *   createSessionWorkspace(sessionId: string, template?: string): Session
 *   getSessionWorkspaceDir(sessionId: string): string
 *   sessionWorkspaceExists(sessionId: string): boolean
 *   removeSessionWorkspace(sessionId: string): void
 *   writeFile(session: Session, path: string, content: string): WriteFileOutput
 *   runCode(session: Session, code: string, options?: RunCodeOptions): Promise<RunCodeOutput>
 *
 * Note: `writeFile`/`runCode` take a `Session` object (as created by
 * `createSessionWorkspace`), not a bare `session_id`. Session-id ->
 * Session bookkeeping (e.g. an in-memory Map for the lifetime of the MCP
 * server process) is intentionally left to src/server, which is best
 * positioned to own request-level session lookup/validation (e.g.
 * "unknown session_id" errors) for all 7 tools, not just these two.
 */

export { SandboxPathError, resolveWorkspacePath, toWorkspaceDisplayPath } from "./path-guard.js";
export type { PathAccessMode } from "./path-guard.js";

export {
  SESSIONS_ROOT,
  generateSessionId,
  createSessionWorkspace,
  getSessionWorkspaceDir,
  sessionWorkspaceExists,
  removeSessionWorkspace,
} from "./workspace.js";

export { writeFile } from "./write-file.js";

export { runCode } from "./run-code.js";
export type { RunCodeOptions } from "./run-code.js";
