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

function getPublicArtifactOrigin(): string | null {
  const origin = process.env.CONVEX_SITE_URL;
  if (!origin || origin.trim().length === 0) return null;
  return normalizeOrigin(origin);
}

export type PublicEmbedTarget =
  | { kind: "canvas" }
  | { kind: "node"; id: string }
  | { kind: "artifact"; id: string };

/** Public, static image URL suitable for GitHub issues and pull requests. */
export function embedCardUrl(
  publicSlug: string | undefined | null,
  target: PublicEmbedTarget = { kind: "canvas" },
  version?: number,
): string | null {
  if (!publicSlug) return null;
  const publicOrigin = getPublicArtifactOrigin();
  if (!publicOrigin) return null;
  const url = new URL(`/s/${encodeURIComponent(publicSlug)}/_embed/card.svg`, publicOrigin);
  url.searchParams.set("target", target.kind);
  if (target.kind !== "canvas") url.searchParams.set("id", target.id);
  if (version !== undefined) url.searchParams.set("version", String(version));
  return url.toString();
}

/** Click destination paired with a static preview card. */
export function embedTargetUrl(
  publicSlug: string | undefined | null,
  target: PublicEmbedTarget = { kind: "canvas" },
): string | null {
  if (!publicSlug) return null;
  if (target.kind === "artifact") {
    const publicOrigin = getPublicArtifactOrigin();
    return publicOrigin ? `${publicOrigin}/s/${publicSlug}${target.id}` : null;
  }
  const url = new URL(`/s/${encodeURIComponent(publicSlug)}`, getSpaOrigin());
  if (target.kind === "node") url.searchParams.set("node", target.id);
  return url.toString();
}

export function githubEmbedMarkdown(
  alt: string,
  imageUrl: string | null,
  targetUrl: string | null,
): string | null {
  if (!imageUrl || !targetUrl) return null;
  const safeAlt = alt
    .replace(/[\r\n]+/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("]", "\\]");
  return `[![${safeAlt}](${imageUrl})](${targetUrl})`;
}

/** The workspace gallery. */
export function workspaceUrl(workspaceSlug: string): string {
  return `${getSpaOrigin()}/w/${workspaceSlug}`;
}
