import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import sharp from "sharp";
import {
  executeMediaTransfer,
  handleMediaTransfer,
  MediaTransferError,
} from "../src/media-transfer.js";
import { acquireMediaCapacity } from "../src/video/capacity.js";

test("TrueType archive preserves bytes without registering executable font and rejects out-of-bounds tables", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const bytes = Buffer.alloc(28);
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(1, 4);
  bytes.write("name", 12);
  bytes.writeUInt32BE(28, 20);
  const server = createServer((_req, res) => res.end(bytes));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const request = {
      sourceUrl: `http://127.0.0.1:${address.port}/font`,
      declaredMimeType: "font/ttf",
      maxBytes: 28,
    };
    const result = await executeMediaTransfer(request);
    assert.equal(result.kind, "data");
    assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
    bytes.writeUInt32BE(1, 24);
    await assert.rejects(executeMediaTransfer(request), /bounds/);
  } finally {
    process.env.NODE_ENV = old;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("streaming media verification enforces hash, size and production network boundary", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const bytes = Buffer.from('{"verified":true}');
  const server = createServer((_req, res) => {
    res.setHeader("content-length", bytes.length);
    res.end(bytes);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  const input = {
    sourceUrl: `http://127.0.0.1:${address.port}/fixture`,
    declaredMimeType: "application/json",
    maxBytes: bytes.length,
    expectedSize: bytes.length,
    expectedSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    const result = await executeMediaTransfer(input);
    assert.equal(result.kind, "data");
    assert.equal(result.persisted, false);
    await assert.rejects(
      executeMediaTransfer({ ...input, expectedSha256: "f".repeat(64) }),
      /Checksum/,
    );
    await assert.rejects(executeMediaTransfer({ ...input, maxBytes: 1 }), /size/);
    process.env.NODE_ENV = "production";
    await assert.rejects(executeMediaTransfer(input), /HTTPS/);
  } finally {
    process.env.NODE_ENV = old;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("media shares admission with renderer and reports no-effect busy", async () => {
  const release = acquireMediaCapacity();
  assert(release);
  try {
    await assert.rejects(
      handleMediaTransfer({
        sourceUrl: "https://example.com/a",
        declaredMimeType: "video/mp4",
        maxBytes: 10,
      }),
      (e) =>
        e instanceof MediaTransferError && e.code === "WORKER_BUSY" && e.effect === "not_applied",
    );
  } finally {
    release();
  }
});
test("PNG mask inspection measures dimensions and actual editable alpha", async () => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const bytes = await sharp({
    create: { width: 2, height: 3, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const server = createServer((_req, res) => res.end(bytes));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const result = await executeMediaTransfer({
      sourceUrl: `http://127.0.0.1:${address.port}/mask`,
      declaredMimeType: "image/png",
      maxBytes: bytes.length,
    });
    assert.equal(result.kind, "image");
    if (result.kind === "image") {
      assert.equal(result.width, 2);
      assert.equal(result.height, 3);
      assert.equal(result.hasAlpha, true);
      assert.equal(result.alphaMin, 0);
    }
  } finally {
    process.env.NODE_ENV = old;
    await new Promise<void>((r) => server.close(() => r()));
  }
});
