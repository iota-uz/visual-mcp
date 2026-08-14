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

/** Smallest thing a page can reference that Chromium will actually fetch. */
const DOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>`;

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

test("handleRender: png + thumbnailUpload also uploads a downscaled thumbnail", async () => {
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
      viewport: { width: 1200, height: 800 },
      upload: { putUrl: uploadServer.putUrl("out.png") },
      thumbnailUpload: { putUrl: uploadServer.putUrl("thumb.png") },
    });

    assert.ok(result.thumbnail, "expected a thumbnail to be produced");
    assert.equal(result.thumbnail?.uploadStatus, 200);
    assert.equal(uploadServer.uploads.length, 2);
    const thumbBytes = uploadServer.uploads[1]?.bytes;
    // PNG magic bytes
    assert.deepEqual(thumbBytes?.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.ok(
      (thumbBytes?.length ?? Number.POSITIVE_INFINITY) <
        (uploadServer.uploads[0]?.bytes.length ?? 0),
      "thumbnail should be smaller than the full-size render",
    );
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: no thumbnailUpload means no thumbnail, even for png", async () => {
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
      upload: { putUrl: uploadServer.putUrl("out.png") },
    });

    assert.equal(result.thumbnail, undefined);
    assert.equal(uploadServer.uploads.length, 1);
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

test("handleRender: thumbnailUpload is ignored for non-png formats", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleRender({
      sources: [{ relPath: "/src/diagram.d2", getUrl: dataUrl("text/plain", "a -> b") }],
      entrypoint: "/src/diagram.d2",
      outputPath: "/output/diagram.svg",
      format: "svg",
      upload: { putUrl: uploadServer.putUrl("out.svg") },
      thumbnailUpload: { putUrl: uploadServer.putUrl("thumb.png") },
    });

    assert.equal(result.thumbnail, undefined);
    assert.equal(uploadServer.uploads.length, 1);
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: an HTML reference to a missing file lands in unresolvedRefs, render still succeeds", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleRender({
      sources: [
        {
          relPath: "/src/index.html",
          getUrl: dataUrl(
            "text/html",
            // Two flavours of the production failure: a relative <img>
            // src next to the entrypoint, and a CSS url() — plus a
            // duplicate of the first, which must not be reported twice.
            `<html><head><style>body{background:url("./myid-face-camera-v1.png")}</style></head>` +
              `<body><img src="./accident-1.jpg"><img src="./accident-1.jpg"></body></html>`,
          ),
        },
      ],
      entrypoint: "/src/index.html",
      outputPath: "/output/report.png",
      format: "png",
      viewport: { width: 200, height: 100 },
      upload: { putUrl: uploadServer.putUrl("out.png") },
    });

    assert.deepEqual(
      [...result.unresolvedRefs].sort(),
      ["/src/accident-1.jpg", "/src/myid-face-camera-v1.png"],
      "missing subresources should be reported as workspace-relative paths, de-duplicated",
    );
    // Non-fatal: the artifact was still produced and uploaded.
    assert.equal(result.uploadStatus, 200);
    assert.ok(result.size > 0);
    assert.equal(uploadServer.uploads.length, 1);
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: a render with every referenced file present returns an empty unresolvedRefs", async () => {
  const uploadServer = await startTestUploadServer();
  try {
    const result = await handleRender({
      sources: [
        {
          relPath: "/src/index.html",
          getUrl: dataUrl(
            "text/html",
            `<html><body><img src="/assets/dot.svg"><img src="./dot.svg"></body></html>`,
          ),
        },
        { relPath: "/assets/dot.svg", getUrl: dataUrl("image/svg+xml", DOT_SVG) },
        { relPath: "/src/dot.svg", getUrl: dataUrl("image/svg+xml", DOT_SVG) },
      ],
      entrypoint: "/src/index.html",
      outputPath: "/output/report.png",
      format: "png",
      viewport: { width: 200, height: 100 },
      upload: { putUrl: uploadServer.putUrl("out.png") },
    });

    assert.deepEqual(result.unresolvedRefs, []);
    assert.equal(result.uploadStatus, 200);
  } finally {
    await uploadServer.close();
  }
});

test("handleRender: a leading-slash-less outputPath comes back normalized", async () => {
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
      // Raw caller input: no leading slash, and a redundant "." segment.
      // Recording an artifact under this string makes it unservable by
      // /s/:slug and invisible to the /cache TTL cron.
      outputPath: "output/./x.png",
      format: "png",
      viewport: { width: 100, height: 100 },
      upload: { putUrl: uploadServer.putUrl("out.png") },
    });

    assert.equal(result.relPath, "/output/x.png");
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
