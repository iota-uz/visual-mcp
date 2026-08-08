import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCanvasPath,
  toDisplayPath,
  SandboxPathError,
  CANVAS_PATH_GUARD_SOURCE,
} from "../src/paths/index.js";
import { WORKER_SOURCE } from "../src/sandbox/worker-source.js";

test("normalizes a plain workspace-relative path", () => {
  const r = normalizeCanvasPath("src/report.html", "write");
  assert.equal(r.relPath, "src/report.html");
  assert.equal(r.displayPath, "/src/report.html");
  assert.equal(r.topDir, "src");
});

test("treats a leading slash as workspace-relative, not filesystem-absolute", () => {
  const withSlash = normalizeCanvasPath("/src/report.html", "write");
  const without = normalizeCanvasPath("src/report.html", "write");
  assert.deepEqual(withSlash, without);
});

test("collapses redundant separators and '.' segments", () => {
  assert.equal(normalizeCanvasPath("//src///./a//b.html", "write").relPath, "src/a/b.html");
});

test("resolves interior '..' segments without touching the filesystem", () => {
  assert.equal(normalizeCanvasPath("/src/sub/../report.html", "write").relPath, "src/report.html");
});

test("rejects traversal that climbs above the workspace root", () => {
  for (const bad of [
    "/src/../../../etc/passwd",
    "../outside.txt",
    "/../../escaped.txt",
    "..",
    "src/../..",
  ]) {
    assert.throws(
      () => normalizeCanvasPath(bad, "read"),
      (err: unknown) =>
        err instanceof SandboxPathError && /escapes session workspace|workspace root itself/.test(err.message),
      `expected ${bad} to be rejected`,
    );
  }
});

test("rejects the workspace root itself and empty input", () => {
  for (const bad of ["", "   ", "/", "///", "."]) {
    assert.throws(() => normalizeCanvasPath(bad, "read"), SandboxPathError);
  }
});

test("rejects NUL bytes, which would truncate a filesystem path", () => {
  assert.throws(() => normalizeCanvasPath("/src/a\0.html", "write"), SandboxPathError);
});

test("treats backslashes as separators so paths normalize identically on every platform", () => {
  assert.equal(normalizeCanvasPath("\\src\\a.html", "write").relPath, "src/a.html");
  assert.throws(() => normalizeCanvasPath("src\\..\\..\\etc", "read"), SandboxPathError);
});

test("write mode allows only /src and /output", () => {
  for (const ok of ["/src/a.html", "/output/a.png"]) {
    assert.ok(normalizeCanvasPath(ok, "write").relPath);
  }
  for (const bad of ["/templates/x.html", "/assets/logo.png", "/cache/build.css", "/other/x"]) {
    assert.throws(
      () => normalizeCanvasPath(bad, "write"),
      (err: unknown) =>
        err instanceof SandboxPathError && /only allowed under \/src or \/output/.test(err.message),
      `expected ${bad} to be rejected for write`,
    );
  }
});

test("render-output mode allows only /output and /cache", () => {
  assert.equal(normalizeCanvasPath("/output/a.pdf", "render-output").topDir, "output");
  assert.equal(normalizeCanvasPath("/cache/a.svg", "render-output").topDir, "cache");
  assert.throws(() => normalizeCanvasPath("/src/a.svg", "render-output"), SandboxPathError);
});

test("artifact mode allows only /output", () => {
  assert.equal(normalizeCanvasPath("/output/a.pdf", "artifact").topDir, "output");
  assert.throws(() => normalizeCanvasPath("/cache/a.svg", "artifact"), SandboxPathError);
});

test("read mode allows any top-level directory inside the workspace", () => {
  for (const ok of ["/src/a", "/output/a", "/cache/a", "/assets/a", "/templates/a"]) {
    assert.ok(normalizeCanvasPath(ok, "read").relPath);
  }
});

test("the error label is caller-supplied so messages read in the tool's terms", () => {
  assert.throws(
    () => normalizeCanvasPath("/src/a.svg", "render-output", "output_path"),
    (err: unknown) => err instanceof SandboxPathError && err.message.startsWith("output_path"),
  );
});

test("toDisplayPath is idempotent", () => {
  assert.equal(toDisplayPath("src/a.html"), "/src/a.html");
  assert.equal(toDisplayPath("/src/a.html"), "/src/a.html");
});

// The sandbox worker cannot import this module (tsx loader hooks do not
// reach worker_threads), so the guard is interpolated into the worker body
// as source text. These two assertions are what make "they cannot drift" a
// fact rather than a comment: if the injection is ever dropped or the
// function renamed, the worker would silently fall back to no confinement.
test("the worker body embeds the real guard, not a copy", () => {
  assert.ok(
    CANVAS_PATH_GUARD_SOURCE.startsWith("function normalizeCanvasPathStandalone("),
    "guard source must be a named function declaration the worker can call",
  );
  assert.ok(WORKER_SOURCE.includes(CANVAS_PATH_GUARD_SOURCE));
  assert.match(WORKER_SOURCE, /normalizeCanvasPathStandalone\(requestedPath, mode\)/);
});
