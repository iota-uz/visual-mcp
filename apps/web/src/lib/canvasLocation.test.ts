import type { CanvasFile } from "@visual-canvas/canvas";
import { describe, expect, test } from "vitest";
import { resolveRequestedCanvasPage, withCanvasNodeSelection } from "./canvasLocation";

const file = {
  version: 3,
  defaultPageId: "overview",
  pages: [
    { id: "overview", title: "Overview", order: 0, doc: { title: "Overview" } },
    {
      id: "product-architecture",
      title: "Architecture",
      order: 1,
      doc: { title: "Architecture" },
    },
  ],
  prototype: { interactions: [] },
} as unknown as CanvasFile;

describe("withCanvasNodeSelection", () => {
  test("preserves the focused Page while selecting and clearing a node", () => {
    const selected = withCanvasNodeSelection("?page=product-architecture&mode=prototype", "frame");
    expect(selected.get("page")).toBe("product-architecture");
    expect(selected.get("mode")).toBe("prototype");
    expect(selected.get("node")).toBe("frame");

    const cleared = withCanvasNodeSelection(selected, null);
    expect(cleared.get("page")).toBe("product-architecture");
    expect(cleared.get("mode")).toBe("prototype");
    expect(cleared.has("node")).toBe(false);
  });

  test("resolves an explicit Page without silently falling back to Overview", () => {
    expect(resolveRequestedCanvasPage(file, "product-architecture")?.id).toBe(
      "product-architecture",
    );
    expect(resolveRequestedCanvasPage(file, "deleted-page")).toBeNull();
    expect(resolveRequestedCanvasPage(file)?.id).toBe("overview");
  });
});
