/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const VALID_IDENTITY = { subject: "test-user|session-abc", issuer: "convex" };

test("searchMine ranks titles ahead of nodes and ignores blank queries", async () => {
  const t = convexTest(schema, modules);
  const asMember = t.withIdentity(VALID_IDENTITY);
  const createdBy = await t.run((ctx) =>
    ctx.db.insert("users", { email: "test@iota.uz", name: "Test", lastSeenAt: 0 }),
  );
  const { workspaceId } = await t.mutation(internal.workspaces.create, {
    name: "OSAGO",
    createdBy,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("videoProjects", {
      workspaceId,
      title: "Europrotocol reel",
      brief: JSON.stringify({ topic: "claims", direction: "calm" }),
      format: JSON.stringify({
        width: 1080,
        height: 1920,
        fps: { numerator: 30, denominator: 1 },
      }),
      revisionId: "rev",
      createdBy,
      updatedAt: Date.now(),
    });
  });

  expect(await asMember.query(api.search.searchMine, { query: "   " })).toEqual({
    workspaces: [],
    canvases: [],
    videos: [],
    nodes: [],
  });

  const found = await asMember.query(api.search.searchMine, { query: "europrotocol" });
  expect(found.videos[0]?.title).toBe("Europrotocol reel");

  const osago = await asMember.query(api.search.searchMine, { query: "osago" });
  expect(osago.workspaces[0]?.name).toBe("OSAGO");
});
