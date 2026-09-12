export type CharacterSceneRevision3 = Readonly<{ revision: "3"; props: Record<string, unknown> }>;
export type CharacterSceneRevision4 = Readonly<{ revision: "4"; props: Record<string, unknown> }>;
const emotionNames = [
  "neutral",
  "happy",
  "shocked",
  "thinking",
  "sad",
  "worried",
  "angry",
  "confused",
  "skeptical",
  "excited",
  "confident",
  "proud",
  "relieved",
  "determined",
] as const;

/** Explicit pure conversion. Callers choose when to persist the returned revision. */
export function migrateCharacterSceneRevision3To4(
  input: CharacterSceneRevision3,
): CharacterSceneRevision4 {
  if (
    !input ||
    input.revision !== "3" ||
    !input.props ||
    typeof input.props !== "object" ||
    Array.isArray(input.props)
  )
    throw new Error("Expected character scene revision 3");
  const props = structuredClone(input.props);
  props.stage = { aspect: "9:16", width: 1080, height: 1920 };
  props.cameraSequence = [];
  props.effects = [];
  const packs = props.characterPacksById;
  if (packs && typeof packs === "object" && !Array.isArray(packs))
    for (const pack of Object.values(packs)) {
      if (!pack || typeof pack !== "object" || Array.isArray(pack)) continue;
      const expressions = (pack as Record<string, unknown>).expressions;
      if (!expressions || typeof expressions !== "object" || Array.isArray(expressions)) continue;
      const values = expressions as Record<string, unknown>;
      if (!values.neutral) throw new Error("Revision 3 pack is missing its neutral expression");
      for (const emotion of emotionNames)
        if (!values[emotion]) values[emotion] = structuredClone(values.neutral);
    }
  return { revision: "4", props };
}

export function migrateCharacterScene(input: {
  revision: string;
  props: Record<string, unknown>;
}): CharacterSceneRevision4 {
  if (input.revision === "3")
    return migrateCharacterSceneRevision3To4(input as CharacterSceneRevision3);
  throw new Error(
    `No explicit character scene migration from revision ${input.revision} to revision 4`,
  );
}
