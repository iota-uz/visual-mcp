/**
 * Unit tests for src/render/artifact-store (PLAN.md section 12; MCP tools
 * 6.5 list_artifacts, 6.6 export_artifact).
 *
 * Test runner: node:test + node:assert/strict, run via
 * `node --import tsx --test test/**\/*.test.ts`.
 *
 * Each test uses a unique session id (random suffix) under the real
 * `sessions/` dir at the repo root, and cleans up after itself so repeated
 * runs don't accumulate fixtures.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  registerArtifact,
  getManifest,
  listArtifacts,
  exportArtifact,
  sessionRootDir,
  sessionOutputDir,
  REPO_ROOT,
  PathTraversalError,
  ArtifactNotFoundError,
} from "../src/render/artifact-store/index.js";

function freshSessionId(label: string): string {
  return `test_${label}_${randomUUID().slice(0, 8)}`;
}

async function cleanupSession(sessionId: string): Promise<void> {
  await fs.rm(sessionRootDir(sessionId), { recursive: true, force: true });
}

test("REPO_ROOT resolves to the actual repo root (has package.json)", async () => {
  const pkg = await fs.stat(path.join(REPO_ROOT, "package.json"));
  assert.ok(pkg.isFile());
});

test("registerArtifact: first artifact ever auto-becomes primary", async () => {
  const sessionId = freshSessionId("auto-primary");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");

    const manifest = await getManifest(sessionId);
    assert.equal(manifest.session_id, sessionId);
    assert.equal(manifest.primary, "/output/report.pdf");
    assert.equal(manifest.artifacts.length, 1);
    assert.deepEqual(manifest.artifacts[0], {
      path: "/output/report.pdf",
      type: "pdf",
      role: "primary",
    });
    assert.ok(manifest.created_at);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("registerArtifact: subsequent artifacts default to supporting, primary unchanged", async () => {
  const sessionId = freshSessionId("default-supporting");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    await registerArtifact(sessionId, "/output/architecture.png", "image");
    await registerArtifact(sessionId, "/output/source.zip", "source");

    const manifest = await getManifest(sessionId);
    assert.equal(manifest.primary, "/output/report.pdf");
    assert.equal(manifest.artifacts.length, 3);

    const roles = Object.fromEntries(
      manifest.artifacts.map((a) => [a.path, a.role]),
    );
    assert.equal(roles["/output/report.pdf"], "primary");
    assert.equal(roles["/output/architecture.png"], "supporting");
    assert.equal(roles["/output/source.zip"], "supporting");
  } finally {
    await cleanupSession(sessionId);
  }
});

test("registerArtifact: explicit primary demotes the previous primary to supporting", async () => {
  const sessionId = freshSessionId("reassign-primary");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    await registerArtifact(
      sessionId,
      "/output/architecture.png",
      "image",
      "primary",
    );

    const manifest = await getManifest(sessionId);
    assert.equal(manifest.primary, "/output/architecture.png");

    const roles = Object.fromEntries(
      manifest.artifacts.map((a) => [a.path, a.role]),
    );
    assert.equal(roles["/output/report.pdf"], "supporting");
    assert.equal(roles["/output/architecture.png"], "primary");

    // Exactly one primary at a time.
    const primaries = manifest.artifacts.filter((a) => a.role === "primary");
    assert.equal(primaries.length, 1);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("registerArtifact: created_at is set once and not updated on later calls", async () => {
  const sessionId = freshSessionId("created-at-stable");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    const first = await getManifest(sessionId);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await registerArtifact(sessionId, "/output/architecture.png", "image");
    const second = await getManifest(sessionId);

    assert.equal(second.created_at, first.created_at);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("registerArtifact: re-registering same path updates in place, no duplicate", async () => {
  const sessionId = freshSessionId("upsert");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    await registerArtifact(sessionId, "/output/report.pdf", "pdf", "debug");

    const manifest = await getManifest(sessionId);
    assert.equal(manifest.artifacts.length, 1);
    assert.equal(manifest.artifacts[0]?.role, "debug");
    // No artifact is primary anymore since the only one got demoted.
    assert.equal(manifest.primary, null);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("registerArtifact persists manifest.json matching PLAN.md section 12 shape", async () => {
  const sessionId = freshSessionId("manifest-json-shape");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    await registerArtifact(sessionId, "/output/architecture.png", "image");

    const manifestPath = path.join(
      sessionOutputDir(sessionId),
      "manifest.json",
    );
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.session_id, sessionId);
    assert.equal(parsed.primary, "/output/report.pdf");
    assert.ok(Array.isArray(parsed.artifacts));
    assert.deepEqual(Object.keys(parsed).sort(), [
      "artifacts",
      "created_at",
      "primary",
      "session_id",
    ]);
    for (const artifact of parsed.artifacts) {
      assert.deepEqual(Object.keys(artifact).sort(), ["path", "role", "type"]);
    }
  } finally {
    await cleanupSession(sessionId);
  }
});

test("getManifest returns an empty manifest for a session with no artifacts", async () => {
  const sessionId = freshSessionId("empty-manifest");
  try {
    const manifest = await getManifest(sessionId);
    assert.equal(manifest.session_id, sessionId);
    assert.equal(manifest.primary, null);
    assert.deepEqual(manifest.artifacts, []);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("listArtifacts returns the same ArtifactManifest shape as getManifest", async () => {
  const sessionId = freshSessionId("list-artifacts-shape");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");
    await registerArtifact(sessionId, "/output/chart.svg", "svg");

    const listed = await listArtifacts(sessionId);
    const manifest = await getManifest(sessionId);
    assert.deepEqual(listed, manifest);
    assert.equal(listed.primary, "/output/report.pdf");
    assert.equal(listed.artifacts.length, 2);
  } finally {
    await cleanupSession(sessionId);
  }
});

test("exportArtifact returns correct content/metadata for a known file", async () => {
  const sessionId = freshSessionId("export-known");
  try {
    await registerArtifact(sessionId, "/output/report.pdf", "pdf");

    const outputDir = sessionOutputDir(sessionId);
    await fs.mkdir(outputDir, { recursive: true });
    const fileBytes = Buffer.from("%PDF-1.4 fake pdf bytes");
    await fs.writeFile(path.join(outputDir, "report.pdf"), fileBytes);

    const result = await exportArtifact(sessionId, "/output/report.pdf");

    assert.equal(result.artifact.path, "/output/report.pdf");
    assert.equal(result.artifact.type, "pdf");
    assert.equal(result.artifact.role, "primary");
    assert.equal(result.mime_type, "application/pdf");
    assert.equal(result.absolute_path, path.join(outputDir, "report.pdf"));

    const contentOnDisk = await fs.readFile(result.absolute_path);
    assert.ok(contentOnDisk.equals(fileBytes));
  } finally {
    await cleanupSession(sessionId);
  }
});

test("exportArtifact infers type/mime for a file not in the manifest", async () => {
  const sessionId = freshSessionId("export-unregistered");
  try {
    const outputDir = sessionOutputDir(sessionId);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "chart.svg"), "<svg></svg>");

    const result = await exportArtifact(sessionId, "/output/chart.svg");
    assert.equal(result.artifact.type, "svg");
    assert.equal(result.artifact.role, "supporting");
    assert.equal(result.mime_type, "image/svg+xml");
  } finally {
    await cleanupSession(sessionId);
  }
});

test("exportArtifact throws ArtifactNotFoundError for a missing file", async () => {
  const sessionId = freshSessionId("export-missing");
  try {
    await assert.rejects(
      () => exportArtifact(sessionId, "/output/does-not-exist.png"),
      ArtifactNotFoundError,
    );
  } finally {
    await cleanupSession(sessionId);
  }
});

test("exportArtifact rejects a path-traversal attempt outside /output", async () => {
  const sessionId = freshSessionId("export-traversal");
  try {
    // Plant a "secret" file outside /output, in the session's /src dir.
    const srcDir = path.join(sessionRootDir(sessionId), "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "secret.ts"), "export const x = 1;");

    await assert.rejects(
      () => exportArtifact(sessionId, "/output/../src/secret.ts"),
      PathTraversalError,
    );
    await assert.rejects(
      () => exportArtifact(sessionId, "/src/secret.ts"),
      PathTraversalError,
    );
    await assert.rejects(
      () => exportArtifact(sessionId, "../../../etc/passwd"),
      PathTraversalError,
    );
  } finally {
    await cleanupSession(sessionId);
  }
});
