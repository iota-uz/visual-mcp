import { type CanvasDoc, CanvasDocSchema } from "./types.js";

type CollectionName = "lanes" | "stages" | "labels" | "nodes" | "edges";

export type CanvasDocPatchOperation =
  | { op: "world.update"; changes: Partial<CanvasDoc["world"]> }
  | { op: `${CollectionName}.add`; value: unknown }
  | { op: `${CollectionName}.update`; id: string; changes: Record<string, unknown> }
  | { op: `${CollectionName}.remove`; id: string };

function collectionFor(op: string): CollectionName {
  const collection = op.split(".")[0];
  if (!collection || !["lanes", "stages", "labels", "nodes", "edges"].includes(collection)) {
    throw new Error(`Unsupported CanvasDoc patch operation: ${op}`);
  }
  return collection as CollectionName;
}

export function applyCanvasDocPatch(
  source: CanvasDoc,
  operations: CanvasDocPatchOperation[],
): CanvasDoc {
  if (operations.length === 0) throw new Error("CanvasDoc patch has no operations");
  let doc: CanvasDoc = structuredClone(source);
  for (const operation of operations) {
    if (operation.op === "world.update") {
      doc = { ...doc, world: { ...doc.world, ...operation.changes } };
      continue;
    }
    const collection = collectionFor(operation.op);
    const values = [...doc[collection]] as Array<{ id: string } & Record<string, unknown>>;
    if (operation.op.endsWith(".add")) {
      const value = (operation as { value: unknown }).value;
      values.push(value as { id: string } & Record<string, unknown>);
    } else {
      const { id } = operation as { id: string };
      const index = values.findIndex((value) => value.id === id);
      if (index < 0) throw new Error(`Unknown ${collection} id "${id}"`);
      if (operation.op.endsWith(".remove")) values.splice(index, 1);
      else {
        const changes = (operation as { changes: Record<string, unknown> }).changes;
        values[index] = { ...values[index], ...changes } as { id: string } & Record<
          string,
          unknown
        >;
      }
    }
    doc = { ...doc, [collection]: values } as CanvasDoc;
  }
  return CanvasDocSchema.parse(doc);
}
