/**
 * Tests for the worker's /render logic (src/render.ts), against a hydrated
 * throwaway workspace and a local HTTP double standing in for Convex's
 * pre-signed upload URLs (test-upload-server.ts).
 *
 * The D2 test exercises the shared module-level D2 worker (see
 * @visual-canvas/runtime's render/diagrams/index.ts), so this disposes it
 * in an `after()` hook so `node --test` can exit cleanly — same pattern as
 * packages/runtime/test/diagrams.test.ts.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { disposeD2Renderer } from "@visual-canvas/runtime/render/diagrams/index.js";
import { handleRender } from "../src/render.js";
import { startTestUploadServer } from "./test-upload-server.js";

after(async () => {
  await disposeD2Renderer();
});

function dataUrl(contentType: string, body: string): string {
  return `data:${contentType};base64,${Buffer.from(body).toString("base64")}`;
}

test("handleRender: HTML -> PNG uploads the rendered bytes", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleRender({
      sources: [
        {
          relPath: "/src/index.html",
          getUrl: dataUrl("text/html", "<html><body><h1>hi</h1></body></html>"),
        },
      ],
      entrypoint: "/src/index.html",
      outputPath: "/output/report.png",
      format: "png",
      viewport: { width: 200, height: 100 },
      upload: { putUrl: uploadServer.putUrl("out.png") },
    });

    assert.equal(result.relPath, "/output/report.png");
    assert.equal(result.mimeType, "image/png");
    assert.ok(result.size > 0);
    assert.equal(result.uploadStatus, 200);
    assert.equal(uploadServer.uploads.length, 1);
    assert.ok((uploadServer.uploads[0]?.bytes.length ?? 0) > 0);
    // PNG magic bytes
    assert.deepEqual(
      uploadServer.uploads[0]?.bytes.subarray(0, 4),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: D2 -> SVG uses the D2 renderer, not Playwright", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleRender({
      sources: [{ relPath: "/src/diagram.d2", getUrl: dataUrl("text/plain", "a -> b") }],
      entrypoint: "/src/diagram.d2",
      outputPath: "/output/diagram.svg",
      format: "svg",
      upload: { putUrl: uploadServer.putUrl("out.svg") },
    });

    assert.equal(result.mimeType, "image/svg+xml");
    assert.ok(result.size > 0);
    const uploaded = uploadServer.uploads[0]?.bytes.toString("utf8") ?? "";
    assert.ok(uploaded.includes("<svg"), "uploaded bytes should be SVG markup");
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: rejects an outputPath outside /output or /cache", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    await assert.rejects(
      handleRender({
        sources: [{ relPath: "/src/index.html", getUrl: dataUrl("text/html", "<html></html>") }],
        entrypoint: "/src/index.html",
        outputPath: "/src/escape.png",
        format: "png",
        upload: { putUrl: uploadServer.putUrl("out.png") },
      }),
    );
  } finally {
    await uploadServer.close();
  }
});
