/**
 * Render worker entrypoint (PLAN.md sections 3, 5, 6).
 *
 * A0.4 scope: infrastructure scaffold only — a Hono app that boots, listens,
 * and answers `/healthz`, packaged into the Dockerfile next to this file so
 * the base image (and its Playwright/Chromium version) can be provisioned
 * ahead of the logic that will use it.
 *
 * `/render`, `/exec`, and `/compile-css` — the credential-free endpoints
 * that hydrate a workspace (`@visual-canvas/runtime`'s `hydrate()`), delegate
 * to `packages/runtime`'s existing Playwright/D2/Tailwind/run_code
 * pipelines, and persist results back via `collectOutputs()` — are A1 work,
 * once this worker actually depends on `@visual-canvas/runtime` and on the
 * `WORKER_TOKEN` bearer check PLAN.md section 3 calls for.
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8080);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`visual-canvas worker listening on :${info.port}`);
});
