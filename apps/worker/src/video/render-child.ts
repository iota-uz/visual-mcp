import { executeVideoRender, VideoWorkerError } from "./render.js";

process.once("message", async (request: unknown) => {
  try {
    const result = await executeVideoRender(request);
    process.send?.({ result });
  } catch (error) {
    const safe =
      error instanceof VideoWorkerError
        ? {
            code: error.code,
            message: error.message,
            effect: error.effect,
            result: error.result,
            persisted: error.persisted,
          }
        : { code: "RENDER_FAILED", message: "Video render failed", effect: "unknown" };
    process.send?.({ error: safe });
  }
});
