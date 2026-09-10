import { AssetRef } from "@visual-canvas/video";
import { CritiquePolicy, JobRequest, JobState } from "@visual-canvas/video/jobs";
import { MediaOperation } from "@visual-canvas/video/operations";
import { MeasuredMediaMetadata } from "@visual-canvas/video/results";
import { z } from "zod";
import { type Definition, pageResult, snapshotQuery } from "./registry.js";

const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scope = {
  workspace_id: id,
  project_id: id.optional(),
  version_id: id.optional(),
  idempotency_key: id.describe(
    "Reuse the same key and unchanged input after transport uncertainty; a new key may charge again.",
  ),
};
const accepted = z
  .object({
    job_id: id,
    state: JobState,
    replayed: z.boolean(),
    poll_after_ms: z.number(),
    operation: z.object({ tool: z.string(), idempotency_key: id }).strict(),
  })
  .strict();
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
function receipt(value: unknown) {
  const row = record(value),
    operation = record(row.operation);
  return {
    job_id: row.jobId,
    state: row.state,
    replayed: row.replayed,
    poll_after_ms: row.pollAfterMs,
    operation: { tool: operation.toolName, idempotency_key: operation.idempotencyKey },
  };
}
function producer(
  name: string,
  kind: "image" | "voice" | "shot" | "render" | "critique",
  description: string,
  edit = false,
): Definition {
  const found = JobRequest.options.find((option) => option.shape.kind.value === kind);
  if (!found) throw new Error(`Missing shared job schema: ${kind}`);
  const schema: z.ZodObject<z.ZodRawShape> = found;
  const { kind: _kind, ...shape } = schema.shape;
  const request = z
    .object(shape)
    .strict()
    .superRefine((value, ctx) => {
      const canonical = schema.safeParse({ ...value, kind });
      if (!canonical.success)
        for (const issue of canonical.error.issues)
          ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
      if (kind !== "image") return;
      const input = record(value);
      if (edit && !input.source)
        ctx.addIssue({
          code: "custom",
          path: ["source"],
          message: "image_edit requires a pinned source AssetRef.",
        });
      if (!edit && (input.source || input.mask || input.editTarget))
        ctx.addIssue({
          code: "custom",
          path: ["source"],
          message: "Use image_edit to edit a source or advance an asset revision.",
        });
    });
  return {
    name,
    description,
    readOnly: false,
    input: z.object({ ...scope, request }).strict(),
    output: accepted,
    run: async (input, call) =>
      receipt(
        await call("submitJob", {
          workspaceId: input.workspace_id,
          ...(input.project_id ? { projectId: input.project_id } : {}),
          ...(input.version_id ? { versionId: input.version_id } : {}),
          idempotencyKey: input.idempotency_key,
          request: { ...record(input.request), kind },
        }),
      ),
  };
}

