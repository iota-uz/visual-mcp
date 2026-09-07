import type { CanvasFile } from "./types.js";

export type CanvasSearchEntity = "node" | "note";

/**
 * One row per searchable canvas entity — the shape both the immutable
 * `canvasNodes` index and the live `canvasDraftNodes` index store. Built in
 * one place so the SPA layout path and every MCP write path index the same
 * text for the same document.
 */
export type CanvasSearchRow = {
  pageId: string;
  entity: CanvasSearchEntity;
  entityId: string;
  title: string;
  eyebrow?: string;
  searchText: string;
};

const NOTE_TITLE_MAX = 80;

/** First line of a note, trimmed to a title-sized excerpt. */
export function noteTitle(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? "";
  return line.length > NOTE_TITLE_MAX ? `${line.slice(0, NOTE_TITLE_MAX - 1)}…` : line;
}

function joinText(parts: Array<string | undefined>): string {
  return parts
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

export function canvasSearchRows(file: CanvasFile): CanvasSearchRow[] {
  return file.pages.flatMap((page) => [
    ...page.doc.nodes.map(
      (node): CanvasSearchRow => ({
        pageId: page.id,
        entity: "node",
        entityId: node.id,
        title: node.caption.title,
        eyebrow: node.caption.tag,
        searchText: joinText([
          page.title,
          node.caption.title,
          node.caption.subtitle,
          node.caption.tag,
          node.annotation?.content,
        ]),
      }),
    ),
    ...page.doc.notes.map(
      (note): CanvasSearchRow => ({
        pageId: page.id,
        entity: "note",
        entityId: note.id,
        title: noteTitle(note.text),
        eyebrow: note.author === "human" ? "Human note" : "Agent note",
        searchText: joinText([page.title, note.text]),
      }),
    ),
  ]);
}
