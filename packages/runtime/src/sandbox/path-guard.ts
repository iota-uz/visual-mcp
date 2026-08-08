/**
 * Filesystem join on top of the shared path normalizer.
 *
 * All validation lives in `src/paths/index.ts` and is filesystem-free, so
 * the same rules apply whether a path becomes a real file (here, in the
 * render worker) or a storage key (in a Convex function). This module adds
 * only the join against a concrete workspace root — plus a belt-and-braces
 * re-check that the joined result really is inside that root, which costs
 * nothing and would catch any future normalizer regression before it
 * reached the filesystem.
 */

import path from "node:path";
import type { PathAccessMode } from "../paths/index.js";
import { normalizeCanvasPath, SandboxPathError } from "../paths/index.js";

export type { PathAccessMode } from "../paths/index.js";
export { SandboxPathError } from "../paths/index.js";

/**
 * Resolves `requestedPath` against `workspaceRoot`, enforcing confinement.
 *
 * @param workspaceRoot Absolute path to the session workspace root.
 * @param requestedPath Path as supplied by the tool caller / sandboxed code,
 *   e.g. "/src/report.html". Leading slashes are treated as
 *   workspace-root-relative, not host-filesystem-absolute.
 * @param mode See `PathAccessMode`.
 * @returns The resolved absolute filesystem path.
 * @throws {SandboxPathError} if the path escapes the workspace or targets a
 *   directory the mode disallows.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  mode: PathAccessMode,
): string {
  const { relPath } = normalizeCanvasPath(requestedPath, mode);

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relPath);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new SandboxPathError(`Path escapes session workspace: ${requestedPath}`);
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
  return `/${rel.split(path.sep).join("/")}`;
}
