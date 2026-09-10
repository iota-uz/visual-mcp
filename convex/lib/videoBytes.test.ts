import { expect, test } from "vitest";
import { readBoundedBody } from "./videoBytes";

test("bounded reader rejects oversized stream despite lying content length", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "1" } },
  );
  await expect(readBoundedBody(response, 4)).rejects.toThrow("byte limit");
  expect(cancelled).toBe(true);
  expect(await readBoundedBody(new Response(new Uint8Array([1, 2])), 2)).toEqual(
    new Uint8Array([1, 2]),
  );
});
