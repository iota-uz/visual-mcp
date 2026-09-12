import { z } from "zod";
import { CharacterAction } from "./character.js";

const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const CharacterActionReference = z
  .object({ id: Key, revisionId: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
export type CharacterActionReference = z.infer<typeof CharacterActionReference>;

export type CharacterActionTemplate = Omit<
  z.input<typeof CharacterAction>,
  "actorId" | "startFrame" | "durationFrames"
>;

const Seconds = z.number().finite().min(0).max(2400);
const ActionTemplate = z.record(z.string(), z.unknown()).superRefine((action, ctx) => {
  const result = CharacterAction.safeParse({
    ...action,
    actorId: "ValidationActor",
    startFrame: 0,
    durationFrames: 1,
  });
  if (!result.success) ctx.addIssue({ code: "custom", message: result.error.message });
});
export const CharacterActionDefinitionContent = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("single"),
      durationSeconds: Seconds.positive(),
      action: ActionTemplate,
    })
    .strict(),
  z
    .object({
      kind: z.literal("sequence"),
      durationSeconds: Seconds.positive(),
      actions: z
        .array(
          z
            .object({
              id: Key,
              atSeconds: Seconds,
              durationSeconds: Seconds.positive(),
              action: ActionTemplate,
            })
            .strict(),
        )
        .min(1)
        .max(64),
    })
    .strict()
    .superRefine((content, ctx) => {
      if (new Set(content.actions.map((action) => action.id)).size !== content.actions.length)
        ctx.addIssue({
          code: "custom",
          path: ["actions"],
          message: "Sequence child IDs must be unique",
        });
      for (const [index, action] of content.actions.entries())
        if (action.atSeconds + action.durationSeconds > content.durationSeconds)
          ctx.addIssue({
            code: "custom",
            path: ["actions", index],
            message: "Sequence child must fit inside definition duration",
          });
    }),
]);
export type CharacterActionDefinitionContent = z.infer<typeof CharacterActionDefinitionContent>;

export const CharacterActionDefinition = z
  .object({
    id: Key,
    revisionId: z.string().regex(/^[0-9a-f]{64}$/),
    label: z.string().trim().min(1).max(120),
    content: CharacterActionDefinitionContent,
  })
  .strict();
export type CharacterActionDefinition = z.infer<typeof CharacterActionDefinition>;

/** JSON-only immutable library snapshot. It is safe to persist as project-local data. */
export type CharacterActionLibrarySnapshot = Readonly<{
  scope: "project" | "shared";
  definitions: Readonly<Record<string, CharacterActionDefinition>>;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

/** Bytes hashed by persistence as SHA-256; scope/revisionId are deliberately excluded. */
export function canonicalActionDefinition(
  definition: Pick<CharacterActionDefinition, "id" | "label" | "content">,
): string {
  const { id, label, content } = definition;
  const parsed = CharacterActionDefinition.omit({ revisionId: true }).parse({ id, label, content });
  return JSON.stringify(canonicalize(parsed));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function createProjectActionLibrary(
  definitions: readonly CharacterActionDefinition[],
): CharacterActionLibrarySnapshot {
  const records: Record<string, CharacterActionDefinition> = {};
  for (const raw of definitions) {
    const definition = CharacterActionDefinition.parse(clone(raw));
    const ref = CharacterActionReference.parse({
      id: definition.id,
      revisionId: definition.revisionId,
    });
    if (records[ref.id]) throw new Error(`Duplicate action definition ID: ${ref.id}`);
    records[ref.id] = definition;
  }
  return deepFreeze({ scope: "project", definitions: records });
}

/** Promotion is explicit and returns a detached snapshot; callers persist it separately. */
export function promoteActionLibraryToShared(
  project: CharacterActionLibrarySnapshot,
): CharacterActionLibrarySnapshot {
  if (project.scope !== "project") throw new Error("Only a project-local library can be promoted");
  return deepFreeze({ scope: "shared", definitions: clone(project.definitions) });
}

/** Expands only an exact frozen revision; there is no implicit latest-version lookup. */
export function expandActionReference(
  library: CharacterActionLibrarySnapshot,
  reference: CharacterActionReference,
): CharacterActionDefinitionContent {
  const ref = CharacterActionReference.parse(reference);
  const found = library.definitions[ref.id];
  if (!found) throw new Error(`Unknown action definition: ${ref.id}`);
  if (found.revisionId !== ref.revisionId)
    throw new Error(
      `Action revision mismatch for ${ref.id}: requested ${ref.revisionId}, snapshot has ${found.revisionId}`,
    );
  return deepFreeze(clone(found.content));
}
