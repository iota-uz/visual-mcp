/**
 * The worker's Hono app (PLAN.md sections 3, 5, 6) — split from index.ts so
 * tests can exercise routes via `app.request()` without binding a real port.
 *
 * `/render` and `/exec` hydrate a throwaway workspace
 * (`@visual-canvas/runtime`'s `hydrate()`), delegate to packages/runtime's
 * existing Playwright/D2/run_code pipelines, and upload results back via
 * pre-signed URLs the caller supplied — the worker itself never holds a
 * Convex credential (PLAN.md section 3's accepted-risk mitigation #3).
 *
 * `/compile-css` is NOT implemented here: `renderFile` already invokes
 * packages/runtime's Tailwind pipeline internally for any HTML entrypoint
 * with a `@import "tailwindcss"` block, so a dedicated endpoint is only
 * needed for canvas-node HTML with no single entrypoint file — that's C1
 * scope (PLAN.md section 9), once `put_canvas_doc` exists to call it.
 *
 * Every route but /healthz requires `Authorization: Bearer <WORKER_TOKEN>`
 * (PLAN.md section 3 / accepted risk #3) — the worker is reachable over the
 * public internet, and this is the only thing standing between that and an
 * open render/exec oracle.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { handleExec } from "./exec.js";
import { handleRender } from "./render.js";
import { ExecRequestSchema, RenderRequestSchema } from "./schemas.js";

export const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true }));

const requireWorkerToken: MiddlewareHandler = async (c, next) => {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) {
    return c.json({ error: "worker misconfigured: WORKER_TOKEN is not set" }, 500);
  }
  const auth = c.req.header("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || token !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

app.use("/render", requireWorkerToken);
app.use("/exec", requireWorkerToken);

app.post("/render", async (c) => {
  const parsed = RenderRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  try {
    const result = await handleRender(parsed.data);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/exec", async (c) => {
  const parsed = ExecRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  try {
    const result = await handleExec(parsed.data);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
