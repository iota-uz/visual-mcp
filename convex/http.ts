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

// Stay under the httpAction response cap (20 MiB) with margin for headers —
// PLAN.md Part 1 section 8: above this, PNG/PDF redirect to a direct
// *.convex.cloud storage URL instead of streaming through this action.
const PUBLIC_ARTIFACT_INLINE_LIMIT = 18 * 1024 * 1024;

// Deliberately allows the Tailwind CDN and Google Fonts (PLAN.md Part 1
// section 8/10.2): the reference osago artifact this product exists to host
// loads both, and a stricter default-deny would render it unstyled.
// `frame-ancestors` widens to the SPA's own origin once SPA_ORIGIN is set
// (post Netlify deploy) — until then this equals "no embedding at all",
// which is the safe default, not a broken one.
function publicArtifactCsp(): string {
  const spaOrigin = process.env.SPA_ORIGIN;
  const frameAncestors = spaOrigin ? `'self' ${spaOrigin}` : "'self'";
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// `GET /s/:slug` and `/s/:slug/*` — anonymous, cookieless artifact serving
// (PLAN.md Part 1 section 8). Convex's httpRouter has no named-param
// syntax (see convex/server's RouteSpec: only exact `path` or
// `pathPrefix`), so the slug/relPath split happens by hand below.
http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const segments = url.pathname
      .slice("/s/".length)
      .split("/")
      .filter((s) => s.length > 0);
    const slug = segments[0];
    if (!slug) return new Response("Not found", { status: 404 });
    const relPath = segments.length > 1 ? `/${segments.slice(1).join("/")}` : undefined;

    const artifact = await ctx.runQuery(internal.canvases.resolvePublicArtifact, {
      publicSlug: slug,
      relPath,
    });
    if (!artifact) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "content-security-policy": publicArtifactCsp(),
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=60",
    });

    // An SVG is an active document — never served inline on a shared origin.
    if (artifact.type === "svg") {
      const filename = artifact.relPath.split("/").pop() ?? "artifact.svg";
      headers.set("content-disposition", `attachment; filename="${filename}"`);
    }

    const oversized = artifact.size > PUBLIC_ARTIFACT_INLINE_LIMIT;
    if (oversized && (artifact.type === "image" || artifact.type === "pdf")) {
      const directUrl = await ctx.storage.getUrl(artifact.storageId);
      if (!directUrl) return new Response("Not found", { status: 404 });
      return Response.redirect(directUrl, 302);
    }

    const blob = await ctx.storage.get(artifact.storageId);
    if (!blob) return new Response("Not found", { status: 404 });
    headers.set("content-type", artifact.mimeType);
    return new Response(blob, { status: 200, headers });
  }),
});

export default http;
