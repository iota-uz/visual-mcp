/**
 * Tests for the `CanvasStorage` abstraction (PLAN.md section 5):
 * `DiskCanvasStorage` (src/storage/disk.ts) and the workspace helpers
 * `hydrate`/`collectOutputs` (src/storage/workspace.ts) that replace
 * `SESSIONS_ROOT` for the render worker.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DiskCanvasStorage } from "../src/storage/disk.js";
import { CanvasStorageNotFoundError } from "../src/storage/types.js";
import { hydrate, collectOutputs } from "../src/storage/workspace.js";
import { SandboxPathError } from "../src/paths/index.js";

async function makeStorageRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "visual-mcp-storage-test-"));
}

/* ------------------------------------------------------------------------
 * DiskCanvasStorage
 * ---------------------------------------------------------------------- */

test("putFile then getFile round-trips the exact bytes", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await storage.putFile("canvas_1", "/output/report.pdf", Buffer.from("pdf-bytes"), "application/pdf");

  const stream = await storage.getFile("canvas_1", "/output/report.pdf");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  assert.equal(Buffer.concat(chunks).toString(), "pdf-bytes");
});

test("getFile throws CanvasStorageNotFoundError for a missing object", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await assert.rejects(
    () => storage.getFile("canvas_1", "/output/missing.pdf"),
    CanvasStorageNotFoundError,
  );
});

test("putFile rejects a traversal relPath", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await assert.rejects(
    () => storage.putFile("canvas_1", "../../etc/passwd", Buffer.from("x"), "text/plain"),
    SandboxPathError,
  );
});

test("putFile rejects a traversal canvasId, so it cannot write outside rootDir", async () => {
  const root = await makeStorageRoot();
  const storage = new DiskCanvasStorage(root);
  await assert.rejects(() =>
    storage.putFile("../../evil", "/output/a.txt", Buffer.from("x"), "text/plain"),
  );
  // Nothing escaped upward: rootDir's parent gained no new entries.
  const parentEntries = await readdir(path.dirname(root));
  assert.ok(!parentEntries.includes("evil"));
});

test("downloadUrl rejects a storageId that decodes to a traversal canvasId", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  const forgedStorageId = Buffer.from(JSON.stringify(["../../evil", "output/a.txt"]), "utf8").toString(
    "base64url",
  );
  await assert.rejects(() => storage.downloadUrl(forgedStorageId), CanvasStorageNotFoundError);
});

test("deleteCanvas removes everything stored for that canvas only", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await storage.putFile("canvas_1", "/output/a.txt", Buffer.from("a"), "text/plain");
  await storage.putFile("canvas_2", "/output/b.txt", Buffer.from("b"), "text/plain");

  await storage.deleteCanvas("canvas_1");

  await assert.rejects(() => storage.getFile("canvas_1", "/output/a.txt"), CanvasStorageNotFoundError);
  const stream = await storage.getFile("canvas_2", "/output/b.txt");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  assert.equal(Buffer.concat(chunks).toString(), "b");
});

test("deleteCanvas on a canvas with nothing stored is not an error", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await storage.deleteCanvas("never_existed");
});

test("downloadUrl returns a data: URL fetch() can read back", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  const stored = await storage.putFile(
    "canvas_1",
    "/output/hello.txt",
    Buffer.from("hello world"),
    "text/plain",
  );

  const url = await storage.downloadUrl(stored.storageId);
  assert.ok(url.startsWith("data:text/plain;base64,"));

  const res = await fetch(url);
  assert.equal(await res.text(), "hello world");
});

test("downloadUrl throws CanvasStorageNotFoundError for an unrecognized storageId", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  await assert.rejects(() => storage.downloadUrl("not-a-real-id"), CanvasStorageNotFoundError);
});

test("uploadUrl returns a distinct opaque placeholder per call", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  const a = await storage.uploadUrl();
  const b = await storage.uploadUrl();
  assert.notEqual(a, b);
  assert.ok(a.startsWith("disk-upload://"));
});

/* ------------------------------------------------------------------------
 * hydrate / collectOutputs
 * ---------------------------------------------------------------------- */

