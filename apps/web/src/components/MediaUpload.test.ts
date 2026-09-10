import { Blob as NodeBlob } from "node:buffer";
import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { hashUpload } from "./MediaUpload";

test("upload SHA256 streams bounded1MiB slices and matches actual bytes", async () => {
  const data = new Uint8Array(2 * 1024 * 1024 + 17).fill(73);
  const file = new NodeBlob([data]);
  const slice = vi.spyOn(file, "slice");
  const whole = vi.spyOn(file, "arrayBuffer");
  const progress = vi.fn();
  expect(await hashUpload(file as unknown as Blob, progress)).toBe(
    createHash("sha256").update(data).digest("hex"),
  );
  expect(whole).not.toHaveBeenCalled();
  expect(slice).toHaveBeenCalledTimes(3);
  expect(slice.mock.calls.every(([start, end]) => Number(end) - Number(start) <= 1024 * 1024)).toBe(
    true,
  );
  expect(progress).toHaveBeenLastCalledWith(1);
});
test("already cancelled hash never reads file", async () => {
  const file = new NodeBlob(["test"]);
  const slice = vi.spyOn(file, "slice");
  const controller = new AbortController();
  controller.abort();
  await expect(hashUpload(file as unknown as Blob, () => {}, controller.signal)).rejects.toThrow(
    "cancelled",
  );
  expect(slice).not.toHaveBeenCalled();
});
