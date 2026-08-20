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
  'Expected a canvas id/public slug, a canvas or share URL, a canvas:// URI, or "workspace-slug/canvas-slug" (e.g. "osago/fast-settlement").';

/**
 * Normalizes references that the product itself exposes back into the two
 * canonical addressing forms. Agents routinely paste `canvas_url`,
 * `share_url`, or a copied `canvas://` element locator into a later call;
 * rejecting those values makes our own outputs non-composable.
 */
function normalizeProductRef(value: string, label: string): string {
  if (value.startsWith("canvas://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RefError(`${label} "${value}" is not a valid canvas:// URI. ${REF_HELP}`);
    }
    const parts = [url.hostname, ...url.pathname.split("/").filter(Boolean)];
    if (parts.length !== 2) {
      throw new RefError(`${label} "${value}" must name canvas://workspace/canvas. ${REF_HELP}`);
    }
    return `${decodeURIComponent(parts[0] as string)}/${decodeURIComponent(parts[1] as string)}`;
  }

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new RefError(`${label} "${value}" is not a valid URL. ${REF_HELP}`);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "c") return decodeURIComponent(parts[1] as string);
    if (parts.length >= 2 && parts[0] === "s") return decodeURIComponent(parts[1] as string);
    throw new RefError(`${label} URL must contain /c/<canvas-id> or /s/<public-slug>. ${REF_HELP}`);
  }

  return value;
}

/**
 * Splits a `ref` into its addressing form. Rejects anything ambiguous rather
 * than guessing — a malformed ref that silently resolved to the wrong canvas
 * would be a data-loss bug on an upsert.
 */
export function parseRef(ref: unknown, label = "ref"): ParsedRef {
  if (typeof ref !== "string" || ref.trim().length === 0) {
    throw new RefError(`${label} must be a non-empty string. ${REF_HELP}`);
  }
  const trimmed = normalizeProductRef(ref.trim(), label);

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
