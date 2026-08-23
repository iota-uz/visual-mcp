function origin(name: "SPA_ORIGIN" | "CONVEX_SITE_URL"): string {
  const value = process.env[name]?.trim().replace(/\/+$/, "");
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
export function canvasUrl(id: string): string {
  return `${origin("SPA_ORIGIN")}/c/${id}`;
}
export function shareUrl(slug: string | null | undefined): string | null {
  return slug ? `${origin("SPA_ORIGIN")}/s/${slug}` : null;
}
export type PublicEmbedTarget =
  | { kind: "canvas" }
  | { kind: "node"; id: string }
  | { kind: "artifact"; id: string };
export function embedCardUrl(
  slug: string | null | undefined,
  target: PublicEmbedTarget = { kind: "canvas" },
  version?: number,
): string | null {
  if (!slug) return null;
  const url = new URL(`/s/${encodeURIComponent(slug)}/_embed/card.svg`, origin("CONVEX_SITE_URL"));
  url.searchParams.set("target", target.kind);
  if (target.kind !== "canvas") url.searchParams.set("id", target.id);
  if (version !== undefined) url.searchParams.set("version", String(version));
  return url.toString();
}
export function embedTargetUrl(
  slug: string | null | undefined,
  target: PublicEmbedTarget = { kind: "canvas" },
): string | null {
  if (!slug) return null;
  if (target.kind === "artifact") return `${origin("CONVEX_SITE_URL")}/s/${slug}${target.id}`;
  const url = new URL(`/s/${encodeURIComponent(slug)}`, origin("SPA_ORIGIN"));
  if (target.kind === "node") url.searchParams.set("node", target.id);
  return url.toString();
}
export function githubEmbedMarkdown(
  alt: string,
  imageUrl: string | null,
  targetUrl: string | null,
): string | null {
  if (!imageUrl || !targetUrl) return null;
  return `[![${alt
    .replace(/[\r\n]+/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("]", "\\]")}](${imageUrl})](${targetUrl})`;
}
