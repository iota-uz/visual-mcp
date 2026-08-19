import { describe, expect, it } from "vitest";
import { assertSafeImportUrl, sanitizeSvg, validateAssetBytes } from "./assetSecurity";

describe("asset security", () => {
  it("rejects non-HTTPS and private import targets", () => {
    expect(() => assertSafeImportUrl("http://example.com/a.png")).toThrow(/HTTPS/);
    expect(() => assertSafeImportUrl("https://127.0.0.1/a.png")).toThrow(/forbidden/);
    expect(() => assertSafeImportUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /forbidden/,
    );
  });

  it("removes executable and external SVG content", () => {
    const sanitized = sanitizeSvg(
      `<svg onload="alert(1)"><script>alert(1)</script><image href="https://evil.test/a.png"/><rect width="10"/></svg>`,
    );
    expect(sanitized).not.toMatch(/script|onload|https:\/\/evil/);
    expect(sanitized).toMatch(/<rect/);
  });

  it("sniffs PNG instead of trusting a mismatched extension", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const result = await validateAssetBytes(bytes, "application/octet-stream");
    expect(result.mimeType).toBe("image/png");
    expect(result.kind).toBe("image");
  });
});
