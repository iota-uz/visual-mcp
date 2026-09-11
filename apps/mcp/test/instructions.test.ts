import { describe, expect, it } from "vitest";
import { buildInstructions } from "../src/instructions.js";

describe("lean MCP server instructions", () => {
  it("stays within the 900-token budget using a conservative character bound", () => {
    const instructions = buildInstructions();
    // English prose averages roughly four characters/token. A 3,200-char
    // ceiling leaves margin under 900 across the tokenizers used by clients.
    expect(instructions.length).toBeLessThanOrEqual(3_200);
  });

  it("keeps the mandatory workflow and production-quality contract always on", () => {
    const instructions = buildInstructions();
    expect(instructions).toMatch(/production-grade/i);
    expect(instructions).toMatch(/canvas_save/i);
    expect(instructions).toContain("canvas_save({ref,html})");
    expect(instructions).toContain("Do not stage generated HTML on local disk");
    expect(instructions).toMatch(/canvas_snapshot/i);
    expect(instructions).toMatch(/canvas_embed/i);
    expect(instructions).toMatch(/canvas\.iota\.uz/i);
    expect(instructions).toMatch(/correct defects, and snapshot again/i);
    expect(instructions).toMatch(/loading, empty, error, success/i);
    expect(instructions).toMatch(/internal instructions or metadata/i);
    expect(instructions).toMatch(/automatically becomes reusable workspace media/i);
    expect(instructions).toMatch(/\/src source and \/output artifacts remain canvas-local/i);
    expect(instructions).not.toMatch(/PLAN\.md/i);
  });
  it("routes both domains through shared resources and preserves video safeguards", () => {
    const instructions = buildInstructions();
    expect(instructions).toContain("video_project_get");
    expect(instructions).toContain("resource_find/resource_get");
    expect(instructions).toContain("explicit allowPaid");
    expect(instructions).toContain("never grant human approval");
    expect(instructions).toContain("never a new idempotency key");
    expect(instructions).not.toContain("Audio is unsupported");
  });
});
