import { describe, expect, it } from "vitest";
import { assertSafeImportUrl, validateAssetBytes } from "./assetSecurity";

describe("asset security", () => {
  it("rejects non-HTTPS and private import targets", () => {
    expect(() => assertSafeImportUrl("http://example.com/a.png")).toThrow(/HTTPS/);
    expect(() => assertSafeImportUrl("https://127.0.0.1/a.png")).toThrow(/forbidden/);
    expect(() => assertSafeImportUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /forbidden/,
    );
    expect(() => assertSafeImportUrl("https://user:pass@example.com/a.png")).toThrow(/credentials/);
  });

  it("preserves trusted workspace SVG markup byte for byte", async () => {
    const authored = `<svg data-owner="iota"><style>.mark{fill:#2f6df6}</style><rect class="mark" width="10"/></svg>`;
    const bytes = new TextEncoder().encode(authored);
    const validated = await validateAssetBytes(bytes, "image/svg+xml");

    expect(validated.kind).toBe("svg");
    expect(validated.bytes).toEqual(bytes);
    expect(new TextDecoder().decode(validated.bytes)).toBe(authored);
  });

  it("sniffs PNG instead of trusting a mismatched extension", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const result = await validateAssetBytes(bytes, "application/octet-stream");
    expect(result.mimeType).toBe("image/png");
    expect(result.kind).toBe("image");
  });

  it("rejects audio now that it is outside the asset product", async () => {
    const bytes = new TextEncoder().encode("ID3 fixture");
    await expect(validateAssetBytes(bytes, "audio/mpeg")).rejects.toThrow(
      "Unsupported asset MIME type: audio/mpeg",
    );
  });
});
