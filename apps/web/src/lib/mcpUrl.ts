/*
 * Convex serves the upstream MCP HTTP action on `.convex.site`, not on the
 * client API domain (`.convex.cloud`) that `VITE_CONVEX_URL` points at.
 * Production exposes that action through the app origin's `/mcp` proxy;
 * local development still derives the direct upstream URL here. That logic
 * used to be inlined in Tokens.tsx
 * with the two rewrites in the wrong order: the `.convex.cloud$` replace
 * is `$`-anchored, so a `VITE_CONVEX_URL` carrying a trailing slash
 * ("https://x.convex.cloud/") never matched, and the snippet silently
 * pointed at the wrong domain. Strip the trailing slash FIRST, then swap
 * the domain — and keep it in one tested place, since both the tokens page
 * and the home "Connect" panel print it.
 */

/** Shown when `VITE_CONVEX_URL` is unset (local dev without an .env). */
const UNKNOWN_DEPLOYMENT = "<your-deployment>";

/** Env-var name Codex reads the bearer token from (it cannot inline one). */
export const CODEX_TOKEN_ENV_VAR = "VISUAL_CANVAS_MCP_TOKEN";

/** Origin of the MCP server: trailing slashes removed, `.cloud` -> `.site`. */
export function mcpBaseUrl(convexUrl: string | undefined | null): string {
  const trimmed = (convexUrl ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return UNKNOWN_DEPLOYMENT;
  const deployed = trimmed.replace(/\.convex\.cloud$/, ".convex.site");
  const url = new URL(deployed);
  // `convex dev --local` exposes the client API on 3210 and HTTP actions
  // (including MCP, public sources and iframe/image capabilities) on 3211.
  if (
    url.port === "3210" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]")
  ) {
    url.port = "3211";
    return url.origin;
  }
  return url.origin;
}

/** Direct Convex endpoint used by local development. */
export function mcpEndpointUrl(convexUrl: string | undefined | null): string {
  return `${mcpBaseUrl(convexUrl)}/mcp`;
}

/**
 * Production publishes MCP on the app's own origin. Local Vite development
 * still points straight at the local Convex HTTP-action port because the Vite
 * server does not run the production reverse proxy.
 */
export function currentMcpEndpointUrl(): string {
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return `${window.location.origin}/mcp`;
  }
  return mcpEndpointUrl(import.meta.env.VITE_CONVEX_URL as string | undefined);
}

/** Claude Code accepts the bearer token inline, so setup is a single command. */
export function claudeMcpCommand(endpointUrl: string, token: string): string {
  return `claude mcp add --transport http visual-canvas ${endpointUrl} \\\n  --header "Authorization: Bearer ${token}"`;
}

/**
 * Codex only accepts a bearer token by *reference* to an env var, so setup
 * is two steps: export the token, then register the server pointing at it.
 */
export function codexMcpCommand(endpointUrl: string, token: string): string {
  return [
    `export ${CODEX_TOKEN_ENV_VAR}=${token}`,
    `codex mcp add visual-canvas --url ${endpointUrl} --bearer-token-env-var ${CODEX_TOKEN_ENV_VAR}`,
  ].join("\n");
}
