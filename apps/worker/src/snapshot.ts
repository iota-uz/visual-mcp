import { stat } from "node:fs/promises";
import { snapshotCanvas } from "@visual-canvas/runtime/render/playwright-renderer/index.js";
import { resolveWorkspacePath } from "@visual-canvas/runtime/sandbox/path-guard.js";
import { hydrate } from "@visual-canvas/runtime/storage/workspace.js";
import type { SnapshotRequest, SnapshotResponse } from "./schemas.js";
import { uploadFile } from "./upload.js";

export async function handleSnapshot(req: SnapshotRequest): Promise<SnapshotResponse> {
  const ws = await hydrate(req.sources);
  try {
    const entrypoint = resolveWorkspacePath(ws.root, req.entrypoint, "read");
    const outputPath = resolveWorkspacePath(ws.root, "/output/.snapshot.png", "write");
    const rendered = await snapshotCanvas({
      entrypoint,
      outputPath,
      target: req.target,
      padding: req.padding,
      scale: req.scale,
      workspaceRoot: ws.root,
    });
    const stats = await stat(outputPath);
    const upload = await uploadFile(req.upload.putUrl, outputPath, "image/png");
    return {
      size: stats.size,
      width: rendered.width,
      height: rendered.height,
      mimeType: "image/png",
      uploadStatus: upload.status,
      uploadBody: upload.body,
      unresolvedRefs: rendered.unresolvedRefs,
      readiness: rendered.readiness,
      downscaled: rendered.downscaled,
      contentOverflow: rendered.contentOverflow,
    };
  } finally {
    await ws.dispose();
  }
}
