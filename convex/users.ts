/**
 * Public entry points for the SPA's own identity (PLAN.md Part 1 section 7).
 * Every function here is gated by `requireIotaIdentity` — there is no other
 * check standing between these and the public internet.
 */

import { mutation, query } from "./_generated/server";
import { getOrCreateUserId, requireIotaIdentity } from "./lib/auth";

// Called once by the SPA right after sign-in, before any other Convex call
// that depends on a `users` row existing. Idempotent — safe to call on
// every page load.
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await getOrCreateUserId(ctx, identity);
    await ctx.db.patch(userId, { lastSeenAt: Date.now() });
    return userId;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIotaIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_googleSub", (q) => q.eq("googleSub", identity.subject))
      .unique();
    if (!user) {
      // Signed in with a valid @iota.uz token but ensureUser hasn't run yet
      // (e.g. token refreshed in a second tab before the first tab's mutation
      // landed) — the SPA should call ensureUser and retry, not treat this
      // as an error.
      return null;
    }
    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      pictureUrl: user.pictureUrl,
    };
  },
});
