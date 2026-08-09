/**
 * Node.js sandbox runner — public API (PLAN.md Part 2 section 9).
 *
 * `write_file` semantics and `run_code` execution. See write-file.ts and
 * run-code.ts for the implementation and design notes; this file just
 * re-exports the stable surface other modules should call. The session
 * workspace lifecycle that used to live here was removed along with the
 * local stdio server — callers now build a `Session`-shaped `{session_id,
 * workspace, created_at}` object themselves against a hydrated worker
 * temp dir (see apps/worker/src/exec.ts).
 *
 * Public API summary for integrators:
 *
 *   writeFile(session: Session, path: string, content: string): WriteFileOutput
 *   runCode(session: Session, code: string, options?: RunCodeOptions): Promise<RunCodeOutput>
 */

export type { PathAccessMode } from "./path-guard.js";
export { resolveWorkspacePath, SandboxPathError, toWorkspaceDisplayPath } from "./path-guard.js";
export type { RunCodeOptions } from "./run-code.js";
export { runCode } from "./run-code.js";
export { writeFile } from "./write-file.js";
