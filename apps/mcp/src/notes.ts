/**
 * Sticky-note authorship at the MCP write boundary.
 *
 * `author` is never trusted from an agent payload: every note the agent adds
 * is the agent's, and a note a human wrote in the editor stays the human's
 * however the agent re-saves the document. The agent may move, resize or
 * recolor human feedback but never rewrite its text — that is the one kind
 * of canvas content the human authors directly (adr/product).
 */
import type { CanvasDocPatchOperation } from "@visual-canvas/canvas/patch.js";
import type { CanvasDoc, CanvasFile, CanvasNote } from "@visual-canvas/canvas/types.js";

const AGENT: CanvasNote["author"] = "agent";

function humanNoteError(id: string): Error {
  return new Error(
    `note_owned_by_human: note "${id}" was written by a person; the agent may move, resize or ` +
      "recolor it but not change its text. Leave a comment or add your own note instead.",
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Rewrites note operations so the stored author is always the boundary's
 * verdict. Every other operation passes through untouched.
 */
export function stampAgentNotes(
  operations: CanvasDocPatchOperation[],
  current: Pick<CanvasDoc, "notes">,
): CanvasDocPatchOperation[] {
  const humanById = new Map(
    current.notes.filter((note) => note.author === "human").map((note) => [note.id, note]),
  );
  return operations.map((operation) => {
    if (!operation.op.startsWith("notes.")) return operation;
    if (operation.op === "notes.add") {
      const value = asRecord(operation.value) ?? {};
      return { ...operation, value: { ...value, author: AGENT } };
    }
    if (operation.op === "notes.replace") {
      const value = asRecord(operation.value) ?? {};
      const human = humanById.get(operation.id);
      if (human) {
        if (typeof value.text === "string" && value.text !== human.text)
          throw humanNoteError(operation.id);
        return { ...operation, value: { ...value, text: human.text, author: "human" } };
      }
      return { ...operation, value: { ...value, author: AGENT } };
    }
    if (operation.op === "notes.update") {
      const { author: _author, ...changes } = operation.changes;
      const human = humanById.get(operation.id);
      if (human && "text" in changes && changes.text !== human.text)
        throw humanNoteError(operation.id);
      return { ...operation, changes };
    }
    return operation;
  });
}

/**
 * Full-document writes (canvas_save, page tools, canvas_patch) carry whole
 * notes. Walks the raw value before schema validation so an agent can omit
 * `author` entirely; a note whose id matches a human note in the stored
 * document keeps that authorship and its text.
 */
export function reconcileNoteAuthors(current: CanvasFile | undefined, next: unknown): unknown {
  const file = asRecord(next);
  if (!file || !Array.isArray(file.pages)) return next;
  const humanByPage = new Map<string, Map<string, CanvasNote>>();
  for (const page of current?.pages ?? []) {
    humanByPage.set(
      page.id,
      new Map(
        page.doc.notes.filter((note) => note.author === "human").map((note) => [note.id, note]),
      ),
    );
  }
  return {
    ...file,
    pages: file.pages.map((rawPage) => {
      const page = asRecord(rawPage);
      const doc = page ? asRecord(page.doc) : null;
      if (!page || !doc || !Array.isArray(doc.notes)) return rawPage;
      const humans = typeof page.id === "string" ? humanByPage.get(page.id) : undefined;
      return {
        ...page,
        doc: {
          ...doc,
          notes: doc.notes.map((rawNote) => {
            const note = asRecord(rawNote);
            if (!note) return rawNote;
            const human = typeof note.id === "string" ? humans?.get(note.id) : undefined;
            if (!human) return { ...note, author: AGENT };
            if (typeof note.text === "string" && note.text !== human.text)
              throw humanNoteError(human.id);
            return { ...note, text: human.text, author: "human" };
          }),
        },
      };
    }),
  };
}

/** Human-authored notes on one Page, or across the file when no Page is named. */
export function countHumanNotes(file: CanvasFile, pageId?: string): number {
  return file.pages
    .filter((page) => !pageId || page.id === pageId)
    .reduce(
      (count, page) => count + page.doc.notes.filter((note) => note.author === "human").length,
      0,
    );
}
