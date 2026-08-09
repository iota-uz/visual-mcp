/**
 * Shared workspace subdirectory layout (PLAN.md Part 2 section 7).
 *
 * The session-based lifecycle that used to live here (`SESSIONS_ROOT`,
 * `createSessionWorkspace`, etc. — the local stdio server's on-disk
 * `sessions/<id>/` directories) is gone along with that server. What
 * survives is this one constant: `../storage/workspace.ts`'s `hydrate()`
 * (the mkdtemp-based workspace builder used by the render worker) creates
 * the identical `{src,output,assets,templates,cache}` shape from it, so
 * there is exactly one place that list is spelled out.
 */

export const WORKSPACE_SUBDIRS = ["src", "output", "assets", "templates", "cache"] as const;
