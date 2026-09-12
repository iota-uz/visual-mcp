import { createHash } from "node:crypto";
import {
  CharacterAction,
  CharacterSceneProps,
  CharacterStage,
  VideoTimebase,
} from "@visual-canvas/video/character";
import {
  CharacterActionDefinition,
  canonicalActionDefinition,
  createProjectActionLibrary,
} from "@visual-canvas/video/character-action-library";
import {
  CharacterAudioPlan,
  compileCharacterAudioPlan,
} from "@visual-canvas/video/character-audio-plan";
import {
  type ChoreographyStep,
  compileCharacterChoreography,
} from "@visual-canvas/video/character-choreography";
import {
  CharacterDialoguePlan,
  compileCharacterDialogue,
  ElevenLabsAlignmentArtifact,
} from "@visual-canvas/video/character-dialogue";
import { migrateCharacterScene } from "@visual-canvas/video/character-migrations";
import { bakeProceduralAction } from "@visual-canvas/video/character-procedural";
import {
  CharacterQualityEvidence,
  CharacterRenderProfile,
  characterRenderDimensions,
  diagnoseCharacterQuality,
} from "@visual-canvas/video/character-quality";
import { z } from "zod";
import type { Definition } from "./registry.js";
import { VideoDomainError } from "./registry.js";

function authoring<T>(compile: () => T): T {
  try {
    return compile();
  } catch (error) {
    throw new VideoDomainError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Invalid character authoring input",
      "not_applied",
      {
        kind: "fix_input",
        fields: [
          {
            path: "/",
            reason: error instanceof Error ? error.message : "Invalid character authoring input",
          },
        ],
      },
    );
  }
}

const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = z.enum(["project", "shared"]);
const actionTemplate = z.record(z.string(), z.unknown());
const placement = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("at"), seconds: z.number().finite().nonnegative().max(2400) })
    .strict(),
  ...["after", "with"].map((kind) =>
    z
      .object({ kind: z.literal(kind), id, seconds: z.number().finite().nonnegative().max(2400) })
      .strict(),
  ),
]);
const choreographyInput = z
  .object({
    timebase: VideoTimebase,
    steps: z
      .array(
        z
          .object({
            id,
            actorId: id,
            durationSeconds: z.number().positive().max(2400).optional(),
            placement,
            holdSeconds: z.number().nonnegative().max(2400).default(0),
            action: actionTemplate,
          })
          .strict(),
      )
      .max(256),
    definitions: z.array(CharacterActionDefinition).max(64).default([]),
  })
  .strict();
