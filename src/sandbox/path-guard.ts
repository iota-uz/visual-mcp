/**
 * Path confinement for the session workspace (PLAN.md section 7).
 *
 * Every path the sandbox (or `write_file`) touches goes through
 * `resolveWorkspacePath`. It is the single place that:
 *
 *   - accepts workspace-relative paths in the tool-facing shape used by
 *     PLAN.md examples, e.g. "/src/report.html" or "src/report.html";
 *   - rejects any path that resolves outside the session workspace root
 *     (via "..", absolute-path tricks, etc.);
 *   - for `mode: "write"`, additionally rejects anything outside the
 *     top-level `/src` or `/output` directories, per PLAN.md section 7:
 *     "LLM can write to /src and /output" only. `/templates`, `/assets`
 *     and `/cache` are read-only from the sandbox's perspective.
 *
 * This module is used both by `write-file.ts` (the `write_file` MCP tool)
 * and — in duplicated plain-JS form — by the worker sandbox's scoped `fs`
 * (see `worker-source.ts`). See that file's header comment for why the
 * logic is duplicated instead of imported.
 */

import path from "node:path";

export type PathAccessMode = "read" | "write";

/** Thrown for any rejected path so callers can distinguish this from I/O errors. */
export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

const WRITABLE_TOP_LEVEL_DIRS = new Set(["src", "output"]);

/**
 * Resolves `requestedPath` against `workspaceRoot`, enforcing confinement.
 *
 * @param workspaceRoot Absolute path to the session workspace root.
 * @param requestedPath Path as supplied by the tool caller / sandboxed code,
 *   e.g. "/src/report.html". Leading slashes are treated as
 *   workspace-root-relative, not host-filesystem-absolute.
 * @param mode "read" allows anywhere inside the workspace; "write" is
 *   additionally restricted to `/src` and `/output`.
 * @returns The resolved absolute filesystem path.
 * @throws {SandboxPathError} if the path escapes the workspace, or (in
 *   write mode) escapes /src or /output.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  mode: PathAccessMode,
): string {
  if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
    throw new SandboxPathError("Path must be a non-empty string");
  }

  // Strip leading slashes/backslashes so "/src/x" is treated as
  // workspace-relative "src/x", not filesystem-root-absolute.
  const relative = requestedPath.replace(/^[/\\]+/, "");
  if (relative.length === 0) {
    throw new SandboxPathError(`Path must not be the workspace root itself: ${requestedPath}`);
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relative);
  const rootWithSep = root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new SandboxPathError(`Path escapes session workspace: ${requestedPath}`);
  }

  if (mode === "write") {
    const relFromRoot = path.relative(root, resolved);
    const topDir = relFromRoot.split(path.sep)[0];
    if (!topDir || !WRITABLE_TOP_LEVEL_DIRS.has(topDir)) {
      throw new SandboxPathError(
        `Writes are only allowed under /src or /output (got: ${requestedPath})`,
      );
    }
  }

  return resolved;
}

/**
 * Converts an absolute filesystem path back to the canonical
 * workspace-relative display form ("/src/report.html") used in tool
 * outputs (e.g. `WriteFileOutput.path`, `Artifact.path`).
 */
export function toWorkspaceDisplayPath(workspaceRoot: string, absolutePath: string): string {
  const rel = path.relative(path.resolve(workspaceRoot), absolutePath);
  return "/" + rel.split(path.sep).join("/");
}
