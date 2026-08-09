/**
 * Web-session identity for the SPA (PLAN.md Part 1 section 7). Convex
 * verifies Google's ID token directly against Google's own JWKS (see
 * ../auth.config.ts) — no third-party auth library, no extra schema tables.
 *
 * The org restriction lives ONLY here: `identity.hd` is a client-controlled
 * OAuth request hint everywhere else, but on a JWT that already passed
 * Convex's signature/issuer/audience check it is a verified claim from
 * Google itself. `email_verified` is checked too — Google sets it `false`
 * for a small number of edge-case accounts. Every public query/mutation that
 * should require org membership MUST go through `requireIotaIdentity` —
 * there is no gate above this one (unlike the MCP bearer-token path, which
 * is gated once in http.ts before any tool runs).
 */

import type { GenericMutationCtx, GenericQueryCtx, UserIdentity } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

const ALLOWED_HOSTED_DOMAIN = "iota.uz";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Verifies the caller is signed in with a Google Workspace account on the
 * `iota.uz` domain, with `email_verified === true`. Throws otherwise, so
 * callers don't need to remember to check a return value.
 */
export async function requireIotaIdentity(
  ctx: GenericQueryCtx<DataModel> | { auth: GenericQueryCtx<DataModel>["auth"] },
): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthorizedError("Not signed in.");
  }
  if (identity.emailVerified !== true) {
    throw new UnauthorizedError("Google account email is not verified.");
  }
  if (identity.hd !== ALLOWED_HOSTED_DOMAIN) {
    throw new UnauthorizedError(`Account is not a member of ${ALLOWED_HOSTED_DOMAIN}.`);
  }
  if (typeof identity.email !== "string" || identity.email.length === 0) {
    throw new UnauthorizedError("Google identity is missing an email claim.");
  }
  return identity;
}

/**
 * Resolves the `users` row for a verified identity, creating it on first
 * sign-in. Reconciles against a pre-existing `bootstrap:<email>` row (minted
 * by scripts/mint-mcp-token.mjs before the owner ever signed in) by patching
 * its synthetic `googleSub` to the real one, so MCP tokens issued before A2
 * keep resolving to the same user.
 */
export async function getOrCreateUserId(
  ctx: { db: GenericMutationCtx<DataModel>["db"] },
  identity: UserIdentity,
): Promise<Id<"users">> {
  const googleSub = identity.subject;
  const email = identity.email as string;

  const byGoogleSub = await ctx.db
    .query("users")
    .withIndex("by_googleSub", (q) => q.eq("googleSub", googleSub))
    .unique();
  if (byGoogleSub) {
    return byGoogleSub._id;
  }

  const bootstrapRow = await ctx.db
    .query("users")
    .withIndex("by_googleSub", (q) => q.eq("googleSub", `bootstrap:${email}`))
    .unique();
  if (bootstrapRow) {
    await ctx.db.patch(bootstrapRow._id, {
      googleSub,
      name: (identity.name as string | undefined) ?? bootstrapRow.name,
      pictureUrl: (identity.pictureUrl as string | undefined) ?? bootstrapRow.pictureUrl,
      lastSeenAt: Date.now(),
    });
    return bootstrapRow._id;
  }

  return await ctx.db.insert("users", {
    googleSub,
    email,
    name: (identity.name as string | undefined) ?? email,
    pictureUrl: identity.pictureUrl as string | undefined,
    lastSeenAt: Date.now(),
  });
}
