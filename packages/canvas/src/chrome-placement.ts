/** Screen-space placement for inspector and Exit, beside a node rect. */

export type ScreenRect = { x: number; y: number; width: number; height: number };

export const CHROME_GAP_PX = 12;
export const CHROME_GUTTER_PX = 12;

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inViewport(rect: ScreenRect, vw: number, vh: number, gutter: number): boolean {
  return (
    rect.x >= gutter &&
    rect.y >= gutter &&
    rect.x + rect.width <= vw - gutter &&
    rect.y + rect.height <= vh - gutter
  );
}

export function placeBesideRect(input: {
  anchor: ScreenRect;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  gutter?: number;
  avoid?: readonly ScreenRect[];
}): { x: number; y: number } {
  const gap = input.gap ?? CHROME_GAP_PX;
  const gutter = input.gutter ?? CHROME_GUTTER_PX;
  const a = input.anchor;
  const w = input.cardWidth;
  const h = input.cardHeight;
  const candidates: ScreenRect[] = [
    { x: a.x + a.width + gap, y: a.y, width: w, height: h },
    { x: a.x - gap - w, y: a.y, width: w, height: h },
    { x: a.x, y: a.y + a.height + gap, width: w, height: h },
    { x: a.x, y: a.y - gap - h, width: w, height: h },
  ];
  const blocked = input.avoid ?? [];
  const hit = candidates.find(
    (rect) =>
      inViewport(rect, input.viewportWidth, input.viewportHeight, gutter) &&
      !blocked.some((block) => overlaps(rect, block)),
  );
  if (hit) return { x: hit.x, y: hit.y };
  const fallback = candidates[0] ?? { x: gutter, y: gutter, width: w, height: h };
  return {
    x: Math.min(Math.max(gutter, fallback.x), Math.max(gutter, input.viewportWidth - w - gutter)),
    y: Math.min(Math.max(gutter, fallback.y), Math.max(gutter, input.viewportHeight - h - gutter)),
  };
}

/** Top-right of the node: above the frame when there is room, otherwise inset. */
export function placeExitOnNode(input: {
  anchor: ScreenRect;
  cardWidth: number;
  cardHeight: number;
  gutter?: number;
}): { x: number; y: number } {
  const gutter = input.gutter ?? CHROME_GUTTER_PX;
  const x = input.anchor.x + input.anchor.width - input.cardWidth;
  const above = input.anchor.y - input.cardHeight - 8;
  const y = above >= gutter ? above : input.anchor.y + 8;
  return { x: Math.max(gutter, x), y };
}
