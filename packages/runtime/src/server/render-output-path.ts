/**
 * Path confinement for `render_file`'s `output_path` (PLAN.md sections 6.4,
 * 7, 15).
 *
 * `write_file` (src/sandbox/path-guard.ts) restricts writes to `/src` and
 * `/output` only. `render_file` needs a slightly wider allowance: PLAN.md
 * section 15's worked example renders an intermediate D2 SVG to
 * `/cache/architecture.svg` before embedding it into an HTML report and
 * rendering *that* to the final `/output/*.pdf`. So `render_file` output
 * targets may land in `/output` (final artifacts, tracked in the artifact
 * manifest) or `/cache` (scratch intermediates, deliberately NOT tracked in
 * the manifest — see tool-handlers.ts render_file, which only calls
 * `registerArtifact` when the resolved top-level directory is `/output`).
 *
 * `/src`, `/assets`, `/templates` are not valid render_file output targets:
 * `/src` is for authored source (write_file's job), `/assets` and
 * `/templates` are read-only from the sandbox's perspective (PLAN.md
 * section 7).
 */

import path from "node:path";
import { SandboxPathError } from "../sandbox/index.js";

const RENDER_OUTPUT_TOP_LEVEL_DIRS = new Set(["output", "cache"]);

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
  if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
    throw new SandboxPathError("output_path must be a non-empty string");
  }

  const relative = requestedPath.replace(/^[/\\]+/, "");
  if (relative.length === 0) {
    throw new SandboxPathError(
      `output_path must not be the workspace root itself: ${requestedPath}`,
    );
  }

  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, relative);
  const rootWithSep = root + path.sep;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new SandboxPathError(`output_path escapes session workspace: ${requestedPath}`);
  }

  const relFromRoot = path.relative(root, resolved);
  const topDir = relFromRoot.split(path.sep)[0];
  if (!topDir || !RENDER_OUTPUT_TOP_LEVEL_DIRS.has(topDir)) {
    throw new SandboxPathError(
      `render_file output_path must be under /output or /cache (got: ${requestedPath})`,
    );
  }

  return { absolutePath: resolved, topDir: topDir as "output" | "cache" };
}
