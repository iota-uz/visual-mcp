import { describeIssues } from "./issues.js";
import { type CanvasDoc, CanvasDocSchema } from "./types.js";

type CollectionName = "lanes" | "stages" | "labels" | "nodes" | "groups" | "edges";

export type CanvasDocPatchOperation =
  | { op: "world.update"; changes: Partial<CanvasDoc["world"]> }
  | { op: `${CollectionName}.add`; value: unknown }
  | {
      op: `${CollectionName}.update`;
      /** A `null` value clears an optional field; nothing else can unset one. */
      changes: Record<string, unknown>;
      id: string;
    }
  | { op: `${CollectionName}.replace`; id: string; value: unknown }
  | { op: `${CollectionName}.remove`; id: string };

function collectionFor(op: string): CollectionName {
  const collection = op.split(".")[0];
  if (
    !collection ||
    !["lanes", "stages", "labels", "nodes", "groups", "edges"].includes(collection)
  ) {
    throw new Error(`Unsupported CanvasDoc patch operation: ${op}`);
  }
  return collection as CollectionName;
}

/*
 * A shallow merge cannot express "and drop this field", which matters more
 * than it sounds: switching an iframe node to a `device` preset means giving
 * the preset its viewport back, and an update that can only ever *set* keys
 * left the stale one in place and failed validation with no way out but
 * `replace`. `null` is the one value the schemas reject everywhere, so it is
 * free to mean "unset".
 */
function applyChanges(
  entity: { id: string } & Record<string, unknown>,
  changes: Record<string, unknown>,
): { id: string } & Record<string, unknown> {
  const next = { ...entity } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as { id: string } & Record<string, unknown>;
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
      else if (operation.op.endsWith(".replace")) {
        const value = (operation as { value: unknown }).value as Record<string, unknown>;
        values[index] = { ...value, id } as { id: string } & Record<string, unknown>;
      } else {
        const changes = (operation as { changes: Record<string, unknown> }).changes;
        const current = values[index] as { id: string } & Record<string, unknown>;
        values[index] = applyChanges(current, changes);
      }
    }
    doc = { ...doc, [collection]: values } as CanvasDoc;
  }
  const parsed = CanvasDocSchema.safeParse(doc);
  if (!parsed.success) {
    // The patched graph is the only place the offending entity's id exists —
    // zod reports an array index, and the caller addressed it by id.
    throw new Error(describeIssues(parsed.error, { value: doc }) ?? "Invalid CanvasDoc");
  }
  return parsed.data;
}