const libraryScope = { workspace_id: id, scope, project_id: id.optional() };
const record = z.record(z.string(), z.unknown());
const definitions: Definition[] = [
  {
    name: "character_alignment_get",
    readOnly: true,
    description:
      "Read exact stored alignment JSON from a pinned voice job alignment asset. Verifies server-authorized bytes against requested SHA-256; never invents timing or sends audio to a provider. Use voice job output asset/hash, not an arbitrary URL.",
    input: z
      .object({
        workspace_id: id,
        asset: z.object({ assetId: id, revisionId: id }).strict(),
        sha256: hash,
      })
      .strict(),
    output: z.object({
      asset: z.object({ assetId: id, revisionId: id }),
      sha256: hash,
      artifact: ElevenLabsAlignmentArtifact,
    }),
    run: async (i, call) => {
      const signed = z
        .object({
          url: z.url(),
          sha256: hash,
          mimeType: z.literal("application/json"),
          sizeBytes: z
            .number()
            .int()
            .positive()
            .max(2 * 1024 * 1024),
        })
        .parse(await call("inspectAsset", { workspaceId: i.workspace_id, asset: i.asset }));
      if (signed.sha256 !== i.sha256)
        throw new VideoDomainError(
          "RESOURCE_CHANGED",
          "Alignment hash differs from requested immutable artifact",
        );
      const response = await fetch(signed.url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body)
        throw new VideoDomainError("RESOURCE_UNAVAILABLE", "Alignment bytes unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > signed.sizeBytes)
            throw new VideoDomainError("RESOURCE_CHANGED", "Alignment bytes exceed pinned size");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const bytes = Buffer.concat(chunks);
      if (
        size !== signed.sizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !== signed.sha256
      )
        throw new VideoDomainError(
          "RESOURCE_CHANGED",
          "Alignment bytes failed pinned size/hash verification",
        );
      const artifact = authoring(() =>
        ElevenLabsAlignmentArtifact.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        ),
      );
      return { asset: i.asset, sha256: signed.sha256, artifact };
    },
  },
  {
    name: "character_quality_check",
    readOnly: true,
    description:
      "Diagnose supplied renderer-evaluated sample bounds and text readability. Evidence must come from worker runCharacterQualityDiagnostics/evaluateCharacterQualityEvidence; arbitrary caller bounds are not verified render evidence. Conservative AABBs, not exact silhouettes; unsampled frames are not certified.",
    input: z.object({ scene: CharacterSceneProps, evidence: CharacterQualityEvidence }).strict(),
    output: z.unknown(),
    run: async (i) =>
      diagnoseCharacterQuality(
        CharacterSceneProps.parse(i.scene),
        CharacterQualityEvidence.parse(i.evidence),
      ),
  },
  {
    name: "character_render_profile",
    readOnly: true,
    description:
      "Resolve draft360/draft540/preview720/final1080 into even render dimensions preserving the scene aspect ratio. Does not dispatch rendering or mutate stage geometry.",
    input: z.object({ stage: CharacterStage, profile: CharacterRenderProfile }).strict(),
    output: z.object({ width: z.number(), height: z.number() }),
    run: async (i) =>
      characterRenderDimensions(
        CharacterStage.parse(i.stage),
        CharacterRenderProfile.parse(i.profile),
      ),
  },
  {
    name: "character_scene_validate",
    readOnly: true,
    description:
      "Validate revision-4 character AST before saving/rendering. Returns normalized strict scene and actionable schema issues; does not render or modify a project.",
    input: z.object({ scene: z.unknown() }).strict(),
    output: z.unknown(),
    run: async (i) => {
      const r = CharacterSceneProps.safeParse(i.scene);
      return r.success ? { valid: true, scene: r.data } : { valid: false, issues: r.error.issues };
    },
  },
  {
    name: "character_choreography_compile",
    readOnly: true,
    description:
      "Compile bounded seconds-based at/after/with/hold choreography and exact immutable compound action definitions to frame actions. Validate the assembled character scene afterwards.",
    input: choreographyInput,
    output: z.object({
      timebase: VideoTimebase,
      actionOrder: z.array(z.string()),
      actionsById: z.record(z.string(), CharacterAction),
    }),
    run: async (i) => {
      const data = choreographyInput.parse(i);
      for (const definition of data.definitions) {
        const actual = createHash("sha256")
          .update(canonicalActionDefinition(definition))
          .digest("hex");
        if (actual !== definition.revisionId)
          throw new Error(
            `Action ${definition.id} content does not match its immutable revisionId`,
          );
      }
      return compileCharacterChoreography(
        { timebase: data.timebase, steps: data.steps as ChoreographyStep[] },
        createProjectActionLibrary(data.definitions),
      );
    },
  },
  {
    name: "character_procedural_bake",
    readOnly: true,
    description:
      "Bake a restricted TypeScript arrow expression into deterministic numeric tracks. Only bounded math expressions; no arbitrary JS, loops, globals, filesystem or network. Output is data, never executable render code.",
    input: z
      .object({
        source: z.string().min(1).max(8192),
        actorId: id,
        startFrame: z.number().int().nonnegative(),
        durationFrames: z.number().int().min(1).max(7200),
        timebase: VideoTimebase,
        seed: z.number().int().min(0).max(0xffffffff),
        mode: z.enum(["override", "additive"]).optional(),
        priority: z.number().int().min(-100).max(100).optional(),
      })
      .strict(),
    output: CharacterAction,
    run: async (i) => bakeProceduralAction(i as Parameters<typeof bakeProceduralAction>[0]),
  },
  {
    name: "character_scene_migrate",
    readOnly: true,
    description:
      "Explicitly convert revision-3 character props to revision 4; no save or automatic migration. Review result and apply via video_timeline_patch with exact read revision.",
    input: z.object({ revision: z.string(), props: record }).strict(),
    output: z.object({ revision: z.literal("4"), props: record }),
    run: async (i) => {
      const migrated = migrateCharacterScene(i as Parameters<typeof migrateCharacterScene>[0]);
      CharacterSceneProps.parse(migrated.props);
      return migrated;
    },
  },
  {
    name: "character_dialogue_compile",
    readOnly: true,
    description:
      "Compile say dialogue using exact pinned audio and provider alignment into talk/viseme, gaze, listener and reaction actions. Does not synthesize speech or certify supplied timing provenance.",
    input: CharacterDialoguePlan,
    output: z.unknown(),
    run: async (i) => compileCharacterDialogue(i),
  },
  {
    name: "character_audio_compile",
    readOnly: true,
    description:
      "Compile a character dialogue audio plan into actual Timeline clips and audio_mix operation with measured speech-window music ducking, pinned inputs and SFX. No paid production or render is dispatched.",
    input: CharacterAudioPlan,
    output: z.unknown(),
    run: async (i) => compileCharacterAudioPlan(i),
  },
  {
    name: "character_action_register",
    readOnly: false,
    description:
      "Register an immutable project-local reusable action. Hash is computed from canonical id,label,content and verified by the backend. Explicit promotion is required for workspace sharing.",
    input: z
      .object({
        workspace_id: id,
        project_id: id,
        idempotency_key: id,
        definition: z
          .object({ id, label: z.string().min(1).max(120), content: z.unknown() })
          .strict(),
      })
      .strict(),
    output: record,
    run: async (i, call) => {
      const raw = i.definition as Omit<z.infer<typeof CharacterActionDefinition>, "revisionId">;
      const definition = authoring(() => {
        const revisionId = createHash("sha256")
          .update(canonicalActionDefinition(raw))
          .digest("hex");
        return CharacterActionDefinition.parse({ ...raw, revisionId });
      });
      return call("characterActionRegister", {
        workspaceId: i.workspace_id,
        projectId: i.project_id,
        idempotencyKey: i.idempotency_key,
        definition: JSON.stringify(definition),
      });
    },
  },
  {
    name: "character_action_promote",
    readOnly: false,
    description:
      "Explicitly promote one exact project-local action revision to this workspace's shared library. Preserves bytes/hash, never shares across workspaces or rewrites existing definitions.",
    input: z
      .object({ workspace_id: id, project_id: id, revision_id: hash, idempotency_key: id })
      .strict(),
    output: record,
    run: async (i, call) =>
      call("characterActionPromote", {
        workspaceId: i.workspace_id,
        projectId: i.project_id,
        revisionId: i.revision_id,
        idempotencyKey: i.idempotency_key,
      }),
  },
  {
    name: "character_action_get",
    readOnly: true,
    description:
      "Read one exact immutable action revision from project-local or workspace-shared scope; no implicit latest resolution.",
    input: z.object({ ...libraryScope, revision_id: hash }).strict(),
    output: record,
    run: async (i, call) =>
      call("characterActionGet", {
        workspaceId: i.workspace_id,
        scope: i.scope,
        ...(i.project_id ? { projectId: i.project_id } : {}),
        revisionId: i.revision_id,
      }),
  },
  {
    name: "character_action_list",
    readOnly: true,
    description:
      "List bounded immutable action revision summaries in one project or one workspace-shared library. Keep scope unchanged when continuing cursor.",
    input: z
      .object({
        ...libraryScope,
        cursor: z.string().max(16000).nullable().default(null),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
    output: record,
    run: async (i, call) =>
      call("characterActionList", {
        workspaceId: i.workspace_id,
        scope: i.scope,
        ...(i.project_id ? { projectId: i.project_id } : {}),
        paginationOpts: { cursor: i.cursor, numItems: i.limit },
      }),
  },
];
export const characterDefinitions: Definition[] = definitions.map((definition): Definition => {
  if (
    ![
      "character_choreography_compile",
      "character_procedural_bake",
      "character_scene_migrate",
      "character_dialogue_compile",
      "character_audio_compile",
    ].includes(definition.name)
  )
    return definition;
  const run = definition.run;
  return {
    ...definition,
    run: async (i, call) => {
      try {
        return await run(i, call);
      } catch (error) {
        return authoring(() => {
          throw error;
        });
      }
    },
  };
});
