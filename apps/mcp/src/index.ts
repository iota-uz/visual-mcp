import { serve } from "@hono/node-server";
import {
  type AuthInfo,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { Id } from "../../../convex/_generated/dataModel.js";
import { AgentGateway } from "./gateway.js";
import { buildInstructions } from "./instructions.js";
import { sha256Hex } from "./lib/hash.js";
import { type McpPrincipal, registerResources, registerTools } from "./tools.js";

function principal(auth: AuthInfo | undefined): McpPrincipal {
  const extra = auth?.extra;
  if (!extra) throw new Error("Verified MCP principal is missing");
  return {
    userId: extra.userId as Id<"users">,
    tokenId: extra.tokenId as Id<"mcpTokens">,
    email: String(extra.email),
  };
}

export function createApp(gateway = new AgentGateway()) {
  const app = new Hono();
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      const verified = await gateway.authenticate(await sha256Hex(token));
      if (!verified)
        throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid, revoked, or expired token");
      return {
        token,
        clientId: verified.userId,
        scopes: ["mcp"],
        expiresAt: Math.floor(verified.expiresAt / 1000),
        extra: { userId: verified.userId, tokenId: verified.tokenId, email: verified.email },
      };
    },
  };

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.post("/mcp", async (c) => {
    const request = c.req.raw;
    const gate = requireBearerAuth({ verifier });
    const auth = await gate(request);
    if (auth instanceof Response) return auth;
    const message = (await request
      .clone()
      .json()
      .catch(() => null)) as { id?: unknown; method?: unknown } | null;
    if (message?.method === "subscriptions/listen") {
      return Response.json({
        jsonrpc: "2.0",
        id: message.id ?? null,
        error: { code: -32601, message: "MCP subscriptions are disabled" },
      });
    }
    const actionCtx = gateway.actionContext();
    const handler = createMcpHandler(
      (requestContext) => {
        const server = new McpServer(
          { name: "visual-canvas", version: "2.0.0" },
          { instructions: buildInstructions() },
        );
        registerTools(server, actionCtx, principal(requestContext.authInfo));
        registerResources(server, actionCtx);
        return server;
      },
      { maxSubscriptions: 0 },
    );
    return handler.fetch(request, { authInfo: auth });
  });
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: createApp().fetch, port, hostname: "0.0.0.0" }, () =>
    console.log(`Visual Canvas MCP listening on ${port}`),
  );
}
