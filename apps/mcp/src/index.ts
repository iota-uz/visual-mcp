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
import {
  type CapturedCanvasTool,
  type McpPrincipal,
  registerResources,
  registerTools,
} from "./tools.js";
import { attachCanvasCatalog, sharedCanvasTools } from "./video/canvas-catalog.js";
import { enableExecuteTools, registerExecuteCallback } from "./video/execute.js";
import { videoBackend } from "./video/gateway.js";
import type { DomainResource } from "./video/registry.js";
import { registerVideoTools, sharedMediaTools } from "./video/registry.js";
import { registerDomainResources } from "./video/resources.js";

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
  enableExecuteTools();
  const app = new Hono();
  registerExecuteCallback(app);
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

  app.get("/healthz", async (c) => {
    try {
      await gateway.assertVideoContract();
      return c.json({ status: "ok", video_backend_contract: 1 });
    } catch {
      return c.json({ status: "backend_unavailable", video_backend_contract: 1 }, 503);
    }
  });
  app.on("POST", ["/mcp", "/mcp/video"], async (c) => {
    const video = c.req.path === "/mcp/video";
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
          { name: video ? "visual-canvas-video" : "visual-canvas", version: "2.0.0" },
          {
            instructions: video
              ? "Video Studio: durable project and language-scoped documents, server media generation, pinned previews and bounded evaluation loops. Read IDs/revisions before patching. Checkpoints and critic passes are not human approval. Paid producers require explicit allowPaid; poll job_get and reconcile known receipts rather than resubmit unknown outcomes. Nested documents use the shared camelCase domain schema; top-level transport references use snake_case."
              : buildInstructions(),
          },
        );
        const actor = principal(requestContext.authInfo);
        const backend = videoBackend(gateway, actor);
        const resources: DomainResource[] = [];
        registerResources(server, actionCtx, (resource) => resources.push(resource));
        registerDomainResources(server, backend, resources);
        const captured: CapturedCanvasTool[] = [];
        registerTools(server, actionCtx, actor, {
          ...(video ? { names: sharedCanvasTools } : {}),
          capture: (tool) => captured.push(tool),
        });
        attachCanvasCatalog(backend, actionCtx, actor, captured, video ? "video" : "canvas");
        if (video) registerVideoTools(server, backend);
        else {
          registerVideoTools(server, backend, new Set([...sharedMediaTools, "execute"]));
        }
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
