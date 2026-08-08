/**
 * Small HTML string helpers for locating and swapping the Tailwind entry
 * `<style>` block (PLAN.md section 3.1). Deliberately regex-based rather
 * than a full HTML parser — we only need to find a top-level `<style>...
 * </style>` block whose contents include `@import "tailwindcss"` and
 * replace it in place; a full DOM parse is unnecessary overhead for that.
 */

const STYLE_BLOCK_RE = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
const TAILWIND_IMPORT_RE = /@import\s+["']tailwindcss["']/;

export interface TailwindStyleBlock {
  /** The full `<style ...>...</style>` substring, incl. tags. */
  fullMatch: string;
  /** The raw CSS text between the tags. */
  rawCss: string;
}

/**
 * Finds the first `<style>` block in `html` whose contents contain
 * `@import "tailwindcss"`. Returns `null` if the document has no Tailwind
 * entry block (plain HTML/CSS pages are valid input too — they're passed
 * through untouched).
 */
export function findTailwindStyleBlock(html: string): TailwindStyleBlock | null {
  STYLE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec() loop
  while ((match = STYLE_BLOCK_RE.exec(html)) !== null) {
    const rawCss = match[2] ?? "";
    if (TAILWIND_IMPORT_RE.test(rawCss)) {
      return { fullMatch: match[0], rawCss };
    }
  }
  return null;
}

/** Replaces `block`'s original `<style>` tag contents with `builtCss`. */
export function injectBuiltCss(html: string, block: TailwindStyleBlock, builtCss: string): string {
  const replacement = `<style>\n${builtCss}\n</style>`;
  return html.replace(block.fullMatch, () => replacement);
}
