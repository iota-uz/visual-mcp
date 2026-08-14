/**
 * Shared workspace subdirectory layout.
 *
 * The session-based lifecycle that used to live here (`SESSIONS_ROOT`,
 * `createSessionWorkspace`, etc. — the local stdio server's on-disk
 * `sessions/<id>/` directories) is gone along with that server. What
 * survives is this one constant: `../storage/workspace.ts`'s `hydrate()`
 * (the mkdtemp-based workspace builder used by the render worker) creates
 * the identical `{src,output,assets,cache}` shape from it, so there is
 * exactly one place that list is spelled out.
 *
 * `templates` used to be here too. Nothing ever wrote to it or read from it
 * — templates are seeded straight into `/src` at canvas creation — so it was
 * an empty directory created on every render and has been dropped.
 */

export const WORKSPACE_SUBDIRS = ["src", "output", "assets", "cache"] as const;
