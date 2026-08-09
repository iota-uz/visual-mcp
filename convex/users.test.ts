/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const VALID_IDENTITY = {
  subject: "google-sub-123",
  issuer: "https://accounts.google.com",
  email: "person@iota.uz",
  emailVerified: true,
  name: "Person",
  hd: "iota.uz",
};

describe("requireIotaIdentity (via ensureUser/getCurrentUser)", () => {
  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.ensureUser, {})).rejects.toThrow(/not signed in/i);
  });

  test("rejects a valid Google token missing the hd claim entirely", async () => {
    const t = convexTest(schema, modules);
    const { hd: _hd, ...withoutHd } = VALID_IDENTITY;
    const asOutsider = t.withIdentity(withoutHd);
    await expect(asOutsider.mutation(api.users.ensureUser, {})).rejects.toThrow(/iota\.uz/i);
  });

  test("rejects hd from a different Workspace domain", async () => {
    const t = convexTest(schema, modules);
    const asOutsider = t.withIdentity({ ...VALID_IDENTITY, hd: "some-other-company.com" });
    await expect(asOutsider.mutation(api.users.ensureUser, {})).rejects.toThrow(/iota\.uz/i);
  });

  test("rejects email_verified: false even with the correct hd", async () => {
    const t = convexTest(schema, modules);
    const asUnverified = t.withIdentity({ ...VALID_IDENTITY, emailVerified: false });
    await expect(asUnverified.mutation(api.users.ensureUser, {})).rejects.toThrow(/verified/i);
  });

  test("accepts a genuine @iota.uz, email_verified identity", async () => {
    const t = convexTest(schema, modules);
    const asMember = t.withIdentity(VALID_IDENTITY);
    const userId = await asMember.mutation(api.users.ensureUser, {});
    expect(userId).not.toBeNull();

    const me = await asMember.query(api.users.getCurrentUser, {});
    expect(me?.email).toBe("person@iota.uz");
    expect(me?.userId).toBe(userId);
  });
});

describe("bootstrap-user reconciliation", () => {
  test("first sign-in adopts a pre-existing bootstrap:<email> row instead of creating a duplicate user", async () => {
    const t = convexTest(schema, modules);
    const bootstrapUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        googleSub: "bootstrap:person@iota.uz",
        email: "person@iota.uz",
        name: "Person (pre-signup)",
        lastSeenAt: 0,
      }),
    );
    // A token minted against the bootstrap row before the owner ever signed in.
    const tokenId = await t.run((ctx) =>
      ctx.db.insert("mcpTokens", {
        userId: bootstrapUserId,
        name: "CLI token",
        prefix: "abcd1234",
        tokenHash: "pre-existing-hash",
        expiresAt: Date.now() + 1000,
      }),
    );

    const asMember = t.withIdentity(VALID_IDENTITY);
    const resolvedUserId = await asMember.mutation(api.users.ensureUser, {});

    expect(resolvedUserId).toBe(bootstrapUserId);
    const patched = await t.run((ctx) => ctx.db.get(bootstrapUserId));
    expect(patched?.googleSub).toBe("google-sub-123");
    // The pre-existing token still resolves to the same user row.
    const tokenAfter = await t.run((ctx) => ctx.db.get(tokenId));
    expect(tokenAfter?.userId).toBe(bootstrapUserId);
  });

  test("ensureUser is idempotent — calling it twice does not create a second user", async () => {
    const t = convexTest(schema, modules);
    const asMember = t.withIdentity(VALID_IDENTITY);
    const first = await asMember.mutation(api.users.ensureUser, {});
    const second = await asMember.mutation(api.users.ensureUser, {});
    expect(second).toBe(first);
  });
});
