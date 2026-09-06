import { describe, expect, test } from "vitest";
import { expandHtmlAuthoring, HtmlSchema, ScreensSchema } from "../src/htmlAuthoring.js";

describe("direct HTML authoring", () => {
  test("creates a viewable canvas from raw HTML with stable source and node IDs", () => {
    const html = "<main><h1>Привет</h1><script>window.ready = true;</script></main>";
    const result = expandHtmlAuthoring({
      html,
      title: "Demo",
      viewport: { width: 390, height: 844 },
    })!;
    expect(result.files).toEqual([{ path: "/src/screens/index.html", text: html }]);
    expect(result.doc.pages[0]?.doc.nodes[0]).toMatchObject({
      kind: "iframe",
      id: "index",
      caption: { title: "Demo" },
      source: { entrypoint: "/src/screens/index.html" },
      viewport: { width: 390, height: 844 },
      frame: { kind: "none" },
    });
    expect(
      expandHtmlAuthoring({ html, title: "Demo", viewport: { width: 390, height: 844 } }),
    ).toEqual(result);
  });

  test("stores a shared app shell once and selects each route without duplicating HTML", () => {
    const result = expandHtmlAuthoring({
      html: "<main>Shared app</main>",
      screens: [
        { id: "home", route: "#/home" },
        { id: "settings", route: "#/settings" },
        { id: "error", html: "<main>Error</main>" },
      ],
    })!;
    expect(result.files).toHaveLength(2);
    expect(
      result.doc.pages[0]?.doc.nodes.map((node) => node.kind === "iframe" && node.source),
    ).toEqual([
      { entrypoint: "/src/screens/index.html", route: "#/home" },
      { entrypoint: "/src/screens/index.html", route: "#/settings" },
      { entrypoint: "/src/screens/error.html" },
    ]);
  });

  test("lays out mixed viewports without overlap and within the world", () => {
    const result = expandHtmlAuthoring({
      screens: Array.from({ length: 7 }, (_, index) => ({
        id: `screen-${index}`,
        html: "<p>Screen</p>",
        viewport: { width: 300 + index * 100, height: 600 + index * 50 },
      })),
    })!;
    const doc = result.doc.pages[0]!.doc;
    for (const node of doc.nodes) {
      expect(node.rect.x + node.rect.w).toBeLessThanOrEqual(doc.world.width);
      expect(node.rect.y + node.rect.h).toBeLessThanOrEqual(doc.world.height);
      for (const other of doc.nodes.filter((candidate) => candidate !== node)) {
        expect(
          node.rect.x + node.rect.w <= other.rect.x ||
            other.rect.x + other.rect.w <= node.rect.x ||
            node.rect.y + node.rect.h <= other.rect.y ||
            other.rect.y + other.rect.h <= node.rect.y,
        ).toBe(true);
      }
    }
  });

  test.each([
    { html: "hello", doc: {} },
    { html: "hello", kind: "html" },
    { screens: [{ id: "home" }] },
    { html: " " },
    {
      screens: [
        { id: "home", html: "a" },
        { id: "home", html: "b" },
      ],
    },
    { html: "shared", screens: [{ id: "a" }, { id: "index", html: "other" }] },
    { html: "a", files: [{ path: "/src/screens/index.html" }] },
  ])("rejects ambiguous or invalid shorthand before any write: %j", (input) => {
    expect(() => expandHtmlAuthoring(input)).toThrow(/invalid_input/);
  });

  test("keeps the advanced document/files workflow available", () => {
    expect(expandHtmlAuthoring({ doc: {}, files: [{ path: "/src/app.js" }] })).toBeNull();
  });

  test("bounds HTML and rejects unsafe IDs and nonlocal routes", () => {
    expect(HtmlSchema.safeParse("x".repeat(1_000_001)).success).toBe(false);
    expect(ScreensSchema.safeParse([{ id: "../a", html: "hello" }]).success).toBe(false);
    expect(
      ScreensSchema.safeParse([{ id: "a", route: "https://example.com", html: "hello" }]).success,
    ).toBe(false);
  });
});
