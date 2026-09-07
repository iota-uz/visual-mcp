import type { CanvasNote, NoteSize, Rect } from "./types.js";

/**
 * Sticky notes store a width only; the browser wraps the text and the DOM
 * decides the height. Everything that cannot ask the DOM — hit-testing
 * before layout, the minimap, static PNG/SVG renders — uses this estimate.
 * It mirrors the metrics `theme.css` gives `.vc-note[data-size]`, so keep
 * the two in step.
 */
export const NOTE_METRICS: Record<
  NoteSize,
  { fontSize: number; lineHeight: number; padding: number; charWidth: number }
> = {
  s: { fontSize: 13, lineHeight: 18, padding: 12, charWidth: 7.2 },
  m: { fontSize: 16, lineHeight: 22, padding: 14, charWidth: 8.8 },
  l: { fontSize: 22, lineHeight: 30, padding: 18, charWidth: 12 },
};

export function estimateNoteHeight(note: Pick<CanvasNote, "w" | "text" | "size">): number {
  const metrics = NOTE_METRICS[note.size];
  const innerWidth = Math.max(1, note.w - metrics.padding * 2);
  const perLine = Math.max(1, Math.floor(innerWidth / metrics.charWidth));
  const lines = note.text
    .split(/\r?\n/)
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.round(metrics.padding * 2 + lines * metrics.lineHeight);
}

export function noteRect(note: Pick<CanvasNote, "x" | "y" | "w" | "text" | "size">): Rect {
  return { x: note.x, y: note.y, w: note.w, h: estimateNoteHeight(note) };
}
