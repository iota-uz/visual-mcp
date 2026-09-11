/**
 * Route-wiring tests for src/app.ts, exercised via Hono's `app.request()`
 * (no real port bound) — the WORKER_TOKEN bearer gate (PLAN.md section 3),
 * 400 on invalid bodies, and /healthz staying ungated.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { app, videoWorkerFailureBody } from "../src/app.js";
import { VideoWorkerError } from "../src/video/render.js";

const ORIGINAL_TOKEN = process.env.WORKER_TOKEN;

before(() => {
  process.env.WORKER_TOKEN = "test-token";
});
after(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.WORKER_TOKEN;
  else process.env.WORKER_TOKEN = ORIGINAL_TOKEN;
});

test("/healthz requires no auth", async () => {
  const res = await app.request("/healthz");
  assert.equal(res.status, 200);
});

test("video persistence failures keep recovery metadata inside the typed error envelope", () => {
  const result = {
    jobId: "job",
    fence: 1,
    video: {
      sha256: "a".repeat(64),
      sizeBytes: 1,
      mimeType: "video/mp4" as const,
      width: 1080,
      height: 1920,
      durationMs: 1000,
      fps: { numerator: 30, denominator: 1 },
    },
    poster: {
      sha256: "b".repeat(64),
      sizeBytes: 1,
      mimeType: "image/png" as const,
      width: 1080,
      height: 1920,
    },
    captions: {
      sha256: "c".repeat(64),
      sizeBytes: 1,
      mimeType: "text/vtt" as const,
    },
    partial: false,
    checks: [],
  };
  const body = videoWorkerFailureBody(
    new VideoWorkerError(
      "RESULT_PERSISTENCE_FAILED",
      "Upload failed",
      "partial",
      result,
      ["video"],
      "RESULT_UPLOAD_FAILED",
    ),
  );
  assert.equal(body.error.result?.jobId, "job");
  assert.deepEqual(body.error.persisted, ["video"]);
  assert.equal(body.error.reasonCode, "RESULT_UPLOAD_FAILED");
  assert.equal("result" in body, false);
});

test("/render without a bearer token is rejected", async () => {
  const res = await app.request("/render", { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
});

test("/render with the wrong bearer token is rejected", async () => {
  const res = await app.request("/render", {
    method: "POST",
    headers: { authorization: "Bearer nope" },
    body: "{}",
  });
  assert.equal(res.status, 401);
});

test("/render with a valid token but invalid body returns 400", async () => {
  const res = await app.request("/render", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 400);
});

test("/snapshot is authenticated and validates its body", async () => {
  const unauthorized = await app.request("/snapshot", { method: "POST", body: "{}" });
  assert.equal(unauthorized.status, 401);
  const invalid = await app.request("/snapshot", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.status, 400);
});

test("/exec without a bearer token is rejected", async () => {
  const res = await app.request("/exec", { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
});

test("/compile-css without a bearer token is rejected", async () => {
  const res = await app.request("/compile-css", { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
});

test("/asset-import requires auth and validates its body", async () => {
  const unauthorized = await app.request("/asset-import", { method: "POST", body: "{}" });
  assert.equal(unauthorized.status, 401);
  const invalid = await app.request("/asset-import", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.status, 400);
});

test("/compile-css with a valid token and empty fragments returns 200 with empty css", async () => {
  const res = await app.request("/compile-css", {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ htmlFragments: [] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { css: string };
  assert.equal(body.css, "");
});

test("misconfigured worker (no WORKER_TOKEN set) fails closed with 500, not open", async () => {
  delete process.env.WORKER_TOKEN;
  try {
    const res = await app.request("/render", {
      method: "POST",
      headers: { authorization: "Bearer anything" },
      body: "{}",
    });
    assert.equal(res.status, 500);
  } finally {
    process.env.WORKER_TOKEN = "test-token";
  }
});
