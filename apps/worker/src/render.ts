import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderD2ToSvg } from "@visual-canvas/runtime/render/diagrams/index.js";
import { renderFile as renderFileWithPlaywright } from "@visual-canvas/runtime/render/playwright-renderer/index.js";
import { resolveWorkspacePath } from "@visual-canvas/runtime/sandbox/path-guard.js";
import { resolveRenderOutputPath } from "@visual-canvas/runtime/server/render-output-path.js";
import { hydrate } from "@visual-canvas/runtime/storage/workspace.js";
import sharp from "sharp";
import type { RenderRequest } from "./schemas.js";
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

export interface RenderResult {
  relPath: string;
  size: number;
  mimeType: string;
  uploadStatus: number;
  uploadBody: unknown;
  thumbnail?: { uploadStatus: number; uploadBody: unknown };
}

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
    const { absolutePath: absOutput } = resolveRenderOutputPath(ws.root, req.outputPath);

    if (isD2Entrypoint(req.entrypoint) && req.format === "svg") {
      const source = await readFile(absEntrypoint, "utf8");
      const svg = await renderD2ToSvg(source);
      await mkdir(path.dirname(absOutput), { recursive: true });
      await writeFile(absOutput, svg, "utf8");
    } else {
      await renderFileWithPlaywright({
        entrypoint: absEntrypoint,
        outputPath: absOutput,
        format: req.format,
        viewport: req.viewport,
        pdf: req.pdf,
        workspaceRoot: ws.root,
      });
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
      relPath: req.outputPath,
      size: stats.size,
      mimeType,
      uploadStatus: upload.status,
      uploadBody: upload.body,
      thumbnail,
    };
  } finally {
    await ws.dispose();
  }
}
