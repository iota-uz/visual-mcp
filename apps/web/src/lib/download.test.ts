import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadUrl } from "./download";

describe("downloadUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches the bytes and saves them under the server's filename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }), { status: 200 })),
    );
    const createObjectURL = vi.fn(() => "blob:canvas/export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    await downloadUrl("https://storage.test/blob", "flow-overview.png");

    expect(fetch).toHaveBeenCalledWith("https://storage.test/blob");
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe("flow-overview.png");
    expect(clicked[0]?.href).toBe("blob:canvas/export");
    // The anchor is a one-shot helper, not a leftover in the document.
    expect(document.body.contains(clicked[0] as Node)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:canvas/export");
  });

  it("surfaces a failed fetch instead of saving an error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    await expect(downloadUrl("https://storage.test/missing", "x.png")).rejects.toThrow(
      "Download failed (HTTP 404)",
    );
    expect(click).not.toHaveBeenCalled();
  });
});
