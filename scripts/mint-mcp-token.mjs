#!/usr/bin/env node
/**
 * Mints an MCP bearer token (PLAN.md section 7, milestone A1: "tokens
 * seeded by CLI (no UI yet)"). Generates the plaintext locally, hashes it,
 * and hands only the hash + an 8-char display prefix to Convex via
 * `npx convex run tokens:bootstrap` — the plaintext never reaches the
 * deployment, only this terminal.
 *
 * Usage: node scripts/mint-mcp-token.mjs <email> <name> [token-name]
 */

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE62[Number(value % 62n)] + out;
    value /= 62n;
  }
  return out;
}

const [email, name, tokenName = "cli"] = process.argv.slice(2);
if (!email || !name) {
  console.error("Usage: node scripts/mint-mcp-token.mjs <email> <name> [token-name]");
  process.exit(1);
}

const token = `vct_${base62(randomBytes(20))}`; // 160 random bits
const tokenHash = createHash("sha256").update(token).digest("hex");
const prefix = token.slice(0, 12);
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const expiresAt = Date.now() + NINETY_DAYS_MS;

const args = JSON.stringify({ email, name, tokenName, tokenPrefix: prefix, tokenHash, expiresAt });

execFileSync("npx", ["convex", "run", "tokens:bootstrap", args], { stdio: "inherit" });

console.log("\nMCP token (shown once — store it now):");
console.log(token);
console.log(`\nExpires: ${new Date(expiresAt).toISOString()}`);
console.log("\nConfigure with:");
console.log(
  `  claude mcp add --transport http visual-canvas <deployment>.convex.site/mcp --header "Authorization: Bearer ${token}"`,
);
