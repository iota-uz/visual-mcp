/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedUser(t: ReturnType<typeof convexTest>): Promise<Id<"users">> {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      email: "test@iota.uz",
      name: "Test User",
      lastSeenAt: 0,
    }),
  );
}

async function seedToken(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{ tokenHash: string; expiresAt: number; revokedAt: number }> = {},
): Promise<Id<"mcpTokens">> {
  return t.run((ctx) =>
    ctx.db.insert("mcpTokens", {
      userId,
      name: "CLI token",
      prefix: "abcd1234",
      tokenHash: overrides.tokenHash ?? "hash-of-a-valid-token",
      expiresAt: overrides.expiresAt ?? Date.now() + 90 * 24 * 60 * 60 * 1000,
      revokedAt: overrides.revokedAt,
    }),
  );
}

describe("tokens.verify", () => {
  test("returns the principal for a valid, unexpired, unrevoked token", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    await seedToken(t, userId, { tokenHash: "good-hash" });

    const principal = await t.query(internal.tokens.verify, {
      tokenHash: "good-hash",
      now: Date.now(),
    });

    expect(principal).not.toBeNull();
    expect(principal?.userId).toBe(userId);
    expect(principal?.email).toBe("test@iota.uz");
  });

  test("returns null for an unknown token hash", async () => {
    const t = convexTest(schema, modules);
    const principal = await t.query(internal.tokens.verify, {
      tokenHash: "never-minted",
      now: Date.now(),
    });
    expect(principal).toBeNull();
  });

  test("returns null once expiresAt has passed", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const expiresAt = Date.now() + 1000;
    await seedToken(t, userId, { tokenHash: "expiring-hash", expiresAt });

    const stillValid = await t.query(internal.tokens.verify, {
      tokenHash: "expiring-hash",
      now: expiresAt - 1,
    });
    expect(stillValid).not.toBeNull();

    const expired = await t.query(internal.tokens.verify, {
      tokenHash: "expiring-hash",
      now: expiresAt,
    });
    expect(expired).toBeNull();
  });

  test("returns null for a revoked token", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const tokenId = await seedToken(t, userId, { tokenHash: "revoke-me" });

    await t.mutation(internal.tokens.revoke, { tokenId, userId });

    const principal = await t.query(internal.tokens.verify, {
      tokenHash: "revoke-me",
      now: Date.now(),
    });
    expect(principal).toBeNull();
  });
});

describe("tokens.revoke", () => {
  test("is idempotent — revoking an already-revoked token does not throw", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const tokenId = await seedToken(t, userId, { tokenHash: "twice" });

    await t.mutation(internal.tokens.revoke, { tokenId, userId });
    // Convex functions that return nothing surface as `null` to callers, not `undefined`.
    await expect(t.mutation(internal.tokens.revoke, { tokenId, userId })).resolves.toBeNull();
  });

  test("rejects revoking a token owned by a different user", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedUser(t);
    const tokenId = await seedToken(t, owner, { tokenHash: "owned" });

    const otherUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "other@iota.uz",
        name: "Other User",
        lastSeenAt: 0,
      }),
    );

    await expect(
      t.mutation(internal.tokens.revoke, { tokenId, userId: otherUserId }),
    ).rejects.toThrow();
  });
});

describe("tokens.listForUser", () => {
  test("returns only the calling user's tokens, without the hash", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const otherUserId = await seedUser(t);
    await seedToken(t, userId, { tokenHash: "mine" });
    await seedToken(t, otherUserId, { tokenHash: "not-mine" });

    const tokens = await t.query(internal.tokens.listForUser, { userId });

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.prefix).toBe("abcd1234");
    expect(tokens[0]).not.toHaveProperty("tokenHash");
  });
});
