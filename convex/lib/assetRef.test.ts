import { describe, expect, it } from "vitest";
import { formatAssetRef, parseAssetRef } from "./assetRef";

describe("asset refs", () => {
  it("round-trips personal and workspace revisions", () => {
    expect(parseAssetRef("asset://personal/eai-logo@2")).toEqual({
      scope: "personal",
      slug: "eai-logo",
      revision: 2,
    });
    const ref = formatAssetRef({
      scope: "workspace",
      workspaceSlug: "osago",
      slug: "accident-1",
      revision: 3,
    });
    expect(ref).toBe("asset://workspace/osago/accident-1@3");
    expect(parseAssetRef(ref)).toEqual({
      scope: "workspace",
      workspaceSlug: "osago",
      slug: "accident-1",
      revision: 3,
    });
  });

  it("rejects traversal and malformed refs", () => {
    expect(() => parseAssetRef("asset://workspace/osago/../secret@1")).toThrow(/Invalid asset ref/);
  });
});
