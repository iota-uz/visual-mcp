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

describe("workspaces.create", () => {
  test("slugifies the name when no slug is given", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const result = await t.mutation(internal.workspaces.create, {
      name: "OSAGO Billing",
      createdBy,
    });
    expect(result.slug).toBe("osago-billing");
  });

  test("appends -2, -3 on slug collision", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);

    const first = await t.mutation(internal.workspaces.create, { name: "OSAGO", createdBy });
    const second = await t.mutation(internal.workspaces.create, { name: "OSAGO", createdBy });
    const third = await t.mutation(internal.workspaces.create, { name: "OSAGO", createdBy });

    expect(first.slug).toBe("osago");
    expect(second.slug).toBe("osago-2");
    expect(third.slug).toBe("osago-3");
  });

  test("an explicit slug still collides against existing slugs", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    await t.mutation(internal.workspaces.create, { name: "Anything", slug: "billing", createdBy });
    const second = await t.mutation(internal.workspaces.create, {
      name: "Something else",
      slug: "billing",
      createdBy,
    });
    expect(second.slug).toBe("billing-2");
  });
});

describe("workspaces.list", () => {
  test("excludes archived workspaces", async () => {
    const t = convexTest(schema, modules);
    const createdBy = await seedUser(t);
    const { workspaceId } = await t.mutation(internal.workspaces.create, {
      name: "Archived Me",
      createdBy,
    });
    await t.mutation(internal.workspaces.create, { name: "Visible", createdBy });
    await t.run((ctx) => ctx.db.patch(workspaceId, { archivedAt: Date.now() }));

    const list = await t.query(internal.workspaces.list, {});
    expect(list.map((w) => w.name)).toEqual(["Visible"]);
  });
});
