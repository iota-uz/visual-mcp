import { executeMediaTransfer } from "./media-transfer.js";

process.once("message", async (input: unknown) => {
  try {
    const result = await executeMediaTransfer(input);
    process.send?.({ ok: true, result });
  } catch {
    process.send?.({ ok: false });
  }
});
