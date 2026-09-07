import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  describeExportWarnings,
  type ExportResult,
  exportAllPagesPdf,
  exportNode,
  exportPage,
} from "./export";

const downloadUrl = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./download", () => ({ downloadUrl }));

const canvasId = "canvas-1" as Id<"canvases">;
const result: ExportResult = {
  status: "ok",
  url: "https://storage.test/file",
  filename: "flow-overview.png",
  mimeType: "image/png",
  warnings: [],
  cached: false,
};

describe("export helpers", () => {
  beforeEach(() => downloadUrl.mockClear());

  it("exportNode asks for a framed PNG of one node and downloads it", async () => {
    const request = vi.fn(async () => result);
    await expect(
      exportNode(request, { canvasId, pageId: "overview", nodeId: "hero", scale: 2 }),
    ).resolves.toBe(result);
    expect(request).toHaveBeenCalledWith({
      canvasId,
      pageId: "overview",
      target: "node",
      nodeId: "hero",
      clip: "frame",
      scale: 2,
      format: "png",
    });
    expect(downloadUrl).toHaveBeenCalledWith(result.url, result.filename);
  });

  it("exportPage and exportAllPagesPdf target the canvas", async () => {
    const request = vi.fn(async () => result);
    await exportPage(request, { canvasId, pageId: "overview", format: "pdf" });
    expect(request).toHaveBeenLastCalledWith({
      canvasId,
      pageId: "overview",
      target: "canvas",
      clip: "frame",
      scale: 1,
      format: "pdf",
    });
    await exportAllPagesPdf(request, { canvasId });
    expect(request).toHaveBeenLastCalledWith({
      canvasId,
      target: "canvas",
      clip: "frame",
      scale: 1,
      format: "pdf",
    });
    expect(downloadUrl).toHaveBeenCalledTimes(2);
  });

  it("does not download when the request fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("render worker is not configured");
    });
    await expect(exportPage(request, { canvasId, pageId: "p", format: "png" })).rejects.toThrow(
      "render worker is not configured",
    );
    expect(downloadUrl).not.toHaveBeenCalled();
  });

  it("describes worker warnings in plain words", () => {
    expect(describeExportWarnings(result)).toBeNull();
    expect(
      describeExportWarnings({ ...result, warnings: ["iframe_not_ready", "custom_code"] }),
    ).toBe("Exported with warnings: a screen did not finish loading; custom_code.");
  });
});

describe("exportErrorMessage", () => {
  it("unwraps ConvexError data and trims the client's server-error wrapper", async () => {
    const { ConvexError } = await import("convex/values");
    const { exportErrorMessage } = await import("./export");
    expect(exportErrorMessage(new ConvexError("render worker is not configured"))).toBe(
      "render worker is not configured",
    );
    expect(
      exportErrorMessage(
        new Error(
          "[CONVEX A(exports:requestMine)] [Request ID: abc] Server Error Uncaught Error: render worker is not configured at snapshotWorkerOrigin (../../convex/lib/snapshotRender.ts:64:33) at handler",
        ),
      ),
    ).toBe("render worker is not configured");
    expect(exportErrorMessage(new Error("plain"))).toBe("plain");
    expect(exportErrorMessage("x")).toBe("Export failed");
  });
});
