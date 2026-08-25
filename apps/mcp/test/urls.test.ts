import { afterEach, describe, expect, it } from "vitest";
import { embedPngUrl, pngEmbedTargetUrl } from "../src/lib/urls.js";

const originalSpaOrigin = process.env.SPA_ORIGIN;

afterEach(() => {
  process.env.SPA_ORIGIN = originalSpaOrigin;
});

describe("public PNG embed URLs", () => {
  it("always uses the canvas.iota.uz product origin and is unpinned by default", () => {
    process.env.SPA_ORIGIN = "https://canvas.iota.uz";
    const url = embedPngUrl(
      "share",
      { type: "node", node_id: "c-rear" },
      { pageId: "flow", scale: 2, padding: 24 },
    );
    expect(url).toBe(
      "https://canvas.iota.uz/s/share/_embed/node/c-rear.png?page=flow&scale=2&padding=24",
    );
    expect(url).not.toContain("convex.site");
    expect(pngEmbedTargetUrl("share", { type: "node", node_id: "c-rear" }, "flow")).toBe(
      "https://canvas.iota.uz/s/share?page=flow&node=c-rear",
    );
  });

  it("adds v only for an explicitly pinned embed", () => {
    process.env.SPA_ORIGIN = "https://canvas.iota.uz";
    expect(embedPngUrl("share", { type: "canvas" }, { version: 6, scale: 2 })).toContain(
      "?v=6&scale=2",
    );
  });
});
