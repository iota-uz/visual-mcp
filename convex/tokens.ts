/**
 * MCP bearer-token verification and CLI-only seeding (PLAN.md section 7,
 * milestone A1: "tokens seeded by CLI (no UI yet)").
 *
 * The plaintext token never reaches Convex — see scripts/mint-mcp-token.mjs,
 * which generates it locally, hashes it, and calls `bootstrap` with only the
 * hash + an 8-char display prefix.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

export const verify = internalQuery({
  // `now` is passed in rather than read via Date.now() — queries must not
  // read the wall clock (Convex guidelines: results derived from it can go
  // stale without a rerun).
  args: { tokenHash: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("mcpTokens")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!row || row.revokedAt !== undefined || row.expiresAt <= args.now) {
      return null;
    }
    const user = await ctx.db.get(row.userId);
    if (!user) return null;
    return {
      userId: row.userId,
      tokenId: row._id,
      email: user.email,
      expiresAt: row.expiresAt,
    };
  },
});

export const touchLastUsed = internalMutation({
  args: { tokenId: v.id("mcpTokens") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.tokenId, { lastUsedAt: Date.now() });
  },
});

// Pre-A2 bootstrap: there is no real Google OAuth yet, so a seeded token's
// owner gets a synthetic `googleSub` keyed off email. A2's Convex Auth
// wiring will need to link this row to the real Google `sub` claim — a
// known, documented gap, not something to solve here.
export const bootstrap = internalMutation({
  args: {
    email: v.string(),
    name: v.string(),
    tokenName: v.string(),
    tokenPrefix: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const googleSub = `bootstrap:${args.email}`;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_googleSub", (q) => q.eq("googleSub", googleSub))
      .unique();

    let userId: Id<"users">;
    if (existingUser) {
      userId = existingUser._id;
    } else {
      userId = await ctx.db.insert("users", {
        googleSub,
        email: args.email,
        name: args.name,
        lastSeenAt: Date.now(),
      });
    }

    const tokenId = await ctx.db.insert("mcpTokens", {
      userId,
      name: args.tokenName,
      prefix: args.tokenPrefix,
      tokenHash: args.tokenHash,
      expiresAt: args.expiresAt,
    });

    return { userId, tokenId };
  },
});
