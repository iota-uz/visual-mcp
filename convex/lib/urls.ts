/**
 * Fully-qualified, user-facing URLs.
 *
 * The single most load-bearing gap in v1: not one tool returned a link.
 * `publish_canvas` returned a bare `public_slug`, the `/s/:slug` host was
 * never exposed, and the only place the origin was derived at all was
 * client-side in the SPA. An agent could publish a canvas and then be unable
 * to tell the human where to look.
 *
 * Two different URLs matter, and conflating them is the usual mistake:
 *
 *   share_url  ${SPA_ORIGIN}/s/:slug   the human-facing viewer. Handles every
 *                                      kind — a `kind: "canvas"` document
 *                                      renders in the SPA's own canvas engine,
 *                                      not as a static file.
 *   raw_url    *.convex.site/s/:slug   the raw artifact bytes, on the separate
 *                                      cookieless origin. For programmatic
 *                                      fetches, not for pasting to a person.
 */

/** Trailing slashes stripped so callers can join with "/" without doubling it. */
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

/**
 * The SPA's origin. Required — returning null URLs when it is unset would
 * just reproduce v1's "no link anywhere" failure in a new shape, so this
 * fails loudly at call time instead.
 */
export function getSpaOrigin(): string {
  const origin = process.env.SPA_ORIGIN;
  if (!origin || origin.trim().length === 0) {
    throw new Error(
      "SPA_ORIGIN is not set on this deployment, so canvas URLs cannot be built. " +
        "Set it with: npx convex env set SPA_ORIGIN https://your-spa-domain",
    );
  }
  return normalizeOrigin(origin);
}

/** The signed-in viewer for one canvas. */
export function canvasUrl(canvasId: string): string {
  return `${getSpaOrigin()}/c/${canvasId}`;
}

/** The public share link, or null while the canvas is still private. */
export function shareUrl(publicSlug: string | undefined | null): string | null {
  return publicSlug ? `${getSpaOrigin()}/s/${publicSlug}` : null;
}

/** The workspace gallery. */
export function workspaceUrl(workspaceSlug: string): string {
  return `${getSpaOrigin()}/w/${workspaceSlug}`;
}
