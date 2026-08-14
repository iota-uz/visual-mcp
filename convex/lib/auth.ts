/**
 * Web-session identity for the SPA (PLAN.md Part 1 section 7).
 *
 * Two token shapes reach this file, and both are accepted while the
 * migration is in flight:
 *
 * 1. **Convex Auth** (../auth.ts) — the SPA signs in through Google's OAuth
 *    code flow, Convex Auth mints its own JWT and refreshes it silently from
 *    a rotating refresh token. `identity.subject` is `"<usersId>|<sessionId>"`
 *    and carries no Google claims at all, because the org check has already
 *    run once, at sign-in, inside `createOrUpdateUser`. A session that
 *    exists is a session that passed it.
 * 2. **Raw Google ID token** — the previous design, where the browser held a
 *    Google ID token in localStorage and Convex verified it against Google's
 *    JWKS. Those tokens live ~1h with no renewal path, which is why the
 *    design changed; they keep working here until the last one expires.
 *
 * The org restriction for path 2 lives ONLY here: `identity.hd` is a
 * client-controlled OAuth request hint everywhere else, but on a JWT that
 * already passed Convex's signature/issuer/audience check it is a verified
 * claim from Google itself. Every public query/mutation that should require
 * org membership MUST go through `requireIotaIdentity` — there is no gate
 * above this one (unlike the MCP bearer-token path, which is gated once in
 * http.ts before any tool runs).
 */

import type { GenericMutationCtx, GenericQueryCtx, UserIdentity } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";

export const ALLOWED_HOSTED_DOMAIN = "iota.uz";

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Convex Auth encodes both the user and the session in `subject`, joined by
 * a pipe. A Google `sub` is a digit string and can never contain one, so the
 * separator alone tells the two token shapes apart.
 */
function convexAuthUserIdFromSubject(subject: string): string | null {
  const [userId, sessionId] = subject.split("|");
  return userId && sessionId ? userId : null;
}

/**
 * Verifies the caller holds a session belonging to the `iota.uz` org.
 * Throws otherwise, so callers don't need to remember to check a return
 * value.
 */
export async function requireIotaIdentity(
  ctx: GenericQueryCtx<DataModel> | { auth: GenericQueryCtx<DataModel>["auth"] },
): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new UnauthorizedError("Not signed in.");
  }
  // Convex Auth session: the domain and email_verified checks ran at
  // sign-in, and no Google claims survive into this JWT to re-check.
  if (convexAuthUserIdFromSubject(identity.subject) !== null) {
    return identity;
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

/** The subset of a Google profile this app stores about a person. */
export interface GoogleUserProfile {
  googleSub: string;
  email: string;
  name?: string;
  pictureUrl?: string;
}

/**
 * Resolves the `users` row for a Google profile, creating it on first
 * sign-in. Reconciles against a pre-existing `bootstrap:<email>` row (minted
 * by scripts/mint-mcp-token.mjs before the owner ever signed in) by patching
 * its synthetic `googleSub` to the real one, so MCP tokens issued before A2
 * keep resolving to the same user.
 *
 * This is also what keeps the Convex Auth migration lossless: sign-in routes
 * through here, so an account that already existed under the ID-token design
 * is *found*, not recreated, and every workspace, canvas and MCP token that
 * points at its id stays attached.
 */
export async function getOrCreateUserIdForProfile(
  ctx: { db: GenericMutationCtx<DataModel>["db"] },
  profile: GoogleUserProfile,
): Promise<Id<"users">> {
  const { googleSub, email } = profile;

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
      name: profile.name ?? bootstrapRow.name,
      pictureUrl: profile.pictureUrl ?? bootstrapRow.pictureUrl,
      lastSeenAt: Date.now(),
    });
    return bootstrapRow._id;
  }

  return await ctx.db.insert("users", {
    googleSub,
    email,
    name: profile.name ?? email,
    pictureUrl: profile.pictureUrl,
    lastSeenAt: Date.now(),
  });
}

/**
 * Mutation-side identity → `users` row. Under Convex Auth the row already
 * exists (sign-in created it), so this is a lookup; under a legacy Google ID
 * token it may still be the first write for that account.
 */
export async function getOrCreateUserId(
  ctx: { db: GenericMutationCtx<DataModel>["db"] },
  identity: UserIdentity,
): Promise<Id<"users">> {
  const existing = await resolveUserId(ctx, identity);
  if (existing) return existing;

  return await getOrCreateUserIdForProfile(ctx, {
    googleSub: identity.subject,
    email: identity.email as string,
    name: identity.name as string | undefined,
    pictureUrl: identity.pictureUrl as string | undefined,
  });
}

/**
 * Read-only identity → `users` row, or null when the row does not exist yet.
 * Queries use this; they cannot create the row themselves.
 */
export async function resolveUserId(
  ctx: { db: GenericQueryCtx<DataModel>["db"] },
  identity: UserIdentity,
): Promise<Id<"users"> | null> {
  const authUserId = convexAuthUserIdFromSubject(identity.subject);
  if (authUserId !== null) {
    // Normalize rather than cast: a well-formed subject from a *different*
    // deployment would otherwise blow up inside `db.get`.
    const normalized = ctx.db.normalizeId("users", authUserId);
    return normalized ?? null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_googleSub", (q) => q.eq("googleSub", identity.subject))
    .unique();
  return user?._id ?? null;
}
