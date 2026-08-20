/**
 * Sign-in without Google, for a local deployment only.
 *
 * Why it exists: every authenticated surface in this app sits behind
 * Google's OAuth code flow restricted to `hd === "iota.uz"`, so an agent
 * (Claude Code, Codex) working headlessly could not reach a single one of
 * them — a human had to sit down and click through Google's consent screen
 * before any UI work could be looked at. See AGENTS.md, "Local stack".
 *
 * Why it is safe: the provider is only registered when `DEV_AUTH_SECRET` is
 * set on the deployment (../auth.ts), and it is set on nothing but the
 * local backend that `scripts/dev-agent.mjs` creates. This project's *live*
 * deployment is the dev one, so `import.meta.env.DEV`-style gating would
 * ship straight to production; a deployment environment variable is the one
 * gate that cannot. `convex/auth.test.ts` pins the provider list in both
 * states.
 *
 * Note what it does NOT do: it does not relax `ALLOWED_HOSTED_DOMAIN`, and
 * it does not bypass `createOrUpdateUser`. `createAccount` routes through
 * that callback exactly as the Google provider does, so the org check runs
 * on this profile too — it simply presents an `@iota.uz` identity that the
 * check then passes.
 */

import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import type { DataModel } from "../_generated/dataModel";
import { ALLOWED_HOSTED_DOMAIN } from "./auth";

/** The provider id the SPA passes to `signIn()`. */
export const DEV_PROVIDER_ID = "dev";

/** Whether this deployment is one where signing in without Google is allowed. */
export function devAuthSecret(): string | undefined {
  const secret = process.env.DEV_AUTH_SECRET;
  return secret && secret.length > 0 ? secret : undefined;
}

export function DevAuth() {
  return ConvexCredentials<DataModel>({
    id: DEV_PROVIDER_ID,
    /*
     * Returns a user id, not a profile — `ConvexCredentials` hands the id
     * straight to the session mint. The profile only reaches the database
     * through `createAccount`, which is what invokes `createOrUpdateUser`.
     */
    async authorize(credentials, ctx) {
      const secret = devAuthSecret();
      // Belt and braces: the provider should not be registered at all
      // without the secret, so reaching here means something is misconfigured.
      if (!secret) return null;

      const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
      const given = typeof credentials.secret === "string" ? credentials.secret : "";

      if (given !== secret) return null;
      if (!email.endsWith(`@${ALLOWED_HOSTED_DOMAIN}`)) return null;

      // `retrieveAccount` throws `InvalidAccountId` for an account that does
      // not exist yet — it does not return null — so "first sign-in" is a
      // caught exception rather than a falsy result.
      try {
        const existing = await retrieveAccount(ctx, {
          provider: DEV_PROVIDER_ID,
          account: { id: email },
        });
        if (existing) return { userId: existing.user._id };
      } catch {
        /* no account yet; fall through and create one */
      }

      const created = await createAccount(ctx, {
        provider: DEV_PROVIDER_ID,
        account: { id: email },
        // `hd` and `emailVerified` are not columns — they are the claims
        // `createOrUpdateUser` checks, passed through the same way the
        // Google provider passes them. The cast mirrors ../auth.ts.
        profile: {
          email,
          emailVerified: true,
          hd: ALLOWED_HOSTED_DOMAIN,
          name: email.split("@")[0],
          lastSeenAt: Date.now(),
        } as unknown as DataModel["users"]["document"],
      });
      return { userId: created.user._id };
    },
  });
}
