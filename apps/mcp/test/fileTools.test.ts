import { describe, expect, it } from "vitest";
import { projectTextFile, searchText } from "../src/fileTools.js";

describe("projectTextFile", () => {
  it("projects bounded line ranges", () => {
    expect(projectTextFile("one\ntwo\nthree", { startLine: 2, endLine: 3 }, 1024)).toMatchObject({
      content: "two\nthree",
      encoding: "utf-8",
      range: { kind: "lines", start: 2, end: 3, total: 3 },
    });
  });

  it("encodes exact byte ranges as base64", () => {
    expect(projectTextFile("hello", { startByte: 1, endByte: 4 }, 1024)).toMatchObject({
      content: "ZWxs",
      encoding: "base64",
      range: { kind: "bytes", start: 1, end: 4, total: 5 },
    });
  });

  it("rejects an unbounded oversized response", () => {
    expect(() => projectTextFile("x".repeat(20), {}, 10)).toThrow("file_too_large");
  });
});

describe("searchText", () => {
  it("returns literal case-insensitive matches with context", () => {
    expect(
      searchText("first\nNeedle here\nthird", "needle", {
        caseSensitive: false,
        contextLines: 1,
        maxMatches: 10,
      }),
    ).toEqual([{ line: 2, column: 1, preview: "first\nNeedle here\nthird" }]);
  });
});
