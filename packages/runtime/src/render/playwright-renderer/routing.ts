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
 * Unresolved-reference reporting: a subresource this policy cannot satisfy
 * (missing file, or a `file:` path outside the workspace) is aborted, and
 * Chromium then renders the page anyway with a broken <img>/background —
 * silently. That was a real production failure: canvases shipped with
 * `<img src="./accident-1.jpg">` and `url("./myid-face-camera-v1.png")`
 * whose files were never uploaded, and every render "succeeded". So the
 * routing layer now *also* records what it refused, and `renderFile`
 * surfaces the list to its caller. This is observation only — nothing about
 * the abort/fulfill decisions changed, and an unresolved ref never fails a
 * render.
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
 * Upper bound on how many distinct unresolved references a single render
 * reports. A pathological page (a gallery template looping over a few
 * thousand missing thumbnails) would otherwise push an unbounded array
 * through the worker's JSON response and into a Convex document. The list
 * is diagnostic, not exhaustive — the first 50 are enough to name the
 * problem.
 */
export const MAX_UNRESOLVED_REFS = 50;

/**
 * Accumulates the references a render could not satisfy, de-duplicated and
 * capped. Returned by {@link installLocalResourceRouting} so the caller can
 * read the list *after* the page has finished loading.
 */
export interface UnresolvedRefCollector {
  /** Snapshot of the de-duplicated refs, in first-seen order. */
  list(): string[];
}

/**
 * Formats a request URL the way the page author wrote it, as far as we can
 * reconstruct: a `file:` URL under the (temp, per-render) workspace root is
 * reported as its workspace-relative form (`/src/accident-1.jpg`), never as
 * the hydrated temp-dir absolute path, which is meaningless to the caller
 * and different on every run. A root-relative href like `/assets/x.png`
 * resolves to the *filesystem* root and so is already in that form. Non-file
 * URLs (CDN scripts, remote images) are reported verbatim.
 */
function formatRef(rawUrl: string, root: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (url.origin === "http://canvas.local") return decodeURIComponent(url.pathname);
  if (url.protocol !== "file:") return rawUrl;

  const requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === root) return "/";
  if (requestedPath.startsWith(root + path.sep)) {
    // POSIX separators in the reported form regardless of host platform —
    // the caller thinks in canvas paths, which are always `/`-separated.
    const relative = requestedPath.slice(root.length + 1).replaceAll(path.sep, "/");
    return `/${relative}`;
  }
  return requestedPath;
}

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
 *
 * Returns a collector for the references the page asked for and did not
 * get. Two sources feed it, because neither sees everything:
 *  - the route handler below, which knows *why* it refused a `file:`
 *    request (outside the workspace, or simply not on disk) — the only
 *    place a missing local asset is ever observable;
 *  - `page.on("requestfailed")`, which catches failures the route handler
 *    never decides, e.g. a `route.continue()`d CDN URL whose DNS or TCP
 *    connection fails. `net::ERR_ABORTED` is skipped there: it is what
 *    Chromium reports for ordinary cancellations (navigation teardown,
 *    speculative media fetches) and would manufacture false positives; our
 *    own aborts surface as ERR_FAILED / ERR_ACCESS_DENIED instead. Refs
 *    seen by both sources de-duplicate on the formatted string.
 */
export async function installLocalResourceRouting(
  page: Page,
  workspaceRoot: string,
): Promise<UnresolvedRefCollector> {
  const root = path.resolve(workspaceRoot);

  // Insertion-ordered + de-duplicating: a page that references the same
  // missing image in 40 <img> tags reports it once.
  const unresolved = new Set<string>();
  const recordUnresolved = (rawUrl: string): void => {
    if (unresolved.size >= MAX_UNRESOLVED_REFS) return;
    unresolved.add(formatRef(rawUrl, root));
  };

  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    recordUnresolved(request.url());
  });

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

    if (url.origin === "http://canvas.local") {
      const resolved = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!(resolved === root || resolved.startsWith(root + path.sep))) {
        recordUnresolved(request.url());
        await route.abort("accessdenied");
        return;
      }
      try {
        await fs.access(resolved);
      } catch {
        recordUnresolved(request.url());
        await route.abort("failed");
        return;
      }
      await route.fulfill({ path: resolved, headers: { "access-control-allow-origin": "*" } });
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
      recordUnresolved(request.url());
      await route.abort("accessdenied");
      return;
    }

    try {
      await fs.access(resolved);
    } catch {
      // The common case behind a "successful" render with broken images:
      // the HTML/CSS names a file the canvas never uploaded.
      recordUnresolved(request.url());
      await route.abort("failed");
      return;
    }

    // Sandboxed iframes intentionally omit allow-same-origin. Their module
    // scripts therefore have an opaque origin and need an explicit CORS
    // response even though the bytes are local to the hydrated workspace.
    await route.fulfill({ path: resolved, headers: { "access-control-allow-origin": "*" } });
  });

  return { list: () => [...unresolved] };
}
