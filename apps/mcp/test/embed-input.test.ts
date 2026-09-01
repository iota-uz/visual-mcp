import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EmbedInputSchema } from "../src/tools.js";

describe("canvas_embed batch input", () => {
  it("accepts 30+ targets in one request and defaults to live unpinned URLs", () => {
    const targets = Array.from({ length: 31 }, (_, index) => ({
      page_id: "flow",
      target: { type: "node" as const, node_id: `screen-${index + 1}` },
      clip: "frame" as const,
      scale: 1 as const,
    }));
    const parsed = EmbedInputSchema.parse({ ref: "osago/flow", targets });
    expect(parsed.pin_version).toBe(false);
    expect(parsed.targets).toHaveLength(31);
  });

  it("caps one preparation batch at 50 targets", () => {
    const targets = Array.from({ length: 51 }, (_, index) => ({
      target: { type: "node" as const, node_id: `screen-${index + 1}` },
      clip: "frame" as const,
    }));
    expect(() => EmbedInputSchema.parse({ ref: "osago/flow", targets })).toThrow();
  });

  it("publishes the required nested targets contract in JSON Schema", () => {
    const schema = z.toJSONSchema(EmbedInputSchema);
    expect(schema.required).toContain("targets");
    expect(schema.properties?.targets).toMatchObject({
      type: "array",
      minItems: 1,
      maxItems: 50,
    });
    expect(schema.properties?.targets?.description).toContain("inside each targets[] item");
    expect(schema.additionalProperties).toBe(false);
  });
});
