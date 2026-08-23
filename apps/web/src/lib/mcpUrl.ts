const UNKNOWN_ORIGIN = "<your-app-origin>";
export const CODEX_TOKEN_ENV_VAR = "VISUAL_CANVAS_MCP_TOKEN";

export function mcpEndpointUrl(appOrigin: string | undefined | null): string {
  const origin = (appOrigin ?? "").trim().replace(/\/+$/, "");
  return `${origin || UNKNOWN_ORIGIN}/mcp`;
}

export function currentMcpEndpointUrl(): string {
  if (import.meta.env.PROD && typeof window !== "undefined") {
    return mcpEndpointUrl(window.location.origin);
  }
  return mcpEndpointUrl(import.meta.env.VITE_MCP_URL as string | undefined);
}

export function claudeMcpCommand(endpointUrl: string, token: string): string {
  return `claude mcp add --transport http visual-canvas ${endpointUrl} \\\n+  --header "Authorization: Bearer ${token}"`;
}

export function codexMcpCommand(endpointUrl: string, token: string): string {
  return [
    `export ${CODEX_TOKEN_ENV_VAR}=${token}`,
    `codex mcp add visual-canvas --url ${endpointUrl} --bearer-token-env-var ${CODEX_TOKEN_ENV_VAR}`,
  ].join("\n");
}
