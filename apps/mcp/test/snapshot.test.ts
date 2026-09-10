import { expect, test, vi } from "vitest";
import { pageResult, snapshotQuery } from "../src/video/registry.js";

test("snapshot freezes mutable rows, fences principal/filter and rejects missing handle", async () => {
  const rows = [{ state: "queued" }, { state: "running" }];
  const call = Object.assign(
    vi.fn(async () => ({ page: rows, isDone: true })),
    { snapshotPrincipal: "alice:token" },
  );
  const input = { workspace_id: "workspace", limit: 1 };
  const first = pageResult(
    await snapshotQuery(call, "listJobs", {}, input, "jobs"),
    (x) => x,
    input,
    "jobs",
  );
  rows[1] = { state: "succeeded" };
  const next = { ...input, cursor: first.next_cursor };
  const second = await snapshotQuery(call, "listJobs", {}, next, "jobs");
  expect(second.page).toEqual([{ state: "running" }]);
  expect(call).toHaveBeenCalledTimes(1);
  call.snapshotPrincipal = "bob:token";
  await expect(snapshotQuery(call, "listJobs", {}, next, "jobs")).rejects.toMatchObject({
    code: "SNAPSHOT_EXPIRED",
  });
  call.snapshotPrincipal = "alice:token";
  await expect(
    snapshotQuery(call, "listJobs", {}, { ...next, workspace_id: "other" }, "jobs"),
  ).rejects.toMatchObject({ code: "CURSOR_MISMATCH" });
  const envelope = JSON.parse(Buffer.from(first.next_cursor ?? "", "base64url").toString());
  const tampered = { ...envelope, cursor: envelope.cursor.replace(/:\d+$/, ":999999") };
  await expect(
    snapshotQuery(
      call,
      "listJobs",
      {},
      { ...input, cursor: Buffer.from(JSON.stringify(tampered)).toString("base64url") },
      "jobs",
    ),
  ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" });
  envelope.cursor = `${"0".repeat(64)}:1`;
  await expect(
    snapshotQuery(
      call,
      "listJobs",
      {},
      { ...input, cursor: Buffer.from(JSON.stringify(envelope)).toString("base64url") },
      "jobs",
    ),
  ).rejects.toMatchObject({ code: "SNAPSHOT_EXPIRED" });
});
test("oversized atomic collection fails with narrowing instead of live partial pages", async () => {
  const call = Object.assign(
    vi.fn(async () => ({ page: [], isDone: false })),
    { snapshotPrincipal: "alice" },
  );
  await expect(snapshotQuery(call, "listJobs", {}, { limit: 20 }, "jobs")).rejects.toMatchObject({
    code: "SNAPSHOT_TOO_LARGE",
  });
  expect(call).toHaveBeenCalledWith("listJobs", {
    paginationOpts: { numItems: 100, cursor: null, maximumBytesRead: 4194304 },
  });
});
