/**
 * Local resource resolution for the Playwright renderer, plus the
 * asset-path contract agreed with the ApexCharts/charts sibling module.
 *
 * Mechanism: `page.route("**\/*", ...)` intercepts every request the page
 * makes (main-document navigation and all subresources — scripts, images,
 * fonts, fetch/XHR, etc.). We chose route interception over running a local
 * static file server because it lets us navigate straight to a `file://`
 * URL (no server process to manage/tear down) while still resolving
 * root-relative asset paths against the session workspace — the
 * `**\/*` pattern needs no ordering games with a second "catch-all" route.
 *
 * Policy:
 *  - `file:` requests are resolved against the workspace root and served
 *    from disk if they land inside it; otherwise aborted (this is workspace
 *    path confinement, not network sandboxing — a `file://` request outside
 *    the session workspace is still refused).
 *  - `data:` URIs are allowed through unmodified.
 *  - Everything else (`http:`, `https:`, `ws:`, `wss:`, etc.) is passed
 *    through to the real network via `route.continue()` — rendered pages
 *    may load CDN scripts/CSS, remote images/fonts, and make outbound
 *    fetch/XHR/WebSocket calls. (PLAN.md section 9's "no external network"
 *    sandbox default has been deliberately dropped for this renderer; see
 *    project history for the request that removed it.)
 *
 * Asset-path contract: session HTML references the shared ApexCharts
 * bundle (and other local assets) via the absolute-looking path
 * `/assets/js/apexcharts.min.js` (PLAN.md section 3.3). When the document
 * is loaded via a `file://` URL, a root-relative href like that resolves
 * to `file:///assets/js/apexcharts.min.js` — i.e. the *filesystem* root,
 * not the workspace. We detect that case (the resolved pathname does not
 * fall under the workspace root) and remap it by joining the pathname onto
 * `workspaceRoot` instead, which is exactly `<workspaceRoot>/assets/js/
 * apexcharts.min.js`. Paths that already resolve inside the workspace
 * (e.g. relative hrefs next to the entrypoint) are served as-is.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Page } from "playwright";

const MAX_WORKSPACE_SEARCH_DEPTH = 8;

/**
 * Infers a session workspace root from an entrypoint file path by walking
 * upward looking for a directory with an `assets/` subdirectory (session
 * layout per PLAN.md section 7 is `<workspace>/{src,output,assets,
 * templates,cache}`, and the charts module vendors the ApexCharts bundle at
 * `<workspace>/assets/js/apexcharts.min.js`). Falls back to the
 * entrypoint's own directory if nothing is found within
 * `MAX_WORKSPACE_SEARCH_DEPTH` levels (e.g. a standalone HTML file with no
 * session workspace at all).
 */
export async function inferWorkspaceRoot(entrypoint: string): Promise<string> {
  const start = path.dirname(path.resolve(entrypoint));
  let dir = start;
  for (let i = 0; i < MAX_WORKSPACE_SEARCH_DEPTH; i++) {
    try {
      const stat = await fs.stat(path.join(dir, "assets"));
      if (stat.isDirectory()) return dir;
    } catch {
      // no assets/ sibling at this level — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * Installs the local-only routing/blocking policy described above onto
 * `page`. Must be called before `page.goto(...)`.
 */
export async function installLocalResourceRouting(
  page: Page,
  workspaceRoot: string,
): Promise<void> {
  const root = path.resolve(workspaceRoot);

  await page.route("**/*", async (route) => {
    const request = route.request();
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }

    if (url.protocol === "data:") {
      await route.continue();
      return;
    }

    if (url.protocol !== "file:") {
      // Network sandboxing removed: let CDN scripts/CSS, remote
      // images/fonts, navigation, websockets, etc. hit the real network.
      await route.continue();
      return;
    }

    const requestedPath = decodeURIComponent(url.pathname);
    const looksAlreadyInWorkspace =
      requestedPath === root || requestedPath.startsWith(root + path.sep);
    const candidate = looksAlreadyInWorkspace ? requestedPath : path.join(root, requestedPath);
    const resolved = path.resolve(candidate);

    const withinWorkspace = resolved === root || resolved.startsWith(root + path.sep);
    if (!withinWorkspace) {
      await route.abort("accessdenied");
      return;
    }

    try {
      await fs.access(resolved);
    } catch {
      await route.abort("failed");
      return;
    }

    await route.fulfill({ path: resolved });
  });
}
