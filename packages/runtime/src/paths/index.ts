/**
 * Canvas path confinement — the single source of truth.
 *
 * Historically this logic existed in four hand-rolled copies that had to
 * agree with each other by convention:
 *
 *   1. `sandbox/path-guard.ts`        — write_file, modes read/write
 *   2. `server/render-output-path.ts` — render_file, modes output/cache
 *   3. `render/artifact-store`'s `resolveOutputAbsolutePath` — export_artifact
 *   4. a plain-JS duplicate embedded as a *string* in `sandbox/worker-source.ts`
 *
 * They are now one function. `normalizeCanvasPath` is deliberately
 * **filesystem-free**: it is pure string logic over a POSIX-style
 * workspace-relative path, so the same validation runs in a Convex
 * function (where there is no filesystem and paths are storage keys) and
 * in the render worker (where they become real files under a temp dir).
 * `resolveWorkspacePath` is the thin join on top for the worker side.
 *
 * Copy 4 cannot be deleted — tsx's loader hooks do not propagate into
 * `worker_threads`, so the worker body genuinely cannot import this
 * module — but it is no longer a *copy*. `CANVAS_PATH_GUARD_SOURCE` is
 * `normalizeCanvasPathStandalone.toString()`: the worker executes the very
 * same function object this module validates with, so the two cannot
 * disagree. That is why the standalone function below references nothing
 * in module scope, and why this package must not be minified or bundled
 * with name mangling.
 */

/**
 * Access modes, each with its own allowed top-level directories.
 *
 * - `read`  — anywhere inside the workspace.
 * - `write` — `/src`, `/output` and `/assets`. `/assets` is writable so a
 *   caller can upload the images/fonts its HTML references; without it the
 *   only way to ship an image was to base64-inline it into the document,
 *   which multiplies payload size and burns the agent's context. `/cache`
 *   stays render-only (it is TTL-swept) and `/templates` stays read-only.
 * - `render-output` — `/output` (final artifacts, tracked in the manifest)
 *   and `/cache` (scratch intermediates, deliberately untracked): an
 *   intermediate D2 SVG can be rendered to `/cache/architecture.svg` before
 *   being embedded in a final PDF.
 *
 * Note on `/assets` precedence: `hydrate()` vendors the ApexCharts bundle
 * into `/assets/js/` *before* seeding canvas files, so a canvas that writes
 * that exact path deliberately overrides the vendored copy rather than
 * being silently ignored.
 */
export type PathAccessMode = "read" | "write" | "render-output";

/** Thrown for any rejected path so callers can distinguish this from I/O errors. */
export class SandboxPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

export interface NormalizedCanvasPath {
  /** Canonical workspace-relative POSIX path, no leading slash: `src/report.html`. */
  relPath: string;
  /** Canonical display/tool-output form: `/src/report.html`. */
  displayPath: string;
  /** Top-level directory the path resolved into: `src`, `output`, `cache`, ... */
  topDir: string;
}

/**
 * The actual rules. Kept free of every module-scope reference — no
 * imports, no shared constants, no custom error class — because this
 * function is stringified verbatim into the sandbox worker. Throws plain
 * `Error`; `normalizeCanvasPath` re-wraps into `SandboxPathError` for
 * callers on this side of the boundary.
 *
 * Leading slashes are treated as workspace-root-relative, not
 * host-filesystem-absolute, so `/src/report.html` and `src/report.html`
 * normalise to the same value. `.` segments are dropped and `..` segments
 * resolved; a `..` that would climb above the workspace root is rejected
 * rather than clamped.
 *
 * Backslashes are treated as separators too. On POSIX a backslash is a
 * legal filename character, so this is stricter than `path.resolve` — but
 * a canvas path containing one is pathological, and accepting it would
 * mean the same input normalising differently on Windows and Linux.
 */
function normalizeCanvasPathStandalone(
  requestedPath: string,
  mode: PathAccessMode,
  label = "Path",
): NormalizedCanvasPath {
  const allowedByMode: Record<string, string[] | null> = {
    read: null,
    write: ["src", "output", "assets"],
    "render-output": ["output", "cache"],
  };

  if (typeof requestedPath !== "string" || requestedPath.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (requestedPath.indexOf("\0") !== -1) {
    throw new Error(`${label} must not contain a NUL byte`);
  }

  const segments: string[] = [];
  const rawSegments = requestedPath.split(/[/\\]+/);
  for (const segment of rawSegments) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    // A `..` that would climb above the workspace root is an escape
    // attempt, not something to clamp to the root.
    if (segments.length === 0) {
      throw new Error(`${label} escapes session workspace: ${requestedPath}`);
    }
    segments.pop();
  }

  if (segments.length === 0) {
    throw new Error(`${label} must not be the workspace root itself: ${requestedPath}`);
  }

  const topDir = segments[0] as string;
  const allowed = allowedByMode[mode];
  if (allowed === undefined) {
    throw new Error(`Unknown path access mode: ${mode}`);
  }
  if (allowed && allowed.indexOf(topDir) === -1) {
    const dirs = allowed.map((d) => `/${d}`);
    const pretty =
      dirs.length > 1 ? `${dirs.slice(0, -1).join(", ")} or ${dirs[dirs.length - 1]}` : dirs[0];
    throw new Error(
      mode === "write"
        ? `Writes are only allowed under ${pretty} (got: ${requestedPath})`
        : `${label} must be under ${pretty} (got: ${requestedPath})`,
    );
  }

  const relPath = segments.join("/");
  return { relPath: relPath, displayPath: `/${relPath}`, topDir: topDir };
}

/**
 * Source text of {@link normalizeCanvasPathStandalone}, for injection into
 * the sandbox worker body. Not a maintained copy — the same function.
 */
export const CANVAS_PATH_GUARD_SOURCE: string = normalizeCanvasPathStandalone.toString();

/**
 * Validates and canonicalises a workspace-relative path without touching
 * the filesystem.
 *
 * @param requestedPath Path as supplied by the tool caller or sandboxed code.
 * @param mode Which top-level directories are permitted.
 * @param label Noun used in error messages, e.g. `output_path`. Callers
 *   pass this so messages read the way the tool's caller expects.
 * @throws {SandboxPathError} if the path is empty, is the workspace root
 *   itself, escapes the workspace, or targets a disallowed directory.
 */
export function normalizeCanvasPath(
  requestedPath: string,
  mode: PathAccessMode,
  label = "Path",
): NormalizedCanvasPath {
  try {
    return normalizeCanvasPathStandalone(requestedPath, mode, label);
  } catch (err) {
    throw new SandboxPathError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Converts an already-canonical relative path back to the display form
 * used in tool outputs (`WriteFileOutput.path`, `Artifact.path`).
 */
export function toDisplayPath(relPath: string): string {
  return relPath.startsWith("/") ? relPath : `/${relPath}`;
}
