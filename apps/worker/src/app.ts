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
 * `/compile-css` (PLAN.md section 2) covers what `/render`'s inline
 * Tailwind step doesn't: canvas-node HTML has no single entrypoint file to
 * run that step against, since a CanvasDoc's nodes are HTML fragments in a
 * JSON payload, not files on disk — see ./compile-css.ts.
 *
 * Every route but /healthz requires `Authorization: Bearer <WORKER_TOKEN>`
 * (PLAN.md section 3 / accepted risk #3) — the worker is reachable over the
 * public internet, and this is the only thing standing between that and an
 * open render/exec oracle.
 */

import {
  VideoRenderFailure,
  VideoRenderRequest,
  VideoRenderStreamEvent,
} from "@visual-canvas/video/media";
import { Hono, type MiddlewareHandler } from "hono";
import { stream } from "hono/streaming";
import { handleAssetImport } from "./asset-import.js";
import { handleCompileCss } from "./compile-css.js";
import { handleExec } from "./exec.js";
import { registerExecuteRoute } from "./execute.js";
import { handleMediaTransfer, MediaTransferError, MediaTransferRequest } from "./media-transfer.js";
import { handleRender } from "./render.js";
import {
  AssetImportRequestSchema,
  CompileCssRequestSchema,
  ExecRequestSchema,
  RenderRequestSchema,
  SnapshotRequestSchema,
} from "./schemas.js";
import { handleSnapshot } from "./snapshot.js";
import { registerMediaProcessRoute } from "./video/process-route.js";
import { handleVideoRender, VideoWorkerError } from "./video/render.js";

export const app = new Hono();

export function videoWorkerFailureBody(error: VideoWorkerError) {
  return VideoRenderFailure.parse({
    error: {
      code: error.code,
      ...(error.reasonCode ? { reasonCode: error.reasonCode } : {}),
      message: error.message,
      effect: error.effect,
      ...(error.result ? { result: error.result, persisted: error.persisted ?? [] } : {}),
    },
  });
}

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
app.use("/compile-css", requireWorkerToken);
app.use("/asset-import", requireWorkerToken);
app.use("/snapshot", requireWorkerToken);
app.use("/video/render", requireWorkerToken);
registerExecuteRoute(app, requireWorkerToken);
registerMediaProcessRoute(app, requireWorkerToken);
app.use("/media/verify", requireWorkerToken);
app.use("/media/ingest", requireWorkerToken);
for (const route of ["/media/verify", "/media/ingest"] as const)
  app.post(route, async (c) => {
    const parsed = MediaTransferRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid media verification request",
            effect: "not_applied",
          },
        },
        400,
      );
    if (
      (route === "/media/verify" && parsed.data.destinationUrl) ||
      (route === "/media/ingest" && !parsed.data.destinationUrl)
    )
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Ingest requires destination; verify must not write",
            effect: "not_applied",
          },
        },
        400,
      );
    try {
      return c.json(await handleMediaTransfer(parsed.data, c.req.raw.signal));
    } catch (error) {
      if (error instanceof MediaTransferError && error.code === "WORKER_BUSY")
        return c.json(
          {
            error: {
              code: error.code,
              message: "Media worker busy; retry existing operation later",
              effect: error.effect,
            },
          },
          429,
        );
      return c.json(
        {
          error: {
            code: "MEDIA_VERIFICATION_FAILED",
            message: "Media transfer or inspection failed; inspect reserved object before retry",
            effect: route === "/media/ingest" ? "unknown" : "none",
          },
        },
        422,
      );
    }
  });

app.post("/video/render", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Expected JSON request",
          effect: "not_applied",
        },
      },
      400,
    );
  }
  const parsed = VideoRenderRequest.safeParse(body);
  if (!parsed.success)
    return c.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid video render request",
          effect: "not_applied",
        },
      },
      400,
    );
  if (c.req.header("accept")?.includes("application/x-ndjson")) {
    c.header("content-type", "application/x-ndjson");
    return stream(c, async (output) => {
      let writes = Promise.resolve();
      const send = async (event: unknown) => {
        const line = `${JSON.stringify(VideoRenderStreamEvent.parse(event))}\n`;
        writes = writes.then(async () => {
          await output.write(line);
        });
        await writes;
      };
      try {
        const result = await handleVideoRender(parsed.data, c.req.raw.signal, (progress) =>
          send({ type: "progress", progress }),
        );
        await send({ type: "result", result });
      } catch (error) {
        const failure =
          error instanceof VideoWorkerError
            ? videoWorkerFailureBody(error)
            : {
                error: {
                  code: "RENDER_FAILED",
                  message: "Video render failed",
                  effect: "unknown" as const,
                },
              };
        await send({ type: "error", error: failure.error });
      }
    });
  }
  try {
    return c.json(await handleVideoRender(parsed.data, c.req.raw.signal));
  } catch (error) {
    if (error instanceof VideoWorkerError)
      return c.json(videoWorkerFailureBody(error), error.code === "WORKER_BUSY" ? 429 : 500);
    return c.json(
      {
        error: {
          code: "RENDER_FAILED",
          message: "Video render failed",
          effect: "unknown",
        },
      },
      500,
    );
  }
});

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

app.post("/snapshot", async (c) => {
  const parsed = SnapshotRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  try {
    return c.json(await handleSnapshot(parsed.data));
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

app.post("/compile-css", async (c) => {
  const parsed = CompileCssRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  try {
    const result = await handleCompileCss(parsed.data);
    return c.json(result);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

app.post("/asset-import", async (c) => {
  const parsed = AssetImportRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  try {
    return c.json(await handleAssetImport(parsed.data));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
