import {
  CharacterAction,
  CharacterPack,
  CharacterSceneProps,
} from "@visual-canvas/video/character";
import { CharacterActionDefinition } from "@visual-canvas/video/character-action-library";
import { CharacterAudioPlan } from "@visual-canvas/video/character-audio-plan";
import * as catalog from "@visual-canvas/video/character-catalog";
import { CharacterDialoguePlan } from "@visual-canvas/video/character-dialogue";
import { builtInCharacterPacks } from "@visual-canvas/video/registry";
import { z } from "zod";
import type { DomainResource } from "./registry.js";

const guide = {
  revision: "4",
  workflow: [
    "Read video_project_get and video_timeline_get before mutations. Source of truth is strict JSON AST.",
    "Read character catalog and schemas; clone presets before customizing. Stage width/height must match video format.",
    "Author seconds via character_choreography_compile; at/after/with place actions, hold extends only placement anchor.",
    "Use voice_list then voice_generate only with explicit paid permission. Poll exact job_get; load pinned audio + provider alignment. Never invent timestamps.",
    "character_dialogue_compile creates mouth, gaze and listening actions; character_audio_compile produces actual timeline audio and ducking plan.",
    "Use character_procedural_bake only for restricted math curves. Reuse compound actions with character_action_register/get and exact content hash. Promotion to workspace library is explicit.",
    "character_scene_validate before video_timeline_patch (read revision CAS). video_checkpoint pins source; video_render creates actual media. Existing media_process frame/contact_sheet operations inspect it.",
    "Review exact video, patch only affected scene/action, rerender. Schema success, critic pass and human approval are distinct.",
    "Old revision 3 is migrated explicitly using character_scene_migrate, then patched; no hidden migration or unsupported-version renderer.",
  ],
  proceduralExample: '(t, ctx) => ({ "head.rotation": sin(t * 6) * 5 })',
  compoundDefinitionExample: {
    id: "considerThenNod",
    label: "Consider then agree",
    content: {
      kind: "sequence",
      durationSeconds: 1.8,
      actions: [
        {
          id: "consider",
          atSeconds: 0,
          durationSeconds: 0.8,
          action: { type: "gesture", preset: "think" },
        },
        {
          id: "agree",
          atSeconds: 1,
          durationSeconds: 0.8,
          action: { type: "gesture", preset: "nod" },
        },
      ],
    },
  },
  limits: {
    procedural:
      "Math-only arrow expressions compiled to bounded AST and max 64 keyframe samples. Not general TypeScript or a JS sandbox.",
    alignment:
      "Character timing heuristic, not phoneme recognition. Supplied hashes pin inputs; audiovisual quality requires listening.",
    renderer: "Pure data-driven 2D SVG; no anatomical walk cycles, cloth, physics or 3D backend.",
  },
};
const jsonResource = (
  uri: string,
  name: string,
  description: string,
  data: unknown,
): DomainResource => ({
  uri,
  name,
  description,
  mimeType: "application/json",
  read: async () => ({
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }],
  }),
});
export const characterResources: DomainResource[] = [
  jsonResource(
    "video://presets/character-packs/4",
    "Character pack catalog",
    "Complete immutable-ready built-in rig packs: official Farq and two generic customers. Copy selected pack data into the canonical scene, preserving sourceAsset and fixed orientation.",
    builtInCharacterPacks,
  ),
  jsonResource(
    "video://guides/character-engine/4",
    "Character engine authoring workflow",
    "Semantic animation, dialogue, immutable action reuse and review loop; bounded procedural escape hatch examples.",
    guide,
  ),
  jsonResource(
    "video://guides/character-schemas/4",
    "Character engine schemas",
    "Strict rev4 character scene, rig pack, actions, immutable compound definition, dialogue and audio plan schemas.",
    {
      scene: z.toJSONSchema(CharacterSceneProps),
      pack: z.toJSONSchema(CharacterPack),
      action: z.toJSONSchema(CharacterAction),
      definition: z.toJSONSchema(CharacterActionDefinition),
      dialogue: z.toJSONSchema(CharacterDialoguePlan),
      audio: z.toJSONSchema(CharacterAudioPlan),
    },
  ),
  jsonResource(
    "video://presets/character-catalog/4",
    "Character background and prop catalog",
    "Cloneable background and prop presets; same generic renderer at all aspect ratios.",
    catalog,
  ),
];