function operationSchema(kind: string) {
  const schema = MediaOperation.options.find((option) => option.shape.kind.value === kind);
  if (!schema) throw new Error(`Missing shared media operation schema: ${kind}`);
  return schema;
}
export const providerDefinitions: Definition[] = [
  {
    name: "video_inspect",
    readOnly: true,
    description:
      "Read registered metadata/hash and a temporary preview URL for an exact asset revision. Never probes, generates media or starts a job. metadata=null/absent fields mean not measured; request explicit QA/backfill rather than assuming zeros. Upload ready and provider input limits are separate.",
    input: z.object({ workspace_id: id, asset: AssetRef }).strict(),
    output: z
      .object({
        asset: AssetRef,
        name: z.string(),
        mime_type: z.string(),
        metadata: MeasuredMediaMetadata.nullable(),
        sha256: hash,
        size_bytes: z.number(),
        asset_ref: z.string(),
        preview_url: z.string().url(),
      })
      .strict(),
    run: async (input, call) => {
      const row = record(
        await call("inspectAsset", { workspaceId: input.workspace_id, asset: input.asset }),
      );
      return {
        asset: row.asset,
        name: row.name,
        mime_type: row.mimeType,
        metadata: row.mediaMetadata,
        sha256: row.sha256,
        size_bytes: row.sizeBytes,
        asset_ref: row.ref,
        preview_url: row.url,
      };
    },
  },
  ...(["frames", "proxy", "qa", "audio_mix", "compare"] as const).map(
    (kind): Definition => ({
      name: {
        frames: "video_frames",
        proxy: "video_proxy",
        qa: "video_qa",
        audio_mix: "audio_mix",
        compare: "video_compare",
      }[kind],
      description: {
        frames:
          "Extract exact requested frames and a contact sheet from pinned media; returns job receipt. Actual timestamps and sampling limitations are recorded. No semantic quality judgment.",
        proxy:
          "Create a bounded analysis proxy from pinned media; returns job receipt. Source hash, time range and sampling remain explicit; proxy analysis is not full-resolution coverage.",
        qa: "Decode pinned media and measure technical properties; returns job receipt. Unsupported checks are not_evaluated, not pass. For semantic judgments use video_critique.",
        compare:
          "Create a real side-by-side contact sheet from exactly two pinned media inputs at requested times. asset is A, additional_assets must contain B. Results retain both source hashes, sourceIndex and actual timestamps; this is a visual comparison artifact, not a semantic winner or approval.",
        audio_mix:
          "Mix pinned audio tracks with timeline offsets, trims, fades, scheduled voice-window ducking and measured mastering. asset is inputIndex 0; additional_assets map to indices 1 onward. Returns job receipt for WAV and measurement report; does not mutate a timeline.",
      }[kind],
      readOnly: false,
      input: z
        .object({
          ...scope,
          asset: AssetRef,
          additional_assets: z.array(AssetRef).max(15).optional(),
          operation: operationSchema(kind),
        })
        .strict(),
      output: accepted,
      run: async (input, call) =>
        receipt(
          await call("submitJob", {
            workspaceId: input.workspace_id,
            ...(input.project_id ? { projectId: input.project_id } : {}),
            ...(input.version_id ? { versionId: input.version_id } : {}),
            idempotencyKey: input.idempotency_key,
            request: {
              kind: "media",
              asset: input.asset,
              ...(input.additional_assets ? { additionalAssets: input.additional_assets } : {}),
              operation: input.operation,
            },
          }),
        ),
    }),
  ),
  {
    name: "job_reconcile",
    description:
      "Resume recovery of a known provider/persistence receipt without another paid generation POST. Only recoverable jobs qualify; absence of a receipt is not permission to resubmit. Poll job_get after admission.",
    readOnly: false,
    input: z.object({ job_id: id }).strict(),
    output: z.object({ job_id: id, state: JobState }).strict(),
    run: async (input, call) => {
      const row = record(await call("reconcileJob", { jobId: input.job_id }));
      return { job_id: row.jobId, state: row.state };
    },
  },
  {
    name: "asset_upload_status",
    description:
      "Read a reserved upload's verification state and expected exact bytes/hash without changing it. ready returns a pinned asset; other states do not authorize downstream consumption. Use asset_upload_finalize after PUT.",
    readOnly: true,
    input: z.object({ upload_id: id }).strict(),
    output: z
      .object({
        workspace_id: id,
        state: z.string(),
        expires_at: z.number(),
        asset: AssetRef.nullable(),
        sha256: hash,
        size_bytes: z.number(),
        mime_type: z.string(),
      })
      .strict(),
    run: async (input, call) => {
      const row = record(await call("getUpload", { uploadId: input.upload_id }));
      return {
        workspace_id: row.workspaceId,
        state: row.state,
        expires_at: row.expiresAt,
        asset: row.asset,
        sha256: row.sha256,
        size_bytes: row.sizeBytes,
        mime_type: row.mimeType,
      };
    },
  },
  producer(
    "image_generate",
    "image",
    "Create images with server OpenAI; returns a job receipt, poll job_get. Paid: request.allowPaid must be true. No video project required. Codex should prefer its built-in image generation and upload the resulting bytes when suitable. References guide generation; use image_edit for a pinned source edit.",
  ),
  producer(
    "image_edit",
    "image",
    "Edit a pinned source image with server OpenAI. Paid; poll job_get. Optional editTarget performs compare-and-swap of an existing asset head; source alone creates a new asset. Never silently rebase a stale edit. References and mask are pinned AssetRefs.",
    true,
  ),
  producer(
    "voice_generate",
    "voice",
    "Generate speech and alignment with server ElevenLabs. Select voiceId via voice_list. Paid; poll job_get. RU/UZ pronunciation is not human-verified. Required alignment failure is explicit, never invented timestamps.",
  ),
  producer(
    "video_shot_generate",
    "shot",
    "Generate one cinematic shot through a server Higgsfield profile from pinned startImage and exact draft/script/scene/shot. Paid; profile availability is not guaranteed. The result is a reusable asset, not a timeline edit or Remotion render.",
  ),
  producer(
    "video_render",
    "render",
    "Render an immutable checkpoint with trusted Remotion timeline; poll job_get for MP4/poster/captions. final is quality, not human approval. For loop measurement evidence pass both rubricHash and rubricPolicy from video_rubric_resolve. Range renders are partial and cannot stand in for a full final.",
  ),
  producer(
    "video_critique",
    "critique",
    "Evaluate a pinned video through server Gemini with brief and explicit criteria; paid. Poll job_get for exact artifact/report hashes, coverage, findings and blocking uncertainty. Pass does not mean human approval or guaranteed reach. Use video_rubric_resolve to share the same evaluation policy with render.",
  ),
  {
    name: "video_rubric_resolve",
    description:
      "Resolve criterion defaults and compute the canonical evaluation policy hash. Pass returned policy and rubric_hash unchanged to video_render request.rubricPolicy/rubricHash, and the same policy fields to video_critique. No provider call or quality claim.",
    readOnly: true,
    input: CritiquePolicy,
    output: z
      .object({
        policy: CritiquePolicy,
        policy_version: z.literal("video-critique-policy-v1"),
        rubric_hash: hash,
      })
      .strict(),
    run: async (input, call) => {
      const row = record(await call("resolveRubric", input));
      return { policy: row.policy, policy_version: row.policyVersion, rubric_hash: row.rubricHash };
    },
  },
  {
    name: "voice_list",
    description:
      "Read configured ElevenLabs account voices; does not generate speech. Opaque cursor uses the same query and limit. Language quality requires listening; names and labels are not evidence of RU/UZ pronunciation.",
    readOnly: true,
    input: z
      .object({
        query: z.string().max(200).optional(),
        cursor: z.string().max(2000).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    output: z
      .object({
        voices: z.array(
          z
            .object({
              voiceId: id,
              name: z.string(),
              description: z.string().nullable(),
              previewUrl: z.string().nullable(),
              labels: z.record(z.string(), z.string()),
              languageQuality: z.literal("not_human_verified"),
            })
            .strict(),
        ),
        next_cursor: z.string().nullable(),
        complete: z.boolean(),
      })
      .strict(),
    run: async (input, call) => {
      const result = pageResult(
        await snapshotQuery(call, "listVoices", {}, input, "voices"),
        (value) => value,
        input,
        "voices",
      );
      return { voices: result.items, next_cursor: result.next_cursor, complete: result.complete };
    },
  },
  {
    name: "asset_upload_reserve",
    description:
      "Reserve upload of exact bytes to the existing object store. Maximum 2 GB = 2,000,000,000 bytes. PUT locally with curl using returned URL/headers, then call asset_upload_finalize. Do not put secrets into metadata. Repeating the same key recovers the same reservation; URL is temporary and is not an AssetRef.",
    readOnly: false,
    input: z
      .object({
        workspace_id: id,
        idempotency_key: id,
        filename: z.string().min(1).max(500),
        mime_type: z.string().min(1).max(200),
        size_bytes: z.number().int().positive().max(2_000_000_000),
        sha256: hash,
        source: z.enum(["upload", "codex-imagegen"]),
      })
      .strict(),
    output: z
      .object({
        upload_id: id,
        state: z.string(),
        expires_at: z.number(),
        asset: AssetRef.optional(),
        upload: z
          .object({
            method: z.literal("PUT"),
            url: z.string().url(),
            headers: z.record(z.string(), z.string()),
            maxBytes: z.number(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    run: async (input, call) => {
      const row = record(
        await call("prepareUpload", {
          workspaceId: input.workspace_id,
          idempotencyKey: input.idempotency_key,
          filename: input.filename,
          mimeType: input.mime_type,
          sizeBytes: input.size_bytes,
          sha256: input.sha256,
          source: input.source,
        }),
      );
      return {
        upload_id: row.uploadId,
        state: row.state,
        expires_at: row.expiresAt,
        ...(row.asset ? { asset: row.asset } : {}),
        ...(row.upload ? { upload: row.upload } : {}),
      };
    },
  },
  {
    name: "asset_upload_finalize",
    description:
      "Start or poll hash/type/size verification for an uploaded reservation. Safe to repeat upload_id. verifying is not ready: use only the returned ready AssetRef in downstream tools. Failed verification never registers unchecked bytes.",
    readOnly: false,
    input: z.object({ upload_id: id }).strict(),
    output: z
      .object({
        state: z.enum(["reserved", "verifying", "ready", "failed"]),
        asset: AssetRef.nullable(),
      })
      .strict(),
    run: (input, call) => call("finalizeUpload", { uploadId: input.upload_id }),
  },
];
