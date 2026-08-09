/**
 * Route-wiring tests for src/app.ts, exercised via Hono's `app.request()`
 * (no real port bound) — the WORKER_TOKEN bearer gate (PLAN.md section 3),
 * 400 on invalid bodies, and /healthz staying ungated.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { app } from "../src/app.js";

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

test("/exec without a bearer token is rejected", async () => {
  const res = await app.request("/exec", { method: "POST", body: "{}" });
  assert.equal(res.status, 401);
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
