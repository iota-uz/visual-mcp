/**
 * Tests for the ApexCharts asset-vendoring helper
 * (src/render/charts/index.ts, PLAN.md section 3.3).
 *
 * Scope: asset-vendoring behavior only (file gets copied to the fixed
 * on-disk path, is idempotent, and looks like the real ApexCharts UMD
 * bundle). A full Playwright render smoke test is covered by the
 * renderer's own integration tests, not here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APEXCHARTS_ASSET_HTML_SRC,
  APEXCHARTS_ASSET_RELATIVE_PATH,
  ensureApexChartsAsset,
  hasApexChartsAsset,
} from "../src/render/charts/index.js";

async function makeTempWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "visual-mcp-charts-test-"));
}

test("ensureApexChartsAsset vendors the bundle at the fixed contract path", async () => {
  const workspaceDir = await makeTempWorkspace();
  try {
    const destPath = await ensureApexChartsAsset(workspaceDir);
    const expectedPath = path.join(
      workspaceDir,
      "assets",
      "js",
      "apexcharts.min.js",
    );
    assert.equal(destPath, expectedPath);
    assert.equal(
      APEXCHARTS_ASSET_RELATIVE_PATH,
      path.join("assets", "js", "apexcharts.min.js"),
    );
    assert.equal(APEXCHARTS_ASSET_HTML_SRC, "/assets/js/apexcharts.min.js");

    const stats = await stat(destPath);
    assert.ok(stats.isFile());
    assert.ok(stats.size > 0, "vendored bundle should be non-empty");

    const contents = await readFile(destPath, "utf8");
    // Real UMD bundle has a license header naming ApexCharts near the top,
    // and defines `globalThis.ApexCharts` via a UMD wrapper.
    assert.ok(
      contents.slice(0, 200).includes("ApexCharts"),
      "vendored file should look like the real ApexCharts bundle",
    );
    assert.ok(contents.includes("ApexCharts=e()") || contents.includes("t.ApexCharts"));
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("ensureApexChartsAsset is idempotent (safe to call multiple times)", async () => {
  const workspaceDir = await makeTempWorkspace();
  try {
    const first = await ensureApexChartsAsset(workspaceDir);
    const second = await ensureApexChartsAsset(workspaceDir);
    assert.equal(first, second);

    const stats = await stat(second);
    assert.ok(stats.isFile());
    assert.ok(stats.size > 0);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("hasApexChartsAsset reflects whether the bundle has been vendored", async () => {
  const workspaceDir = await makeTempWorkspace();
  try {
    assert.equal(await hasApexChartsAsset(workspaceDir), false);
    await ensureApexChartsAsset(workspaceDir);
    assert.equal(await hasApexChartsAsset(workspaceDir), true);
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
