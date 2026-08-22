import type { NodeAnnotation } from "./types.js";

const SAFE_TAGS = new Set(["a", "b", "br", "code", "em", "i", "li", "ol", "p", "pre", "strong", "ul"]);
const VOID_TAGS = new Set(["br"]);

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: string): string | undefined {
  const normalized = value.trim();
  if (/^(?:https?:|mailto:|#|\/)/i.test(normalized) && !/^\/\//.test(normalized)) return normalized;
  return undefined;
}

/**
 * Sanitizes the deliberately small annotation HTML subset without relying on
 * browser globals, so saved canvases, SSR, exports, and tests use one policy.
 * Unknown tags are removed but their text remains; attributes are dropped
 * except safe anchor href/title values. This function never emits handlers,
 * style, src, or executable URL schemes.
 */
export function sanitizeAnnotationHtml(input: string): string {
  let output = "";
  let cursor = 0;
  const tags = /<\/?[A-Za-z][^>]*>/g;
  for (const match of input.matchAll(tags)) {
    const index = match.index ?? 0;
    output += escapeHtml(input.slice(cursor, index));
    cursor = index + match[0].length;
    const parsed = /^<(\/)?\s*([A-Za-z0-9]+)([^>]*)>$/.exec(match[0]);
    if (!parsed) continue;
    const closing = Boolean(parsed[1]);
    const tag = parsed[2]!.toLowerCase();
    if (!SAFE_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) output += `</${tag}>`;
      continue;
    }
    if (tag !== "a") {
      output += `<${tag}>`;
      continue;
    }
    const attrs = parsed[3] ?? "";
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attrs);
    const titleMatch = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const href = safeHref(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "");
    const title = titleMatch?.[1] ?? titleMatch?.[2];
    output += `<a${href ? ` href="${escapeHtml(href)}" rel="noopener noreferrer"` : ""}${title ? ` title="${escapeHtml(title)}"` : ""}>`;
  }
  output += escapeHtml(input.slice(cursor));
  return output;
}

export function renderAnnotation(annotation?: NodeAnnotation): string {
  if (!annotation?.content.trim()) return "";
  return annotation.format === "html"
    ? sanitizeAnnotationHtml(annotation.content)
    : `<p>${escapeHtml(annotation.content)}</p>`;
}
