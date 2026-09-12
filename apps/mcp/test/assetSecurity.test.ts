import { describe, expect, test } from "vitest";
import { ASSET_MIME_TYPES, sniffAssetMime, validateAssetBytes } from "../src/lib/assetSecurity.js";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("MCP Asset Library audio validation", () => {
  test.each(["audio/wav", "audio/x-wav", "audio/ogg"])("advertises %s", (mimeType) => {
    expect(ASSET_MIME_TYPES).toHaveProperty(mimeType, "audio");
  });

  test.each([
    ["RIFF\u0004\u0000\u0000\u0000WAVEfmt ", "audio/wav"],
    ["OggS\u0000\u0002fixture", "audio/ogg"],
  ])("recognizes imported audio bytes independently of the HTTP MIME", (body, mimeType) => {
    expect(sniffAssetMime(bytes(body), "application/octet-stream")).toBe(mimeType);
  });

  test("keeps audio behind the worker-verified persistence path", async () => {
    await expect(validateAssetBytes(bytes("OggS\u0000\u0002fixture"), "audio/ogg")).rejects.toThrow(
      "Audio requires worker verification",
    );
  });
});
