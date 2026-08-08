/**
 * Render-worker workspace helpers (PLAN.md section 5).
 *
 * `hydrate()`/`collectOutputs()` are what let `src/render/playwright-renderer/*`,
 * `tailwind.ts`, and the sandbox modules run **unchanged** against a
 * Convex-backed canvas instead of a persistent `sessions/<id>/` directory:
 * they already take an explicit, absolute `workspaceRoot` and know nothing
 * about where it came from. `hydrate()` builds a throwaway one per job;
 * `collectOutputs()` reads the results back out of it afterwards. Nothing
 * here is Convex-specific — `SignedFile.getUrl` is fetched with the
 * platform `fetch`, so it works equally against a real presigned Convex URL
 * and against `DiskCanvasStorage`'s `data:` URLs in tests.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeCanvasPath, toDisplayPath } from "../paths/index.js";
import { ensureApexChartsAsset } from "../render/charts/index.js";
import { WORKSPACE_SUBDIRS } from "../sandbox/workspace.js";

/** One input file to seed into a hydrated workspace. */
export interface SignedFile {
  /** Workspace-relative path to write the file to, e.g. "/src/report.html". */
  relPath: string;
  /** URL that, when fetched, returns the file's bytes. */
  getUrl: string;
}

export interface HydratedWorkspace {
  /** Absolute path to the temp directory's root — pass this as `workspaceRoot`. */
  root: string;
  /** Recursively removes the temp directory. Safe to call more than once. */
  dispose(): Promise<void>;
}

/** One file found under a hydrated workspace's `/output` by {@link collectOutputs}. */
export interface LocalArtifact {
  /** Workspace-relative, POSIX, leading-slash: "/output/report.pdf". */
  relPath: string;
  /** Absolute filesystem path, for reading the bytes. */
  absolutePath: string;
  size: number;
  mtimeMs: number;
}

/**
 * Creates a fresh temp directory (`<os.tmpdir()>/vc-<random>/`) shaped like
 * a session workspace — the same `src/output/assets/templates/cache`
 * subdirectories `sandbox/workspace.ts` creates, with the ApexCharts bundle
 * already vendored into `/assets/js/` via `ensureApexChartsAsset` (PLAN.md
 * section 3.3) — and downloads every `files` entry into it. Without this,
 * a chart authored in a hydrated workspace would 404 on
 * `/assets/js/apexcharts.min.js` at render time, since nothing else
 * populates it.
 *
 * Each `relPath` is routed through `normalizeCanvasPath` in `read` mode
 * (any top-level directory, traversal rejected) before being joined onto
 * the temp root, so a malicious or malformed `relPath` can't write outside
 * the workspace it's meant to seed.
 *
 * If any download or write fails, the partially-populated temp directory is
 * removed before the error propagates — callers never need to `dispose()`
 * a workspace that failed to hydrate.
 */
export async function hydrate(files: SignedFile[]): Promise<HydratedWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vc-"));
  const dispose = async (): Promise<void> => {
    await fs.rm(root, { recursive: true, force: true });
  };

  try {
    for (const sub of WORKSPACE_SUBDIRS) {
      await fs.mkdir(path.join(root, sub), { recursive: true });
    }
    await ensureApexChartsAsset(root);

    await Promise.all(
      files.map(async (file) => {
        const { relPath } = normalizeCanvasPath(file.relPath, "read", "relPath");
        const absPath = path.join(root, relPath);
        const res = await fetch(file.getUrl);
        if (!res.ok) {
          throw new Error(
            `Failed to download "${file.relPath}": HTTP ${res.status} ${res.statusText}`,
          );
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, buf);
      }),
    );
  } catch (err) {
    await dispose();
    throw err;
  }

  return { root, dispose };
}

/**
 * Lists files under a hydrated workspace's `/output` directory — the
 * tracked-artifact convention `src/render/artifact-store` already uses.
 * `/cache` is deliberately not scanned; it's scratch space, same as today.
 *
 * `manifest.json` directly under `/output` is skipped: it's
 * `artifact-store`'s own bookkeeping file, not a render output, and the
 * Convex-backed `artifacts` table replaces it as the source of truth for
 * callers built against this helper (see PLAN.md section 4).
 *
 * @param since If given, only files with `mtimeMs >= since` are returned —
 *   for finding what a single render call produced, versus everything a
 *   workspace has ever accumulated. Filesystem mtime resolution is coarser
 *   than `Date.now()` on some platforms/filesystems, so a caller that reads
 *   `Date.now()` immediately before a write that lands in the same tick
 *   should treat `since` as approximate, not a strict linearizable cutoff.
 */
export async function collectOutputs(
  ws: HydratedWorkspace,
  since?: number,
): Promise<LocalArtifact[]> {
  const outputDir = path.join(ws.root, "output");

  let entries: string[];
  try {
    entries = await fs.readdir(outputDir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const artifacts: LocalArtifact[] = [];
  for (const entry of entries) {
    const posixRel = entry.split(path.sep).join("/");
    if (posixRel === "manifest.json") continue;

    const absolutePath = path.join(outputDir, entry);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) continue;
    if (since !== undefined && stat.mtimeMs < since) continue;

    artifacts.push({
      relPath: toDisplayPath(`output/${posixRel}`),
      absolutePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  return artifacts;
}
