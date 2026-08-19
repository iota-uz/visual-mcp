import { describe, expect, it } from "vitest";
import { applyExactEdit, parseApplyPatch, prepareApplyPatch } from "./editEngine";

describe("applyExactEdit", () => {
  it("requires a unique exact match", () => {
    expect(applyExactEdit("a b c", { oldString: "b", newString: "B" })).toEqual({
      content: "a B c",
      replacements: 1,
    });
    expect(() => applyExactEdit("x x", { oldString: "x", newString: "y" })).toThrow(
      /ambiguous_match/,
    );
  });

  it("only replaces all when explicitly requested", () => {
    expect(applyExactEdit("x x", { oldString: "x", newString: "y", replaceAll: true })).toEqual({
      content: "y y",
      replacements: 2,
    });
  });
});

describe("apply patch", () => {
  it("parses add, update, move and delete operations", () => {
    const operations = parseApplyPatch(`*** Begin Patch
*** Add File: src/new.txt
+new
*** Update File: src/a.txt
*** Move to: src/b.txt
@@
-old
+changed
*** Delete File: src/gone.txt
*** End Patch`);
    expect(operations).toHaveLength(3);
  });

  it("prepares an exact multi-file patch", async () => {
    const files = new Map([
      ["/src/a.txt", { content: "before\nold\nafter\n", hash: "ha" }],
      ["/src/gone.txt", { content: "gone", hash: "hg" }],
    ]);
    const changes = await prepareApplyPatch(
      `*** Begin Patch
*** Update File: src/a.txt
@@
 before
-old
+new
 after
*** Delete File: src/gone.txt
*** End Patch`,
      async (path) => files.get(path) ?? null,
    );
    expect(changes).toEqual([
      { type: "write", path: "/src/a.txt", expectedHash: "ha", content: "before\nnew\nafter\n" },
      { type: "delete", path: "/src/gone.txt", expectedHash: "hg" },
    ]);
  });

  it("accepts the Codex end-of-file marker", () => {
    expect(
      parseApplyPatch(`*** Begin Patch
*** Update File: src/a.txt
@@
-old
+new
*** End of File
*** End Patch`),
    ).toHaveLength(1);
  });
});
