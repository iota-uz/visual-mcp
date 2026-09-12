import type { CharacterPack, CharacterSceneProps } from "./character.js";

type Actor = CharacterSceneProps["actorsById"][string];
type Layout = CharacterSceneProps["staging"]["layout"];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Authored starting composition for vertical advertising scenes. It preserves
 * actor identity/acting data and only supplies geometry from pack bounds.
 */
export function stageCharacterActors(input: {
  layout: Layout;
  actorOrder: string[];
  actorsById: Record<string, Actor>;
  characterPacksById: Record<string, CharacterPack>;
  focalActorId?: string;
}): Record<string, Actor> {
  const result = structuredClone(input.actorsById);
  const entries = input.actorOrder
    .map((id) => {
      const actor = result[id];
      const pack = actor && input.characterPacksById[actor.characterPackId];
      return actor && pack ? { id, actor, pack } : undefined;
    })
    .filter((entry) => entry !== undefined);
  if (!entries.length) return result;

  if (input.layout === "two-shot") {
    const count = entries.length;
    const slotWidth = 0.86 / count;
    for (const [index, entry] of entries.entries()) {
      const targetHeight = count > 2 ? 520 : 650;
      const slotPixels = slotWidth * 1080;
      entry.actor.scale = clamp(
        Math.min(
          targetHeight / entry.pack.viewBox.height,
          (slotPixels * 0.78) / entry.pack.viewBox.width,
        ),
        0.1,
        2.8,
      );
      entry.actor.x = 0.07 + slotWidth * (index + 0.5);
      entry.actor.y = 0.72;
    }
  } else if (input.layout === "reaction-closeup") {
    if (entries.length > 3)
      throw new Error("reaction-closeup supports at most three visible actors");
    const focal = entries.find((entry) => entry.id === input.focalActorId) ?? entries[0]!;
    for (const entry of entries) {
      const isFocal = entry.id === focal.id;
      entry.actor.scale = clamp(
        Math.min(
          (isFocal ? 900 : 480) / entry.pack.viewBox.height,
          ((isFocal ? 0.84 : 0.22) * 1080) / entry.pack.viewBox.width,
        ),
        0.1,
        2.8,
      );
      entry.actor.x = isFocal ? 0.5 : entry.actor.x < 0.5 ? 0.13 : 0.87;
      entry.actor.y = isFocal ? 0.7 : 0.79;
    }
  } else {
    if (entries.length > 2) throw new Error("single-product supports at most two visible actors");
    // A single spokesperson remains the visual anchor while the top third is
    // reserved for price and product copy. A second actor becomes a sidecar.
    for (const [index, entry] of entries.entries()) {
      const singleHero = entries.length === 1;
      entry.actor.scale = clamp(
        Math.min(
          (singleHero ? 780 : 560) / entry.pack.viewBox.height,
          (singleHero ? 560 : 230) / entry.pack.viewBox.width,
        ),
        0.1,
        1.55,
      );
      const halfWidth = (entry.pack.viewBox.width * entry.actor.scale) / 2160;
      const halfHeight = (entry.pack.viewBox.height * entry.actor.scale) / 3840;
      entry.actor.x = singleHero ? 0.5 : index === 0 ? 0.04 + halfWidth : 0.96 - halfWidth;
      entry.actor.y = clamp(singleHero ? 0.72 : 0.61 + halfHeight, halfHeight, 0.975 - halfHeight);
    }
  }
  return result;
}
