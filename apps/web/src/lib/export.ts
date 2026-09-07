import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { downloadUrl } from "./download";

export type ExportFormat = "png" | "pdf";

/** The arguments `api.exports.requestMine` takes. */
export interface ExportRequestArgs {
  canvasId: Id<"canvases">;
  pageId?: string;
  target: "canvas" | "node";
  nodeId?: string;
  clip: "frame" | "content";
  scale: 1 | 2;
  format: ExportFormat;
}

export interface ExportResult {
  status: "ok" | "partial";
  url: string;
  filename: string;
  mimeType: "image/png" | "application/pdf";
  warnings: string[];
  cached: boolean;
}

/**
 * The server call, injected so these helpers stay hook-free: a component
 * passes `useAction(api.exports.requestMine)` and the helpers do the rest.
 */
export type RequestExport = (args: ExportRequestArgs) => Promise<ExportResult>;

async function exportAndDownload(request: RequestExport, args: ExportRequestArgs) {
  const result = await request(args);
  await downloadUrl(result.url, result.filename);
  return result;
}

/** One node as a PNG — the Download action beside a node's title. */
export function exportNode(
  request: RequestExport,
  input: {
    canvasId: Id<"canvases">;
    pageId: string;
    nodeId: string;
    scale?: 1 | 2;
    clip?: "frame" | "content";
  },
): Promise<ExportResult> {
  return exportAndDownload(request, {
    canvasId: input.canvasId,
    pageId: input.pageId,
    target: "node",
    nodeId: input.nodeId,
    clip: input.clip ?? "frame",
    scale: input.scale ?? 1,
    format: "png",
  });
}

/** The whole page, as a PNG or a one-page PDF. */
export function exportPage(
  request: RequestExport,
  input: { canvasId: Id<"canvases">; pageId: string; format: ExportFormat; scale?: 1 | 2 },
): Promise<ExportResult> {
  return exportAndDownload(request, {
    canvasId: input.canvasId,
    pageId: input.pageId,
    target: "canvas",
    clip: "frame",
    scale: input.scale ?? 1,
    format: input.format,
  });
}

/** Every page of the canvas, one PDF page each, in page order. */
export function exportAllPagesPdf(
  request: RequestExport,
  input: { canvasId: Id<"canvases">; scale?: 1 | 2 },
): Promise<ExportResult> {
  return exportAndDownload(request, {
    canvasId: input.canvasId,
    target: "canvas",
    clip: "frame",
    scale: input.scale ?? 1,
    format: "pdf",
  });
}

/** Human copy for the warning codes the worker reports. */
/**
 * A message a person can read. Application errors arrive as `ConvexError`
 * data; anything else is the Convex client's "[CONVEX A(...)] Server Error
 * Uncaught Error: …" wrapper, which is trimmed back to the sentence.
 */
export function exportErrorMessage(error: unknown, fallback = "Export failed"): string {
  if (error instanceof ConvexError) return typeof error.data === "string" ? error.data : fallback;
  if (!(error instanceof Error)) return fallback;
  const match = error.message.match(/Uncaught (?:Convex)?Error: ([^\n]*?)(?: at |$)/);
  return match?.[1]?.trim() || error.message;
}

export function describeExportWarnings(result: ExportResult): string | null {
  if (result.warnings.length === 0) return null;
  const copy: Record<string, string> = {
    iframe_not_ready: "a screen did not finish loading",
    unresolved_asset: "an image or asset could not be loaded",
    output_downscaled: "the image was downscaled to fit the size limit",
    content_overflow: "some content overflowed its frame",
  };
  const parts = result.warnings.map((code) => copy[code] ?? code);
  return `Exported with warnings: ${parts.join("; ")}.`;
}
