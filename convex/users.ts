/**
 * Public entry points for the SPA's own identity (PLAN.md Part 1 section 7).
 * Every function here is gated by `requireIotaIdentity` — there is no other
 * check standing between these and the public internet.
 */

import { query } from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await requireUserId(ctx, identity);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Session user not found");
    return {
      userId: user._id,
      email: user.email,
      name: user.name,
      pictureUrl: user.pictureUrl,
    };
  },
});
