import { describe, expect, it } from "vitest";
import { buildEmbedCardUrl, buildEmbedClickUrl, buildEmbedMarkdown } from "./embed";

const node = { kind: "node" as const, id: "victim/my id", label: "MyID" };

describe("public embed URLs", () => {
  it("builds a pinned node card and a focused existing share-view link", () => {
    expect(
      buildEmbedCardUrl({
        publicOrigin: "https://canvas-api.example",
        publicSlug: "public-1",
        target: node,
        version: 34,
      }),
    ).toBe(
      "https://canvas-api.example/s/public-1/_embed/card.svg?target=node&id=victim%2Fmy+id&version=34",
    );
    expect(
      buildEmbedClickUrl({
        appOrigin: "https://canvas.example",
        publicOrigin: "https://canvas-api.example",
        publicSlug: "public-1",
        target: node,
      }),
    ).toBe("https://canvas.example/s/public-1?node=victim%2Fmy+id");
  });

  it("links artifacts directly on the cookieless public origin", () => {
    expect(
      buildEmbedClickUrl({
        appOrigin: "https://canvas.example",
        publicOrigin: "https://canvas-api.example",
        publicSlug: "public-1",
        target: { kind: "artifact", id: "/output/report.pdf", label: "report.pdf" },
      }),
    ).toBe("https://canvas-api.example/s/public-1/output/report.pdf");
  });

  it("escapes Markdown alt text", () => {
    expect(
      buildEmbedMarkdown({
        alt: "Flow [v2]\nready",
        cardUrl: "https://image",
        clickUrl: "https://go",
      }),
    ).toBe("[![Flow [v2\\] ready](https://image)](https://go)");
  });
});
