/** MCP bearer-token verification and the signed-in token management surface. */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireIotaIdentity, requireUserId } from "./lib/auth";
import { sha256Hex } from "./lib/hash";
import { randomMcpToken, tokenDisplayPrefix } from "./lib/tokenFormat";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

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

// Revocation is real because it's the only thing that clears verify()'s
// `row.revokedAt !== undefined` check — there's no separate "active" flag
// to keep in sync.
export const revoke = internalMutation({
  args: { tokenId: v.id("mcpTokens"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.userId !== args.userId) {
      throw new Error(`Unknown token: ${args.tokenId}`);
    }
    if (token.revokedAt === undefined) {
      await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
    }
  },
});

export const listForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((row) => ({
      tokenId: row._id,
      name: row.name,
      prefix: row.prefix,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
  },
});

// --- Public, SPA-facing (PLAN.md Part 1 section 7's `/settings/tokens`) ---
// Every function below derives the caller's user id from their verified
// Convex session identity — never from a client-supplied argument.

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await requireUserId(ctx, identity);
    const rows = await ctx.db
      .query("mcpTokens")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => ({
      tokenId: row._id,
      name: row.name,
      prefix: row.prefix,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    }));
  },
});

// Returns the plaintext token exactly once — the caller must display and
// discard it; only the hash is ever persisted or returned again.
export const mintMine = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await requireUserId(ctx, identity);

    const token = randomMcpToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = Date.now() + NINETY_DAYS_MS;
    const tokenId = await ctx.db.insert("mcpTokens", {
      userId,
      name: args.name,
      prefix: tokenDisplayPrefix(token),
      tokenHash,
      expiresAt,
    });

    return { tokenId, token, expiresAt };
  },
});

export const revokeMine = mutation({
  args: { tokenId: v.id("mcpTokens") },
  handler: async (ctx, args) => {
    const identity = await requireIotaIdentity(ctx);
    const userId = await requireUserId(ctx, identity);

    const token = await ctx.db.get(args.tokenId);
    if (!token || token.userId !== userId) {
      throw new Error(`Unknown token: ${args.tokenId}`);
    }
    if (token.revokedAt === undefined) {
      await ctx.db.patch(args.tokenId, { revokedAt: Date.now() });
    }
  },
});
