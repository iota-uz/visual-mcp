import { describe, expect, test } from "vitest";
import { claudeMcpCommand, codexMcpCommand, mcpEndpointUrl } from "./mcpUrl";

describe("mcpEndpointUrl", () => {
  test("uses the app origin and appends exactly one path segment", () => {
    expect(mcpEndpointUrl("https://canvas.iota.uz/")).toBe("https://canvas.iota.uz/mcp");
  });
  test("uses a clear placeholder when local origin is not configured", () => {
    expect(mcpEndpointUrl(undefined)).toBe("<your-app-origin>/mcp");
  });
});

describe("client setup snippets", () => {
  const endpoint = "https://canvas.iota.uz/mcp";
  test("Claude uses the canonical endpoint", () => {
    expect(claudeMcpCommand(endpoint, "vc_live_abc")).toContain(endpoint);
  });
  test("Codex references its bearer token through an environment variable", () => {
    expect(codexMcpCommand(endpoint, "vc_live_abc")).toContain(
      "--bearer-token-env-var VISUAL_CANVAS_MCP_TOKEN",
    );
  });
});
