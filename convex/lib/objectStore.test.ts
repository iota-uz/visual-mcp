import { describe, expect, it } from "vitest";
import { objectUrl } from "./objectStore";

const config = {
  endpoint: "https://storage.railway.app",
  bucket: "visual-canvas-delivery-abc",
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "auto",
  urlStyle: "virtual" as const,
};

describe("object store keys", () => {
  it("builds virtual-hosted immutable object URLs", () => {
    expect(objectUrl(config, "blobs/sha256/ab/hash value")).toBe(
      "https://visual-canvas-delivery-abc.storage.railway.app/blobs/sha256/ab/hash%20value",
    );
  });

  it("rejects traversal and absolute keys", () => {
    expect(() => objectUrl(config, "../secret")).toThrow(/Invalid object key/);
    expect(() => objectUrl(config, "/root")).toThrow(/Invalid object key/);
  });
});
