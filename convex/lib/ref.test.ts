import { describe, expect, test } from "vitest";
import { formatRef, parseRef, RefError } from "./ref";

describe("parseRef", () => {
  test("a bare string is a canvas id", () => {
    expect(parseRef("jn79rst16kdj6eezderzpw4cw98cezfq")).toEqual({
      form: "id",
      canvasId: "jn79rst16kdj6eezderzpw4cw98cezfq",
    });
  });

  test("one slash is workspace/canvas", () => {
    expect(parseRef("osago/fast-settlement")).toEqual({
      form: "slug",
      workspaceSlug: "osago",
      canvasSlug: "fast-settlement",
    });
  });

  test("surrounding whitespace is tolerated", () => {
    expect(parseRef("  osago/report \n")).toEqual({
      form: "slug",
      workspaceSlug: "osago",
      canvasSlug: "report",
    });
  });

  test("product URLs and canvas URIs normalize to canonical refs", () => {
    expect(parseRef("https://canvas.example/c/jn79rst16kdj6eezderzpw4cw98cezfq")).toEqual({
      form: "id",
      canvasId: "jn79rst16kdj6eezderzpw4cw98cezfq",
    });
    expect(parseRef("https://canvas.example/s/4qCYpublicslug?node=phone")).toEqual({
      form: "id",
      canvasId: "4qCYpublicslug",
    });
    expect(parseRef("canvas://osago/fast-settlement?node=phone-checkout")).toEqual({
      form: "slug",
      workspaceSlug: "osago",
      canvasSlug: "fast-settlement",
    });
  });

  test("rejects unrelated URLs instead of guessing", () => {
    expect(() => parseRef("https://canvas.example/w/osago")).toThrow(/\/c\/.*\/s\//);
  });

  test("a path-looking ref is rejected, and says where paths go", () => {
    // The mistake this catches: passing "osago/report/src/index.html",
    // conflating the ref with the file path. Guessing here would resolve the
    // wrong canvas and, on an upsert, overwrite it.
    expect(() => parseRef("osago/report/src/index.html")).toThrow(RefError);
    expect(() => parseRef("osago/report/src/index.html")).toThrow(/`path` argument/);
  });

  test("empty slug segments are rejected rather than silently collapsed", () => {
    expect(() => parseRef("osago/")).toThrow(RefError);
    expect(() => parseRef("/report")).toThrow(RefError);
  });

  test("empty and non-string refs are rejected with the accepted forms named", () => {
    expect(() => parseRef("")).toThrow(/workspace-slug\/canvas-slug/);
    expect(() => parseRef("   ")).toThrow(RefError);
    expect(() => parseRef(undefined)).toThrow(RefError);
    expect(() => parseRef(42)).toThrow(RefError);
  });

  test("the label appears in the message so errors read in the caller's terms", () => {
    expect(() => parseRef("", "ref")).toThrow(/^ref must be/);
  });
});

describe("formatRef", () => {
  test("round-trips through parseRef", () => {
    const ref = formatRef("osago", "fast-settlement");
    expect(ref).toBe("osago/fast-settlement");
    expect(parseRef(ref)).toEqual({
      form: "slug",
      workspaceSlug: "osago",
      canvasSlug: "fast-settlement",
    });
  });
});
