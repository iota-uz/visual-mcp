/**
 * `render_file`'s `output_path` confinement.
 *
 * The rules now live in `src/paths/index.ts` under the `render-output`
 * mode; this module keeps the render-specific return shape (callers need
 * `topDir` to decide whether the result is a tracked artifact in `/output`
 * or an untracked scratch intermediate in `/cache` — see tool-handlers.ts
 * render_file, which only calls `registerArtifact` for the former).
 */

import path from "node:path";
import { normalizeCanvasPath } from "../paths/index.js";

export interface ResolvedRenderOutputPath {
  /** Absolute filesystem path. */
  absolutePath: string;
  /** Top-level workspace directory the path resolved into: "output" | "cache". */
  topDir: "output" | "cache";
}

/**
 * Resolves `render_file`'s `output_path` against a session workspace,
 * confining it to `/output` or `/cache`.
 *
 * @throws {SandboxPathError} if the path is empty, the workspace root
 *   itself, escapes the workspace, or targets a directory other than
 *   `/output` or `/cache`.
 */
export function resolveRenderOutputPath(
  workspaceRoot: string,
  requestedPath: string,
): ResolvedRenderOutputPath {
  const { relPath, topDir } = normalizeCanvasPath(requestedPath, "render-output", "output_path");

  return {
    absolutePath: path.resolve(workspaceRoot, relPath),
    topDir: topDir as "output" | "cache",
  };
}
