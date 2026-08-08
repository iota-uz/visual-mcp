/**
 * ApexCharts asset vendoring (PLAN.md section 3.3).
 *
 * Charts are authored directly as inline ApexCharts config objects inside
 * HTML mode ("new ApexCharts(...).render()") — there is no separate SDK
 * wrapper for chart authoring itself (PLAN.md section 13, "no custom
 * VisualKit SDK"). This module's only job is to make sure the prebuilt
 * ApexCharts UMD bundle from the `apexcharts` npm package is vendored into
 * a session workspace so authored HTML can load it as a local, allowlisted
 * asset — never a CDN script tag (PLAN.md section 3.3, section 9).
 *
 * Fixed asset-path contract (agreed with the Playwright-renderer module):
 *   - On disk:  <workspaceDir>/assets/js/apexcharts.min.js
 *   - In HTML:  <script src="/assets/js/apexcharts.min.js"></script>
 *
 * The renderer resolves any request path starting with `/assets/` by
 * serving files from `<workspaceDir>/assets/` via local route interception
 * (never a real network request), so the on-disk path above is load-bearing
 * for that sibling module — do not rename it without updating that contract.
 */

import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

/** Relative path (from a session workspace root) where the bundle lives. */
const ASSET_RELATIVE_PATH = path.join("assets", "js", "apexcharts.min.js");

/**
 * Absolute path to the prebuilt ApexCharts UMD/browser bundle shipped
 * inside the `apexcharts` npm package (node_modules/apexcharts/dist/).
 *
 * Resolved via `require.resolve` (not a hardcoded node_modules path) so
 * this keeps working regardless of package manager hoisting layout, and
 * fails loudly and immediately if the dependency is ever removed.
 */
function resolveApexChartsSourcePath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("apexcharts/dist/apexcharts.min.js");
}

/**
 * Ensures the ApexCharts browser bundle is vendored into a session
 * workspace at `<workspaceDir>/assets/js/apexcharts.min.js`.
 *
 * Idempotent and safe to call repeatedly (e.g. once at session-creation
 * time and again lazily before each chart render): it always re-copies the
 * bundle from node_modules, so it self-heals if the destination file was
 * ever partially written, truncated, or removed.
 *
 * @param workspaceDir Absolute path to the session workspace root (the
 *   directory containing `src/`, `output/`, `assets/`, `templates/`,
 *   `cache/` per PLAN.md section 7).
 * @returns The absolute path to the vendored bundle on disk.
 */
export async function ensureApexChartsAsset(
  workspaceDir: string,
): Promise<string> {
  const sourcePath = resolveApexChartsSourcePath();
  const destPath = path.join(workspaceDir, ASSET_RELATIVE_PATH);

  await mkdir(path.dirname(destPath), { recursive: true });
  await copyFile(sourcePath, destPath, fsConstants.COPYFILE_FICLONE);

  return destPath;
}

/**
 * Absolute-looking path used to reference the vendored bundle from inside
 * authored HTML, per PLAN.md section 3.3's example:
 *   <script src="/assets/js/apexcharts.min.js"></script>
 *
 * Exported so callers (e.g. templates) don't have to hardcode the literal
 * string themselves.
 */
export const APEXCHARTS_ASSET_HTML_SRC = "/assets/js/apexcharts.min.js";

/**
 * Relative on-disk path (from a session workspace root) of the vendored
 * bundle, i.e. `assets/js/apexcharts.min.js`. Exported for callers that
 * need to join it against a workspace dir themselves without duplicating
 * the path segments.
 */
export const APEXCHARTS_ASSET_RELATIVE_PATH = ASSET_RELATIVE_PATH;

/**
 * Returns true if the ApexCharts bundle has already been vendored into the
 * given workspace (without copying it). Useful for callers that want to
 * skip a redundant copy on a known-warm workspace.
 */
export async function hasApexChartsAsset(
  workspaceDir: string,
): Promise<boolean> {
  const destPath = path.join(workspaceDir, ASSET_RELATIVE_PATH);
  try {
    await access(destPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
