/**
 * Artifact store (PLAN.md section 12; backs MCP tools 6.5 `list_artifacts`
 * and 6.6 `export_artifact`).
 *
 * Tracks artifacts produced in a session's `/output` directory and persists
 * `sessions/<session_id>/output/manifest.json` matching the
 * `ArtifactManifest` shape in /src/types.ts.
 *
 * Session workspace convention (owned by the sandbox module — see PLAN.md
 * section 7): `sessions/<session_id>/{src,output,assets,templates,cache}`
 * relative to the repo root. This module recomputes the repo root from its
 * own file location (works identically whether running from `src/` via tsx
 * or from the built `dist/` output, since both sit at the same depth under
 * the repo root: `<root>/src/render/artifact-store` and
 * `<root>/dist/render/artifact-store`) rather than relying on `process.cwd()`.
 *
 * Artifact `path` fields are session-workspace-relative, POSIX-style, and
 * always start with a leading slash, e.g. "/output/report.pdf" — matching
 * the examples in PLAN.md sections 6.4/6.5/12.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCanvasPath } from "../../paths/index.js";
import type {
  Artifact,
  ArtifactManifest,
  ArtifactRole,
  ArtifactType,
  ExportArtifactOutput,
  ListArtifactsOutput,
} from "../../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo root, resolved relative to this module's own location:
 * `<root>/src/render/artifact-store/index.ts` (or the built
 * `<root>/dist/render/artifact-store/index.js`) — three levels up in both
 * cases.
 */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Absolute path to a session's workspace root: `sessions/<session_id>`. */
export function sessionRootDir(sessionId: string): string {
  return path.join(REPO_ROOT, "sessions", sessionId);
}

/** Absolute path to a session's `/output` directory. */
export function sessionOutputDir(sessionId: string): string {
  return path.join(sessionRootDir(sessionId), "output");
}

function manifestFilePath(sessionId: string): string {
  return path.join(sessionOutputDir(sessionId), "manifest.json");
}

/** Thrown by {@link exportArtifact} when the requested path escapes `/output`. */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/** Thrown by {@link exportArtifact} when the requested file does not exist (or is not a file). */
export class ArtifactNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactNotFoundError";
  }
}

/* ------------------------------------------------------------------------
 * Manifest persistence
 * ---------------------------------------------------------------------- */

// Serialize concurrent registerArtifact() calls per session so read-modify
// -write races (multiple modules registering artifacts around the same
// time) can't drop an update.
const writeLocks = new Map<string, Promise<unknown>>();

function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(sessionId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // Swallow rejections here so the lock chain itself never breaks; the
  // caller of registerArtifact still observes the original rejection via
  // the returned `run` promise.
  writeLocks.set(
    sessionId,
    run.catch(() => undefined),
  );
  return run;
}

