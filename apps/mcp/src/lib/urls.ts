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
export type PublicPngEmbedTarget =
  | { type: "canvas" }
  | { type: "node"; node_id: string }
  | { type: "group"; group_id: string }
  | { type: "stage"; stage_id: string }
  | { type: "region"; x: number; y: number; width: number; height: number };

export function embedPngUrl(
  slug: string | null | undefined,
  target: PublicPngEmbedTarget,
  options: {
    pageId?: string;
    scale?: 1 | 2;
    padding?: number;
    clip?: "frame" | "content";
    version?: number;
    revision?: number;
  } = {},
): string | null {
  if (!slug) return null;
  const base = `/s/${encodeURIComponent(slug)}/_embed/`;
  const path =
    target.type === "canvas"
      ? `${base}canvas.png`
      : target.type === "node"
        ? `${base}node/${encodeURIComponent(target.node_id)}.png`
        : target.type === "group"
          ? `${base}group/${encodeURIComponent(target.group_id)}.png`
          : target.type === "stage"
            ? `${base}stage/${encodeURIComponent(target.stage_id)}.png`
            : `${base}region/${target.x}-${target.y}-${target.width}-${target.height}.png`;
  // Public embeds intentionally stay on the product origin. Tracker image
  // proxies must never receive a deployment-specific *.convex.site URL.
  const url = new URL(path, origin("SPA_ORIGIN"));
  if (options.pageId) url.searchParams.set("page", options.pageId);
  if (options.version !== undefined) url.searchParams.set("v", String(options.version));
  if (options.revision !== undefined) url.searchParams.set("rev", String(options.revision));
  if (options.scale !== undefined) url.searchParams.set("scale", String(options.scale));
  if (options.padding !== undefined) url.searchParams.set("padding", String(options.padding));
  if (options.clip === "content") url.searchParams.set("clip", "content");
  return url.toString();
}

export function pngEmbedTargetUrl(
  slug: string | null | undefined,
  target: PublicPngEmbedTarget,
  pageId?: string,
): string | null {
  if (!slug) return null;
  const url = new URL(`/s/${encodeURIComponent(slug)}`, origin("SPA_ORIGIN"));
  if (pageId) url.searchParams.set("page", pageId);
  if (target.type === "node") url.searchParams.set("node", target.node_id);
  if (target.type === "group") url.searchParams.set("group", target.group_id);
  if (target.type === "stage") url.searchParams.set("stage", target.stage_id);
  return url.toString();
}
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
