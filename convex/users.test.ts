/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Convex Auth sessions", () => {
  async function seedUser(t: ReturnType<typeof convexTest>) {
    return await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "person@iota.uz",
        name: "Person",
        lastSeenAt: 0,
      }),
    );
  }

  test("rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.users.getCurrentUser, {})).rejects.toThrow(/not signed in/i);
  });

  test("rejects a raw provider identity instead of treating it as an app session", async () => {
    const t = convexTest(schema, modules);
    const rawGoogleIdentity = t.withIdentity({
      subject: "google-sub-123",
      issuer: "https://accounts.google.com",
      email: "person@iota.uz",
      emailVerified: true,
      hd: "iota.uz",
    });
    await expect(rawGoogleIdentity.query(api.users.getCurrentUser, {})).rejects.toThrow(
      /invalid convex auth session/i,
    );
  });

  test("resolves the user id embedded in a Convex Auth session", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const asSession = t.withIdentity({ subject: `${userId}|session-abc`, issuer: "convex" });

    await expect(asSession.query(api.users.getCurrentUser, {})).resolves.toMatchObject({
      userId,
      email: "person@iota.uz",
      name: "Person",
    });
  });

  test("rejects a session whose user row does not exist", async () => {
    const t = convexTest(schema, modules);
    const asBogus = t.withIdentity({ subject: "not-a-real-id|session-abc", issuer: "convex" });
    await expect(asBogus.query(api.users.getCurrentUser, {})).rejects.toThrow(/session user/i);
  });
});
