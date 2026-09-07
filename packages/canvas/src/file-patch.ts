import { describeIssues } from "./issues.js";
import { applyCanvasDocPatch, type CanvasDocPatchOperation } from "./patch.js";
import {
  type CanvasFile,
  CanvasFileSchema,
  type CanvasPage,
  type PrototypeInteraction,
  type PrototypeTarget,
} from "./types.js";

export type CanvasFilePatchOperation =
  | {
      op: "page.update";
      pageId: string;
      changes: { title?: string; subtitle?: string | null };
    }
  | { op: "page.create"; page: Omit<CanvasPage, "order">; afterPageId?: string }
  | { op: "page.delete"; pageId: string }
  | { op: "pages.reorder"; pageIds: string[] }
  | { op: "page.doc.patch"; pageId: string; operations: CanvasDocPatchOperation[] }
  | { op: "prototype.start.set"; start: PrototypeTarget | null }
  | { op: "prototype.interaction.upsert"; interaction: PrototypeInteraction }
  | { op: "prototype.interaction.remove"; id: string };

export interface CanvasFilePatchResult {
  file: CanvasFile;
  affectedPageIds: string[];
}

function normalizedPages(pages: CanvasPage[]): CanvasPage[] {
  return pages.map((page, order) => ({ ...page, order }));
}

function pageIndex(file: CanvasFile, pageId: string): number {
  const index = file.pages.findIndex((page) => page.id === pageId);
  if (index < 0) throw new Error(`Unknown page id "${pageId}"`);
  return index;
}

/** Applies a mixed Page, CanvasDoc and prototype patch, then validates only the final file. */
export function applyCanvasFilePatch(
  source: CanvasFile,
  operations: CanvasFilePatchOperation[],
): CanvasFilePatchResult {
  if (operations.length === 0) throw new Error("CanvasFile patch has no operations");
  const file = structuredClone(source);
  const affected = new Set<string>();

  for (const operation of operations) {
    switch (operation.op) {
      case "page.update": {
        const index = pageIndex(file, operation.pageId);
        const page = file.pages[index] as CanvasPage;
        const title = operation.changes.title ?? page.title;
        const doc = {
          ...page.doc,
          title: operation.changes.title ?? page.doc.title,
          ...(operation.changes.subtitle === undefined
            ? {}
            : operation.changes.subtitle === null
              ? { subtitle: undefined }
              : { subtitle: operation.changes.subtitle }),
        };
        file.pages[index] = { ...page, title, doc };
        affected.add(page.id);
        break;
      }
      case "page.create": {
        if (file.pages.some((page) => page.id === operation.page.id))
          throw new Error(`Duplicate page id "${operation.page.id}"`);
        const insertion = operation.afterPageId
          ? pageIndex(file, operation.afterPageId) + 1
          : file.pages.length;
        const pages = [...file.pages];
        pages.splice(insertion, 0, { ...operation.page, order: insertion });
        file.pages = normalizedPages(pages);
        affected.add(operation.page.id);
        break;
      }
      case "page.delete": {
        pageIndex(file, operation.pageId);
        if (file.pages.length === 1) throw new Error("Cannot delete the final page");
        file.pages = normalizedPages(file.pages.filter((page) => page.id !== operation.pageId));
        if (file.defaultPageId === operation.pageId)
          file.defaultPageId = (file.pages[0] as CanvasPage).id;
        file.prototype = {
          start:
            file.prototype.start?.pageId === operation.pageId ? undefined : file.prototype.start,
          interactions: file.prototype.interactions.filter(
            (item) =>
              item.source.pageId !== operation.pageId &&
              item.destination.pageId !== operation.pageId,
          ),
        };
        affected.add(operation.pageId);
        break;
      }
      case "pages.reorder": {
        const current = new Set(file.pages.map((page) => page.id));
        const requested = new Set(operation.pageIds);
        if (
          requested.size !== operation.pageIds.length ||
          requested.size !== current.size ||
          [...current].some((id) => !requested.has(id))
        )
          throw new Error("pages.reorder must contain every page id exactly once");
        const byId = new Map(file.pages.map((page) => [page.id, page]));
        file.pages = operation.pageIds.map((id, order) => ({
          ...(byId.get(id) as CanvasPage),
          order,
        }));
        operation.pageIds.forEach((id) => {
          affected.add(id);
        });
        break;
      }
      case "page.doc.patch": {
        const index = pageIndex(file, operation.pageId);
        const page = file.pages[index] as CanvasPage;
        file.pages[index] = {
          ...page,
          doc: applyCanvasDocPatch(page.doc, operation.operations),
        };
        affected.add(page.id);
        break;
      }
      case "prototype.start.set":
        file.prototype = { ...file.prototype, start: operation.start ?? undefined };
        if (operation.start) affected.add(operation.start.pageId);
        break;
      case "prototype.interaction.upsert": {
        const interactions = [...file.prototype.interactions];
        const index = interactions.findIndex((item) => item.id === operation.interaction.id);
        if (index < 0) interactions.push(operation.interaction);
        else interactions[index] = operation.interaction;
        file.prototype = { ...file.prototype, interactions };
        affected.add(operation.interaction.source.pageId);
        affected.add(operation.interaction.destination.pageId);
        break;
      }
      case "prototype.interaction.remove": {
        const interactions = file.prototype.interactions.filter((item) => item.id !== operation.id);
        if (interactions.length === file.prototype.interactions.length)
          throw new Error(`Unknown prototype interaction "${operation.id}"`);
        file.prototype = { ...file.prototype, interactions };
        break;
      }
    }
  }

  const parsed = CanvasFileSchema.safeParse(file);
  if (!parsed.success)
    throw new Error(describeIssues(parsed.error, { value: file }) ?? "Invalid CanvasFile");
  return { file: parsed.data, affectedPageIds: [...affected] };
}
