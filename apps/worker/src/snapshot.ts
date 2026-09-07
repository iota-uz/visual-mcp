import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { snapshotCanvas } from "@visual-canvas/runtime/render/playwright-renderer/index.js";
import { resolveWorkspacePath } from "@visual-canvas/runtime/sandbox/path-guard.js";
import { hydrate } from "@visual-canvas/runtime/storage/workspace.js";
import { PDFDocument } from "pdf-lib";
import type { SnapshotRequest, SnapshotResponse } from "./schemas.js";
import { uploadBytes, uploadFile } from "./upload.js";

type Capture = Awaited<ReturnType<typeof snapshotCanvas>>;

async function capture(
  root: string,
  req: SnapshotRequest,
  entrypoint: string,
  outputRelPath: string,
): Promise<{ rendered: Capture; outputPath: string }> {
  const outputPath = resolveWorkspacePath(root, outputRelPath, "write");
  const rendered = await snapshotCanvas({
    entrypoint: resolveWorkspacePath(root, entrypoint, "read"),
    outputPath,
    target: req.target,
    clip: req.clip,
    padding: req.padding,
    scale: req.scale,
    readinessTimeoutMs: req.readinessTimeoutMs,
    workspaceRoot: root,
    themeTailwindCss: req.themeTailwindCss,
    themeRuntimeCss: req.themeRuntimeCss,
    themeJson: req.themeJson,
  });
  return { rendered, outputPath };
}

async function snapshotPng(root: string, req: SnapshotRequest): Promise<SnapshotResponse> {
  const { rendered, outputPath } = await capture(
    root,
    req,
    req.entrypoint,
    "/output/.snapshot.png",
  );
  const stats = await stat(outputPath);
  const contentHash = createHash("sha256")
    .update(await readFile(outputPath))
    .digest("hex");
  const upload = await uploadFile(req.upload.putUrl, outputPath, "image/png", req.upload.method);
  return {
    size: stats.size,
    width: rendered.width,
    height: rendered.height,
    mimeType: "image/png",
    pages: 1,
    contentHash,
    uploadStatus: upload.status,
    uploadBody: upload.body,
    unresolvedRefs: rendered.unresolvedRefs,
    unresolvedDetails: rendered.unresolvedDetails,
    readiness: rendered.readiness,
    downscaled: rendered.downscaled,
    contentOverflow: rendered.contentOverflow,
  };
}

/**
 * One raster capture per entrypoint, each placed on its own PDF page at the
 * capture's CSS-pixel size (1 px = 1 pt), so a 2× capture keeps its extra
 * resolution without changing the page geometry. Diagnostics are merged: a
 * document is "partial" if any of its pages was.
 */
async function snapshotPdf(root: string, req: SnapshotRequest): Promise<SnapshotResponse> {
  const entrypoints = req.entrypoints ?? [req.entrypoint];
  const scale = req.scale ?? 1;
  const pdf = await PDFDocument.create();
  const captures: Capture[] = [];
  for (const [index, entrypoint] of entrypoints.entries()) {
    const { rendered, outputPath } = await capture(
      root,
      req,
      entrypoint,
      `/output/.snapshot-${index}.png`,
    );
    const image = await pdf.embedPng(await readFile(outputPath));
    const width = image.width / scale;
    const height = image.height / scale;
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
    captures.push(rendered);
  }
  const bytes = await pdf.save();
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const upload = await uploadBytes(req.upload.putUrl, bytes, "application/pdf", req.upload.method);
  const first = captures[0];
  if (!first) throw new Error("snapshot produced no pages");
  const unresolvedDetails = captures.flatMap((rendered) => rendered.unresolvedDetails);
  return {
    size: bytes.byteLength,
    width: first.width,
    height: first.height,
    mimeType: "application/pdf",
    pages: captures.length,
    contentHash,
    uploadStatus: upload.status,
    uploadBody: upload.body,
    unresolvedRefs: [...new Set(captures.flatMap((rendered) => rendered.unresolvedRefs))],
    unresolvedDetails: unresolvedDetails.filter(
      (detail, index) => unresolvedDetails.findIndex((other) => other.ref === detail.ref) === index,
    ),
    readiness: {
      status: captures.every((rendered) => rendered.readiness.status === "ready")
        ? "ready"
        : "partial",
      warnings: [...new Set(captures.flatMap((rendered) => rendered.readiness.warnings))],
    },
    downscaled: captures.some((rendered) => rendered.downscaled),
    contentOverflow: captures.some((rendered) => rendered.contentOverflow),
  };
}

export async function handleSnapshot(req: SnapshotRequest): Promise<SnapshotResponse> {
  const ws = await hydrate(req.sources);
  try {
    return req.format === "pdf" ? await snapshotPdf(ws.root, req) : await snapshotPng(ws.root, req);
  } finally {
    await ws.dispose();
  }
}