test("hydrate creates the standard workspace subdirectories, ApexCharts vendored", async () => {
  const ws = await hydrate([]);
  try {
    for (const sub of ["src", "output", "assets", "templates", "cache"]) {
      const dirStat = await stat(path.join(ws.root, sub));
      assert.ok(dirStat.isDirectory());
    }
    const bundle = await stat(path.join(ws.root, "assets", "js", "apexcharts.min.js"));
    assert.ok(bundle.isFile());
  } finally {
    await ws.dispose();
  }
});

test("hydrate downloads every signed file to its relPath", async () => {
  const storage = new DiskCanvasStorage(await makeStorageRoot());
  const stored = await storage.putFile(
    "canvas_1",
    "/src/report.html",
    Buffer.from("<h1>hi</h1>"),
    "text/html",
  );
  const getUrl = await storage.downloadUrl(stored.storageId);

  const ws = await hydrate([{ relPath: "/src/report.html", getUrl }]);
  try {
    const content = await readFile(path.join(ws.root, "src", "report.html"), "utf8");
    assert.equal(content, "<h1>hi</h1>");
  } finally {
    await ws.dispose();
  }
});

async function vcTempDirsIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((e) => e.startsWith("vc-"));
}

test("hydrate rejects a traversal relPath and removes the temp dir it created", async () => {
  const before = await vcTempDirsIn(tmpdir());
  await assert.rejects(
    () => hydrate([{ relPath: "../../escape.txt", getUrl: "data:text/plain;base64,eA==" }]),
    SandboxPathError,
  );
  const after = await vcTempDirsIn(tmpdir());
  assert.deepEqual(after, before);
});

test("hydrate removes the temp dir it created when a download fails", async () => {
  const before = await vcTempDirsIn(tmpdir());
  await assert.rejects(() =>
    hydrate([{ relPath: "/src/a.txt", getUrl: "https://127.0.0.1:1/definitely-not-listening" }]),
  );
  const after = await vcTempDirsIn(tmpdir());
  assert.deepEqual(after, before);
});

test("dispose is safe to call more than once", async () => {
  const ws = await hydrate([]);
  await ws.dispose();
  await ws.dispose();
});

test("collectOutputs lists files under /output, recursively, excluding manifest.json", async () => {
  const ws = await hydrate([]);
  try {
    await mkdir(path.join(ws.root, "output", "nested"), { recursive: true });
    await writeFile(path.join(ws.root, "output", "report.pdf"), "pdf");
    await writeFile(path.join(ws.root, "output", "nested", "chart.svg"), "svg");
    await writeFile(path.join(ws.root, "output", "manifest.json"), "{}");
    await writeFile(path.join(ws.root, "cache", "scratch.svg"), "not an artifact");

    const artifacts = await collectOutputs(ws);
    const relPaths = artifacts.map((a) => a.relPath).sort();
    assert.deepEqual(relPaths, ["/output/nested/chart.svg", "/output/report.pdf"]);
  } finally {
    await ws.dispose();
  }
});

test("collectOutputs on a workspace with no /output directory returns an empty list", async () => {
  const ws = await mkdtemp(path.join(tmpdir(), "visual-mcp-storage-test-")).then((root) => ({
    root,
    dispose: async () => rm(root, { recursive: true, force: true }),
  }));
  try {
    assert.deepEqual(await collectOutputs(ws), []);
  } finally {
    await ws.dispose();
  }
});

test("collectOutputs honors `since`, excluding files older than the cutoff", async () => {
  const ws = await hydrate([]);
  try {
    const oldFile = path.join(ws.root, "output", "old.txt");
    const newFile = path.join(ws.root, "output", "new.txt");
    await writeFile(oldFile, "old");
    await writeFile(newFile, "new");

    const oldTime = new Date(Date.now() - 60_000);
    await utimes(oldFile, oldTime, oldTime);

    const cutoff = Date.now() - 30_000;
    const artifacts = await collectOutputs(ws, cutoff);
    assert.deepEqual(
      artifacts.map((a) => a.relPath),
      ["/output/new.txt"],
    );
  } finally {
    await ws.dispose();
  }
});
