import type { CanvasPrototype } from "./types.js";

export interface PrototypeNodeFlags {
  /** The node has at least one hotspot leading somewhere: it is playable. */
  interactive: boolean;
  /** The node is where a presentation begins. */
  start: boolean;
}

/**
 * Which nodes on one page take part in the prototype. Pure so the renderer
 * can badge nodes on every surface — editor, static export — without a
 * viewport, and so the badge logic has one home rather than one per caller.
 */
export function prototypeNodeFlags(
  prototype: CanvasPrototype | undefined,
  pageId: string,
): Map<string, PrototypeNodeFlags> {
  const flags = new Map<string, PrototypeNodeFlags>();
  if (!prototype) return flags;
  const mark = (nodeId: string, patch: Partial<PrototypeNodeFlags>) => {
    const current = flags.get(nodeId) ?? { interactive: false, start: false };
    flags.set(nodeId, { ...current, ...patch });
  };
  for (const interaction of prototype.interactions) {
    if (interaction.source.pageId === pageId)
      mark(interaction.source.nodeId, { interactive: true });
  }
  if (prototype.start?.pageId === pageId) mark(prototype.start.nodeId, { start: true });
  return flags;
}

/** Class names the renderer puts on `.vc-node` for a node's flags. */
export function prototypeNodeClasses(flags: PrototypeNodeFlags | undefined): string {
  if (!flags) return "";
  return `${flags.interactive ? " is-interactive" : ""}${flags.start ? " is-prototype-start" : ""}`;
}
