import { describe, expect, test } from "vitest";
import { renderEmbedCard } from "./embedCard";

describe("renderEmbedCard", () => {
  test("escapes user-authored labels and stays script-free", () => {
    const svg = renderEmbedCard({
      canvasTitle: "Flow & <script>alert(1)</script>",
      version: 2,
      targetKind: "node",
      targetLabel: 'Victim "screen"',
      targetDetail: "Browser > consent",
    });
    expect(svg).toContain("Flow &amp;");
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(svg).toContain("Victim &quot;screen&quot;");
    expect(svg).not.toContain("<script>");
  });
});
