/**
 * Shared plumbing for everything that asks the render worker for a picture of
 * a canvas: public embed renders, and browser exports. Both stage the same
 * target-aware entry page, hand the worker the same signed sources, and read
 * the same result shape — so the contract lives here once instead of being
 * copied into every action that needs a PNG.
 */

import type { CanvasSnapshotTarget } from "@visual-canvas/canvas/snapshot-entry.js";
import { canvasSnapshotEntryHtml } from "@visual-canvas/canvas/snapshot-entry.js";
import { THEME_CSS } from "@visual-canvas/canvas/theme-css.js";
import type { CanvasDoc } from "@visual-canvas/canvas/types.js";
import {
  compileThemeToCssVariables,
  compileThemeToTailwindV4,
  type resolveTheme,
} from "@visual-canvas/runtime/render/themes/index.js";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { presignObject } from "./objectStore";

export type SnapshotSource = { relPath: string; getUrl: string };

export type SnapshotWorkerResult = {
  size: number;
  width: number;
  height: number;
  mimeType: "image/png" | "application/pdf";
  pages: number;
  contentHash: string;
  uploadStatus: number;
  uploadBody: unknown;
  unresolvedRefs: string[];
  unresolvedDetails: Array<{ ref: string; resourceType: string; reason: string; error?: string }>;
  readiness: { status: "ready" | "partial"; warnings: string[] };
  downscaled: boolean;
  contentOverflow: boolean;
};

export type SnapshotWorkerRequest = {
  sources: SnapshotSource[];
  entrypoint: string;
  entrypoints?: string[];
  format?: "png" | "pdf";
  target: CanvasSnapshotTarget;
  clip: "frame" | "content";
  padding: number;
  scale: 1 | 2;
  readinessTimeoutMs: number;
  upload: { putUrl: string; method?: "POST" | "PUT" };
  themeTailwindCss?: string;
  themeRuntimeCss?: string;
  themeJson?: string;
};

export const SNAPSHOT_READINESS_TIMEOUT_MS = 15_000;

/** The one message every surface shows when the worker is not wired up. */
export const WORKER_NOT_CONFIGURED = "render worker is not configured";

export function snapshotWorkerOrigin(): string {
  const rawUrl = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  // A ConvexError reaches the browser as clean data, not a stack dump.
  if (!rawUrl || !token) throw new ConvexError(WORKER_NOT_CONFIGURED);
  const origin = rawUrl.includes("://") ? rawUrl : `http://${rawUrl}:8080`;
  return origin.replace(/\/$/, "");
}

export async function callSnapshotWorker(
  body: SnapshotWorkerRequest,
): Promise<SnapshotWorkerResult> {
  const origin = snapshotWorkerOrigin();
  const token = process.env.WORKER_TOKEN as string;
  const response = await fetch(`${origin}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as SnapshotWorkerResult | null;
  if (!response.ok || !result) throw new Error(`snapshot worker failed (${response.status})`);
  if (result.uploadStatus < 200 || result.uploadStatus >= 300) {
    throw new Error(`snapshot upload failed (${result.uploadStatus})`);
  }
  return result;
}

/** Signed GET URLs for a canvas's files and bound assets, in the worker's `sources` shape. */
export async function resolveSnapshotSources(
  ctx: ActionCtx,
  context: {
    files: Array<{ relPath: string; storageId: Id<"_storage"> }>;
    assets: Array<{ relPath: string; objectKey: string }>;
  },
): Promise<SnapshotSource[]> {
  const resolvedFiles = await Promise.all(
    context.files.map(async (file) => {
      const getUrl = await ctx.storage.getUrl(file.storageId);
      return getUrl ? { relPath: file.relPath, getUrl } : null;
    }),
  );
  return [
    ...resolvedFiles.filter((source): source is SnapshotSource => source !== null),
    ...(await Promise.all(
      context.assets.map(async (asset) => ({
        relPath: asset.relPath,
        getUrl: await presignObject(asset.objectKey, "GET", 3600),
      })),
    )),
  ];
}

/**
 * A native canvas is rendered from a target-aware page staged just for this
 * capture: the eager `/src/__canvas.html` would load every sibling iframe
 * before the worker knew which node it was asked for. The caller deletes the
 * staged blob once the worker has fetched it.
 */
export async function stageSnapshotEntry(
  ctx: ActionCtx,
  input: {
    doc: CanvasDoc;
    cssStorageId?: Id<"_storage">;
    target: CanvasSnapshotTarget;
    relPath: string;
  },
): Promise<{ source: SnapshotSource; storageId: Id<"_storage"> }> {
  const cssBlob = input.cssStorageId ? await ctx.storage.get(input.cssStorageId) : null;
  const entry = canvasSnapshotEntryHtml(
    input.doc,
    cssBlob ? await cssBlob.text() : "",
    input.target,
    undefined,
    THEME_CSS,
  );
  const storageId = await ctx.storage.store(new Blob([entry], { type: "text/html" }));
  const getUrl = await ctx.storage.getUrl(storageId);
  if (!getUrl) {
    await ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("unable to stage canvas entrypoint");
  }
  return { source: { relPath: input.relPath, getUrl }, storageId };
}

export function snapshotThemePayload(theme: ReturnType<typeof resolveTheme>): {
  themeTailwindCss: string;
  themeRuntimeCss: string;
  themeJson: string;
} {
  return {
    themeTailwindCss: compileThemeToTailwindV4(theme),
    themeRuntimeCss: compileThemeToCssVariables(theme),
    themeJson: JSON.stringify(theme),
  };
}

/** The warning codes canvas_snapshot and exports both report; empty means a clean capture. */
export function snapshotWarnings(result: SnapshotWorkerResult): string[] {
  return [
    ...(result.readiness.status === "partial" ? ["iframe_not_ready"] : []),
    ...(result.unresolvedRefs.length > 0 ? ["unresolved_asset"] : []),
    ...(result.downscaled ? ["output_downscaled"] : []),
    ...(result.contentOverflow ? ["content_overflow"] : []),
  ];
}
