import { describe, expect, test } from "vitest";
import { claudeMcpCommand, codexMcpCommand, mcpBaseUrl, mcpEndpointUrl } from "./mcpUrl";

describe("mcpBaseUrl", () => {
  test("rewrites the client API domain to the HTTP-action domain", () => {
    expect(mcpBaseUrl("https://tidy-otter-42.convex.cloud")).toBe(
      "https://tidy-otter-42.convex.site",
    );
  });

  test("strips the trailing slash BEFORE rewriting the domain", () => {
    // Regression: the `.convex.cloud$` replace used to run first, so a
    // trailing slash defeated the anchor and left the wrong domain.
    expect(mcpBaseUrl("https://tidy-otter-42.convex.cloud/")).toBe(
      "https://tidy-otter-42.convex.site",
    );
    expect(mcpBaseUrl("https://tidy-otter-42.convex.cloud///")).toBe(
      "https://tidy-otter-42.convex.site",
    );
  });

  test("leaves a URL that is already on .convex.site alone", () => {
    expect(mcpBaseUrl("https://tidy-otter-42.convex.site")).toBe(
      "https://tidy-otter-42.convex.site",
    );
  });

  test("only rewrites .convex.cloud at the end of the host", () => {
    expect(mcpBaseUrl("https://self-hosted.example.com")).toBe("https://self-hosted.example.com");
    expect(mcpBaseUrl("https://convex.cloud.example.com")).toBe("https://convex.cloud.example.com");
  });

  test("falls back to a placeholder when the env var is missing or blank", () => {
    expect(mcpBaseUrl(undefined)).toBe("<your-deployment>");
    expect(mcpBaseUrl("")).toBe("<your-deployment>");
    expect(mcpBaseUrl("   ")).toBe("<your-deployment>");
  });
});

describe("mcpEndpointUrl", () => {
  test("appends exactly one /mcp path segment", () => {
    expect(mcpEndpointUrl("https://tidy-otter-42.convex.cloud/")).toBe(
      "https://tidy-otter-42.convex.site/mcp",
    );
  });
});

describe("client setup snippets", () => {
  const endpoint = "https://tidy-otter-42.convex.site/mcp";

  test("claude command inlines the bearer token in a header", () => {
    const command = claudeMcpCommand(endpoint, "vc_live_abc");
    expect(command).toContain("claude mcp add --transport http visual-canvas");
    expect(command).toContain(endpoint);
    expect(command).toContain('--header "Authorization: Bearer vc_live_abc"');
  });

  test("codex command references the token through an env var, in two steps", () => {
    const [exportLine, addLine] = codexMcpCommand(endpoint, "vc_live_abc").split("\n");
    expect(exportLine).toBe("export VISUAL_CANVAS_MCP_TOKEN=vc_live_abc");
    expect(addLine).toBe(
      `codex mcp add visual-canvas --url ${endpoint} --bearer-token-env-var VISUAL_CANVAS_MCP_TOKEN`,
    );
  });
});
