/** Lowercase, ASCII, hyphen-separated slug — used for workspace and canvas URLs. */
export function slugify(input: string): string {
  const diacritics = /[\u0300-\u036f]/g;
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(diacritics, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "untitled";
}
