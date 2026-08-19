import type { CanvasDoc } from "@visual-canvas/canvas";

/**
 * Geometry versions are reconciled in place. Everything else changes the
 * rendered structure and intentionally gets a fresh viewport.
 */
export function canvasViewportStructureKey(doc: CanvasDoc): string {
  return JSON.stringify({
    ...doc,
    nodes: doc.nodes.map(({ rect: _rect, ...node }) => node),
  });
}
