import { executeMediaProcess, MediaProcessError } from "./process.js";

process.once("message", async (request: unknown) => {
  try {
    process.send?.({ result: await executeMediaProcess(request) });
  } catch (error) {
    process.send?.({
      error:
        error instanceof MediaProcessError
          ? {
              code: error.code,
              effect: error.effect,
              result: error.result,
              persisted: error.persisted,
            }
          : { code: "MEDIA_PROCESS_FAILED", effect: "not_applied" },
    });
  }
});
