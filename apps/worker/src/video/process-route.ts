import { MediaProcessRequest } from "@visual-canvas/video/operations";
import type { Hono, MiddlewareHandler } from "hono";
import { handleMediaProcess, MediaProcessError } from "./process.js";
export function registerMediaProcessRoute(app: Hono, auth: MiddlewareHandler) {
  app.post("/video/process", auth, async (c) => {
    const request = MediaProcessRequest.safeParse(await c.req.json().catch(() => null));
    if (!request.success)
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            effect: "not_applied",
            message:
              "Provide a typed media operation with exact signed input and output descriptors",
          },
        },
        400,
      );
    try {
      return c.json(await handleMediaProcess(request.data, c.req.raw.signal));
    } catch (error) {
      const known =
        error instanceof MediaProcessError
          ? error
          : new MediaProcessError("MEDIA_PROCESS_FAILED", "unknown");
      return c.json(
        {
          error: {
            code: known.code,
            effect: known.effect,
            message:
              known.code === "WORKER_BUSY"
                ? "A media operation already occupies the worker; retry this job later"
                : "Media operation did not finish; inspect its typed code and persistence receipt",
            ...(known.result ? { result: known.result, persisted: known.persisted } : {}),
          },
        },
        known.code === "WORKER_BUSY" ? 429 : 500,
      );
    }
  });
}
