import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import { renderD2ToSvg } from "@visual-canvas/runtime/render/diagrams/index.js";
import { renderFile as renderFileWithPlaywright } from "@visual-canvas/runtime/render/playwright-renderer/index.js";
import { resolveWorkspacePath } from "@visual-canvas/runtime/sandbox/path-guard.js";
import { hydrate } from "@visual-canvas/runtime/storage/workspace.js";
import sharp from "sharp";
import type { RenderRequest, RenderResponse } from "./schemas.js";
import { uploadBytes, uploadFile } from "./upload.js";

const MIME_BY_FORMAT: Record<RenderRequest["format"], string> = {
  png: "image/png",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  html: "text/html",
};

function isD2Entrypoint(entrypoint: string): boolean {
  return entrypoint.toLowerCase().endsWith(".d2");
}

/** The response body shape — see `RenderResponseSchema` in ./schemas.ts. */
export type RenderResult = RenderResponse;

const THUMBNAIL_MAX_DIMENSION = 600;

/**
 * Mirrors packages/runtime's `render_file` tool handler (D2->SVG vs.
 * Playwright branch), but against a throwaway hydrated workspace instead of
 * a persistent session, and with no artifact-manifest bookkeeping — that's
 * Convex's `artifacts` table's job now, driven by this function's return
 * value (PLAN.md section 5).
 */
export async function handleRender(req: RenderRequest): Promise<RenderResult> {
  const ws = await hydrate(req.sources);
  try {
    const absEntrypoint = resolveWorkspacePath(ws.root, req.entrypoint, "read");
    // Normalize once, here, and keep BOTH forms: the absolute path to write
    // to, and the canonical `/output/x.png` display form to report back.
    // Echoing the caller's raw `outputPath` (as this used to) let
    // `"output/x.png"` register an artifact row keyed without a leading
    // slash — unservable by `/s/:slug`, unsweepable by the /cache TTL cron.
    const { relPath, displayPath } = normalizeCanvasPath(
      req.outputPath,
      "render-output",
      "output_path",
    );
    const absOutput = path.resolve(ws.root, relPath);

    // Only the Playwright branch can observe subresource loads; the D2
    // compiler resolves nothing external, so its list is empty by nature.
    let unresolvedRefs: string[] = [];
    let unresolvedDetails: RenderResult["unresolvedDetails"] = [];
    let readiness: RenderResult["readiness"] = { status: "ready", warnings: [] };

    if (isD2Entrypoint(req.entrypoint) && req.format === "svg") {
      const source = await readFile(absEntrypoint, "utf8");
      const svg = await renderD2ToSvg(source);
      await mkdir(path.dirname(absOutput), { recursive: true });
      await writeFile(absOutput, svg, "utf8");
    } else {
      const rendered = await renderFileWithPlaywright({
        entrypoint: absEntrypoint,
        route: req.route,
        outputPath: absOutput,
        format: req.format,
        viewport: req.viewport,
        pdf: req.pdf,
        workspaceRoot: ws.root,
      });
      unresolvedRefs = rendered.unresolvedRefs;
      unresolvedDetails = rendered.unresolvedDetails;
      readiness = rendered.readiness;
    }

    const stats = await stat(absOutput);
    const mimeType = MIME_BY_FORMAT[req.format];
    const upload = await uploadFile(req.upload.putUrl, absOutput, mimeType);

    let thumbnail: RenderResult["thumbnail"];
    if (req.format === "png" && req.thumbnailUpload) {
      // Downscaling the PNG we already produced, not a second Chromium
      // screenshot — zero extra browser cost (PLAN.md section 8).
      const thumbBytes = await sharp(absOutput)
        .resize({ width: THUMBNAIL_MAX_DIMENSION, height: THUMBNAIL_MAX_DIMENSION, fit: "inside" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const thumbUpload = await uploadBytes(req.thumbnailUpload.putUrl, thumbBytes, "image/png");
      thumbnail = { uploadStatus: thumbUpload.status, uploadBody: thumbUpload.body };
    }

    return {
      relPath: displayPath,
      size: stats.size,
      mimeType,
      uploadStatus: upload.status,
      uploadBody: upload.body,
      thumbnail,
      unresolvedRefs,
      unresolvedDetails,
      readiness,
    };
  } finally {
    await ws.dispose();
  }
}
