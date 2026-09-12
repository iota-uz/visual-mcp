import { describe, expect, it } from "vitest";
import { assertSafeImportUrl, sniffAssetMime, validateAssetBytes } from "./assetSecurity";

const bytes = (value: string) => new TextEncoder().encode(value);

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
    const authoredBytes = bytes(authored);
    const validated = await validateAssetBytes(authoredBytes, "image/svg+xml");

    expect(validated.kind).toBe("svg");
    expect(validated.bytes).toEqual(authoredBytes);
    expect(new TextDecoder().decode(validated.bytes)).toBe(authored);
  });

  it("sniffs PNG instead of trusting a mismatched extension", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const result = await validateAssetBytes(pngBytes, "application/octet-stream");
    expect(result.mimeType).toBe("image/png");
    expect(result.kind).toBe("image");
  });

  it("recognizes WAV and OGG signatures when an import server sends a generic MIME", () => {
    expect(
      sniffAssetMime(bytes("RIFF\u0004\u0000\u0000\u0000WAVEfmt "), "application/octet-stream"),
    ).toBe("audio/wav");
    expect(sniffAssetMime(bytes("OggS\u0000\u0002fixture"), "application/octet-stream")).toBe(
      "audio/ogg",
    );
  });

  it("does not allow shallow audio validation to bypass worker verification", async () => {
    await expect(validateAssetBytes(bytes("ID3 fixture"), "audio/mpeg")).rejects.toThrow(
      "Audio requires worker verification",
    );
  });
});
