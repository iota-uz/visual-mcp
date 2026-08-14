/**
 * Canvas references — the single addressing vocabulary for the v2 tool
 * surface.
 *
 * The v1 tools made a caller carry four different opaque strings at once:
 * `workspace_id` (to create a canvas), `canvas_id` (to write to it), `slug`
 * (returned but not accepted anywhere), and `path`. An agent had to thread
 * ids it never saw a human-readable form of through every call, and a
 * retried `create_workspace` minted `osago-2` rather than finding `osago`.
 *
 * v2 collapses that to one `ref` string in two accepted forms:
 *
 *   "jn79rst16kdj6eezderzpw4cw98cezfq"   an opaque canvas id
 *   "osago/fast-settlement"              workspace slug / canvas slug
 *
 * The slug form is what makes `canvas_save` an upsert: it names a canvas
 * that may not exist yet, so the same call creates it the first time and
 * updates it every time after. A `/` is the discriminator — Convex ids never
 * contain one.
 *
 * Pure string logic, no database access, so it can be unit-tested and reused
 * from both the MCP action layer and the SPA's public functions.
 */

export class RefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefError";
  }
}

export type ParsedRef =
  | { form: "id"; canvasId: string }
  | { form: "slug"; workspaceSlug: string; canvasSlug: string };

const REF_HELP =
  'Expected either a canvas id ("jn79rst1…") or "workspace-slug/canvas-slug" (e.g. "osago/fast-settlement").';

/**
 * Splits a `ref` into its addressing form. Rejects anything ambiguous rather
 * than guessing — a malformed ref that silently resolved to the wrong canvas
 * would be a data-loss bug on an upsert.
 */
export function parseRef(ref: unknown, label = "ref"): ParsedRef {
  if (typeof ref !== "string" || ref.trim().length === 0) {
    throw new RefError(`${label} must be a non-empty string. ${REF_HELP}`);
  }
  const trimmed = ref.trim();

  if (!trimmed.includes("/")) {
    return { form: "id", canvasId: trimmed };
  }

  const parts = trimmed.split("/");
  if (parts.length !== 2) {
    throw new RefError(
      `${label} "${trimmed}" has too many "/" segments. ${REF_HELP} ` +
        "A file path goes in its own `path` argument, not in the ref.",
    );
  }
  const [workspaceSlug, canvasSlug] = parts as [string, string];
  if (!workspaceSlug || !canvasSlug) {
    throw new RefError(`${label} "${trimmed}" has an empty slug segment. ${REF_HELP}`);
  }
  return { form: "slug", workspaceSlug, canvasSlug };
}

/** Renders a canvas back into its stable, human-meaningful slug ref. */
export function formatRef(workspaceSlug: string, canvasSlug: string): string {
  return `${workspaceSlug}/${canvasSlug}`;
}
