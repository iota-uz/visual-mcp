import type { CanvasFile, CanvasPage } from "@visual-canvas/canvas";

/** Updates node focus without dropping the independently addressable Page. */
export function withCanvasNodeSelection(
  currentSearch: string | URLSearchParams,
  nodeId: string | null,
): URLSearchParams {
  const next = new URLSearchParams(currentSearch);
  if (nodeId) next.set("node", nodeId);
  else next.delete("node");
  return next;
}

/** A requested Page is authoritative; never disguise a stale URL as Overview. */
export function resolveRequestedCanvasPage(
  file: CanvasFile,
  pageId?: string | null,
): CanvasPage | null {
  if (pageId) return file.pages.find((page) => page.id === pageId) ?? null;
  return (
    file.pages.find((page) => page.id === file.defaultPageId) ??
    [...file.pages].sort((left, right) => left.order - right.order)[0] ??
    null
  );
}
