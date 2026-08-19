export type EmbedTarget =
  | { kind: "canvas"; label: string }
  | { kind: "node"; id: string; label: string }
  | { kind: "artifact"; id: string; label: string };

export function embedTargetKey(target: EmbedTarget): string {
  return target.kind === "canvas" ? "canvas" : `${target.kind}:${target.id}`;
}

export function buildEmbedCardUrl({
  publicOrigin,
  publicSlug,
  target,
  version,
}: {
  publicOrigin: string;
  publicSlug: string;
  target: EmbedTarget;
  version?: number;
}): string {
  const url = new URL(`/s/${encodeURIComponent(publicSlug)}/_embed/card.svg`, publicOrigin);
  url.searchParams.set("target", target.kind);
  if (target.kind !== "canvas") url.searchParams.set("id", target.id);
  if (version !== undefined) url.searchParams.set("version", String(version));
  return url.toString();
}

export function buildEmbedClickUrl({
  appOrigin,
  publicOrigin,
  publicSlug,
  target,
}: {
  appOrigin: string;
  publicOrigin: string;
  publicSlug: string;
  target: EmbedTarget;
}): string {
  if (target.kind === "artifact") {
    return new URL(`/s/${encodeURIComponent(publicSlug)}${target.id}`, publicOrigin).toString();
  }
  const url = new URL(`/s/${encodeURIComponent(publicSlug)}`, appOrigin);
  if (target.kind === "node") url.searchParams.set("node", target.id);
  return url.toString();
}

function markdownAlt(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

export function buildEmbedMarkdown(args: {
  alt: string;
  cardUrl: string;
  clickUrl: string;
}): string {
  return `[![${markdownAlt(args.alt)}](${args.cardUrl})](${args.clickUrl})`;
}
