/**
 * Shared base62 random-id generation (PLAN.md Part 1 section 7 token
 * format, section 4 publicSlug format). Uses Web Crypto's
 * `crypto.getRandomValues`, available in Convex's default runtime — no
 * `node:crypto`, so this can run in both mutations and (if ever needed)
 * queries without `"use node"`.
 *
 * Mirrors scripts/mint-mcp-token.mjs's format exactly (`vct_<base62>`,
 * 160 random bits, 8-char display prefix after the `vct_`) so tokens minted
 * via the SPA and via the CLI script are indistinguishable to `tokens.verify`.
 */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

function randomBase62(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base62(bytes);
}

/** `vct_<base62(160 random bits)>` — matches scripts/mint-mcp-token.mjs. */
export function randomMcpToken(): string {
  return `vct_${randomBase62(20)}`;
}

/** First 12 chars (`vct_` + 8) — safe to display in a tokens list UI. */
export function tokenDisplayPrefix(token: string): string {
  return token.slice(0, 12);
}

/** 128-bit base62 — used for `canvases.publicSlug`. */
export function randomPublicSlug(): string {
  return randomBase62(16);
}