async function readManifestFromDisk(sessionId: string): Promise<ArtifactManifest | null> {
  try {
    const raw = await fs.readFile(manifestFilePath(sessionId), "utf8");
    return JSON.parse(raw) as ArtifactManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeManifestToDisk(sessionId: string, manifest: ArtifactManifest): Promise<void> {
  await fs.mkdir(sessionOutputDir(sessionId), { recursive: true });
  await fs.writeFile(manifestFilePath(sessionId), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function normalizeArtifactPath(p: string): string {
  const posixPath = p.split(path.sep).join("/");
  return posixPath.startsWith("/") ? posixPath : `/${posixPath}`;
}

/* ------------------------------------------------------------------------
 * Public API
 * ---------------------------------------------------------------------- */

/**
 * Record a newly-produced artifact for a session, persisting the update to
 * `sessions/<session_id>/output/manifest.json`.
 *
 * Role inference (only applies when `role` is omitted):
 *  - The first artifact ever registered for a session becomes `"primary"`.
 *  - Every subsequent artifact registered without an explicit role becomes
 *    `"supporting"`.
 *
 * If `role` is explicitly `"primary"`, any other artifact currently marked
 * `"primary"` is demoted to `"supporting"` — at most one artifact holds
 * `"primary"` at a time. Re-registering an existing `path` overwrites that
 * artifact's `type`/`role` in place rather than duplicating the entry.
 *
 * `created_at` is set once, on the first registration for a session, and
 * left untouched on subsequent calls.
 */
export async function registerArtifact(
  sessionId: string,
  artifactPath: string,
  type: ArtifactType,
  role?: ArtifactRole,
): Promise<void> {
  await withLock(sessionId, async () => {
    const normalizedPath = normalizeArtifactPath(artifactPath);
    const manifest = (await readManifestFromDisk(sessionId)) ?? {
      session_id: sessionId,
      primary: null,
      artifacts: [],
      created_at: new Date().toISOString(),
    };

    const isFirstEver = manifest.artifacts.length === 0;
    const resolvedRole: ArtifactRole = role ?? (isFirstEver ? "primary" : "supporting");

    const artifact: Artifact = {
      path: normalizedPath,
      type,
      role: resolvedRole,
    };

    const existingIdx = manifest.artifacts.findIndex((a) => a.path === normalizedPath);
    if (existingIdx >= 0) {
      manifest.artifacts[existingIdx] = artifact;
    } else {
      manifest.artifacts.push(artifact);
    }

    if (resolvedRole === "primary") {
      for (const a of manifest.artifacts) {
        if (a.path !== normalizedPath && a.role === "primary") {
          a.role = "supporting";
        }
      }
    }

    // Recompute `primary` from the artifacts array rather than tracking it
    // separately, so the invariant "primary points at the sole
    // role: 'primary' artifact" always holds — including when a caller
    // demotes the current primary by re-registering it with a different
    // explicit role.
    manifest.primary = manifest.artifacts.find((a) => a.role === "primary")?.path ?? null;

    await writeManifestToDisk(sessionId, manifest);
  });
}

/**
 * Read the current manifest for a session from
 * `sessions/<session_id>/output/manifest.json`.
 *
 * The persisted file is always the source of truth (no in-memory cache), so
 * a fresh process reading the same session sees the same manifest. If no
 * manifest has been persisted yet (no artifacts registered), returns an
 * empty manifest (`primary: null`, `artifacts: []`) rather than throwing —
 * this is not itself persisted to disk.
 */
export async function getManifest(sessionId: string): Promise<ArtifactManifest> {
  const manifest = await readManifestFromDisk(sessionId);
  if (manifest) return manifest;
  return {
    session_id: sessionId,
    primary: null,
    artifacts: [],
    created_at: new Date().toISOString(),
  };
}

/**
 * Backs the `list_artifacts` MCP tool (PLAN.md 6.5). Per the type-decision
 * recorded in /src/types.ts, `ListArtifactsOutput` is the full
 * `ArtifactManifest` shape, so this is just `getManifest` under its
 * tool-facing name.
 */
export async function listArtifacts(sessionId: string): Promise<ListArtifactsOutput> {
  return getManifest(sessionId);
}

const EXTENSION_INFO: Record<string, { type: ArtifactType; mime: string }> = {
  ".pdf": { type: "pdf", mime: "application/pdf" },
  ".svg": { type: "svg", mime: "image/svg+xml" },
  ".png": { type: "image", mime: "image/png" },
  ".jpg": { type: "image", mime: "image/jpeg" },
  ".jpeg": { type: "image", mime: "image/jpeg" },
  ".gif": { type: "image", mime: "image/gif" },
  ".webp": { type: "image", mime: "image/webp" },
  ".html": { type: "source", mime: "text/html" },
  ".htm": { type: "source", mime: "text/html" },
  ".zip": { type: "source", mime: "application/zip" },
  ".json": { type: "source", mime: "application/json" },
};

function inferArtifactInfo(filePath: string): { type: ArtifactType; mime: string } {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_INFO[ext] ?? { type: "source", mime: "application/octet-stream" };
}

/**
 * Resolve a session-relative artifact path (e.g. "/output/report.pdf") to
 * an absolute filesystem path, rejecting anything that would escape the
 * session's `/output` directory (path traversal via "..", absolute paths
 * pointing elsewhere, or paths under /src, /assets, /templates, /cache).
 *
 * Validation is the shared `artifact`-mode normalizer; only the error type
 * is local, because `export_artifact` reports traversal as
 * {@link PathTraversalError} rather than the sandbox's error class.
 */
function resolveOutputAbsolutePath(sessionId: string, requestedPath: string): string {
  let relPath: string;
  try {
    ({ relPath } = normalizeCanvasPath(requestedPath, "artifact"));
  } catch {
    throw new PathTraversalError(
      `Path "${requestedPath}" is outside session "${sessionId}"'s /output directory`,
    );
  }

  return path.resolve(sessionRootDir(sessionId), relPath);
}

/**
 * Backs the `export_artifact` MCP tool (PLAN.md 6.6). Reads the artifact
 * file off disk (after confirming it exists and lives inside the session's
 * `/output` directory) and returns its manifest metadata plus enough info
 * for the MCP server layer to read/stream the bytes itself.
 *
 * Rejects (throws {@link PathTraversalError}) any `path` that resolves
 * outside `sessions/<session_id>/output/`. Throws
 * {@link ArtifactNotFoundError} if the file doesn't exist or isn't a
 * regular file.
 */
export async function exportArtifact(
  sessionId: string,
  requestedPath: string,
): Promise<ExportArtifactOutput> {
  const absolutePath = resolveOutputAbsolutePath(sessionId, requestedPath);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ArtifactNotFoundError(
        `Artifact not found: "${requestedPath}" (session "${sessionId}")`,
      );
    }
    throw err;
  }
  if (!stat.isFile()) {
    throw new ArtifactNotFoundError(
      `Artifact path is not a regular file: "${requestedPath}" (session "${sessionId}")`,
    );
  }

  const normalizedPath = normalizeArtifactPath(requestedPath);
  const manifest = await getManifest(sessionId);
  const known = manifest.artifacts.find((a) => a.path === normalizedPath);
  const inferred = inferArtifactInfo(absolutePath);

  const artifact: Artifact = known ?? {
    path: normalizedPath,
    type: inferred.type,
    role: "supporting",
  };

  return {
    artifact,
    absolute_path: absolutePath,
    mime_type: inferred.mime,
  };
}
