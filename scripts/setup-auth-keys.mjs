#!/usr/bin/env node
/**
 * Generates the RS256 key pair Convex Auth signs session JWTs with, and sets
 * it on the Convex deployment as JWT_PRIVATE_KEY + JWKS.
 *
 * Why not `npx @convex-dev/auth`: that CLI is the *interactive* scaffolder.
 * Besides the keys it prompts for SITE_URL, rewrites tsconfig.json's
 * moduleResolution, and offers to (re)write convex/auth.ts, auth.config.ts
 * and http.ts — all of which this repo already has, hand-written. This script
 * does only the one step that cannot be done by hand, using the exact same
 * recipe (see @convex-dev/auth/src/cli/generateKeys.ts): PKCS#8 private key
 * with newlines flattened to spaces, and a JWKS of one `use: "sig"` key.
 *
 * The keys are printed nowhere. They go from memory straight into
 * `npx convex env set`, which stores them on the deployment.
 *
 * Usage: node scripts/setup-auth-keys.mjs            # the live deployment
 *        node scripts/setup-auth-keys.mjs --print   # emit instead of set
 *
 * No --prod. This project's live deployment is the *dev* one
 * (giddy-retriever-468) — see the deploy notes in README/AGENTS; the prod
 * deployment is dead, and keys set there would do nothing. Extra flags are
 * forwarded to `convex env set` if you ever do need another deployment.
 */

import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const argv = process.argv.slice(2);
const printOnly = argv.includes("--print");
// Everything else is forwarded verbatim, so --prod / --preview-name work.
const convexArgs = argv.filter((a) => a !== "--print");

// `extractable` is required from jose v5 on; without it exportPKCS8 throws.
const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const JWT_PRIVATE_KEY = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const JWKS = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] });

if (printOnly) {
  console.log(`JWT_PRIVATE_KEY=${JWT_PRIVATE_KEY}`);
  console.log(`JWKS=${JWKS}`);
  process.exit(0);
}

for (const [name, value] of [
  ["JWT_PRIVATE_KEY", JWT_PRIVATE_KEY],
  ["JWKS", JWKS],
]) {
  execFileSync("npx", ["convex", "env", "set", ...convexArgs, name, value], { stdio: "inherit" });
}

console.log("\nJWT_PRIVATE_KEY and JWKS are set. Still required before sign-in works:");
console.log("  npx convex env set AUTH_GOOGLE_ID     <client id>.apps.googleusercontent.com");
console.log("  npx convex env set AUTH_GOOGLE_SECRET <client secret>");
console.log("  npx convex env set SITE_URL           https://canvas.iota.uz");
console.log(
  "\nAnd in Google Cloud Console, on that OAuth client, register the redirect URI:\n" +
    "  https://giddy-retriever-468.convex.site/api/auth/callback/google",
);
