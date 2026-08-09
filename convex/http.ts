/**
 * `/mcp` — the real remote MCP endpoint (PLAN.md section 6), replacing the
 * A1.0 spike's single unauthenticated `echo` tool now that the spike is
 * proven (see git history: "A1.0 SPIKE RESOLVED").
 *
 * Two zod majors coexist in this bundle by design — see ./mcp/tools.ts's
 * header comment. This file only touches the v4 one, via
 * `@modelcontextprotocol/server`'s own auth helpers.
 *
 * Auth: `requireBearerAuth` (the framework-free, fetch-native counterpart of
 * the SDK's Express middleware — see that package's
 * dist/createMcpHandler-*.d.mts) gates every request before the JSON-RPC
 * body is ever parsed. The verifier hashes the raw token, looks up
 * `mcpTokens` by that hash (see ./tokens.ts), and rejects unknown/revoked/
 * expired tokens with a spec-correct 401 + `WWW-Authenticate` challenge —
 * `verifyBearerToken` also rejects any `AuthInfo` missing `expiresAt`, so a
 * verifier that forgets to set it fails closed, not open.
 *
 * Per-request factory: `createMcpHandler`'s factory runs once per HTTP
 * request (see McpServerFactory's doc comment) and receives the verified
 * `AuthInfo` via `McpRequestContext.authInfo` — the SDK's documented way to
 * build multi-tenant servers keyed off the caller's identity, so no
 * module-level session/principal state is needed.
 */

import {
  type AuthInfo,
  createMcpHandler,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { sha256Hex } from "./lib/hash";
import { type McpPrincipal, registerTools } from "./mcp/tools";

function principalFromAuthInfo(authInfo: AuthInfo | undefined): McpPrincipal {
  const extra = authInfo?.extra;
  if (!extra) {
    throw new Error("MCP request reached the tool factory without a verified principal");
  }
  return {
    userId: extra.userId as Id<"users">,
    tokenId: extra.tokenId as Id<"mcpTokens">,
    email: extra.email as string,
  };
}

function buildVerifier(ctx: ActionCtx): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      const tokenHash = await sha256Hex(token);
      const principal = await ctx.runQuery(internal.tokens.verify, { tokenHash, now: Date.now() });
      if (!principal) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "invalid, revoked, or expired token");
      }
      // Awaited — an unawaited action promise can be dropped once the
      // action returns, which would make lastUsedAt silently unreliable.
      await ctx.scheduler.runAfter(0, internal.tokens.touchLastUsed, {
        tokenId: principal.tokenId,
      });
      return {
        token,
        clientId: principal.userId,
        scopes: ["mcp"],
        expiresAt: Math.floor(principal.expiresAt / 1000),
        extra: { userId: principal.userId, tokenId: principal.tokenId, email: principal.email },
      };
    },
  };
}

const http = httpRouter();

http.route({
  path: "/mcp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const gate = requireBearerAuth({ verifier: buildVerifier(ctx) });
    const auth = await gate(request);
    if (auth instanceof Response) return auth;

    const mcpHandler = createMcpHandler((reqCtx) => {
      const server = new McpServer({ name: "visual-canvas", version: "0.1.0" });
      registerTools(server, ctx, principalFromAuthInfo(reqCtx.authInfo));
      return server;
    });

    return mcpHandler.fetch(request, { authInfo: auth });
  }),
});

export default http;
