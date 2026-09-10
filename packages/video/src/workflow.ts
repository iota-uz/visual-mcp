import { z } from "zod";
import { AssetRef, Language } from "./contracts.js";

const Text = z.string().trim().min(1).max(16000);
export const WorkflowHash = z.string().regex(/^[a-f0-9]{64}$/);
export const WorkflowRole = z.enum([
  "writer",
  "director",
  "image_artist",
  "voice_editor",
  "video_editor",
  "critic",
  "reviewer",
]);
export const ProfileEntry = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    kind: z.enum(["fact", "preference", "pronunciation", "reference", "author_rationale"]),
    statement: Text.nullable(),
    status: z.enum(["sourced", "hypothesis", "unknown"]),
    source: z
      .object({ reference: Text, attribution: Text, asset: AssetRef, sha256: WorkflowHash })
      .strict()
      .nullable(),
    assets: z.array(AssetRef).max(20),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.status === "unknown") !== (v.statement === null))
      c.addIssue({
        code: "custom",
        message: "Unknown must have null statement; other statuses require a statement",
      });
    if (v.status === "sourced" && !v.source)
      c.addIssue({
        code: "custom",
        message:
          "Sourced means attributed, not independently verified; requires registered source bytes",
      });
  });
export const WorkflowProfile = z
  .object({
    name: Text,
    brand: z.literal("farq.uz"),
    language: Language.nullable(),
    versionId: z.string().min(1).nullable(),
    sceneIds: z.array(z.string().min(1)).max(100),
    entries: z.array(ProfileEntry).max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.sceneIds.length && !v.versionId)
      c.addIssue({ code: "custom", message: "Scene scope requires exact version" });
    if (new Set(v.entries.map((e) => e.key)).size !== v.entries.length)
      c.addIssue({ code: "custom", message: "Entry keys must be unique" });
  });
export const WorkflowEvaluation = z
  .object({
    rubricHash: WorkflowHash,
    workflowHash: WorkflowHash,
    successCriteria: z.array(Text).min(1).max(30),
    preserve: z.array(Text).max(30),
  })
  .strict();
export const WorkflowChange = z
  .object({
    sceneIds: z.array(z.string().min(1)).min(1).max(100),
    shotIds: z.array(z.string().min(1)).max(100).default([]),
    description: Text,
    expectedEffect: Text,
  })
  .strict();
/** Trusted provider/worker actions register these receipts; agent-written text cannot pass a gate. */
export const WorkflowEvidence = z
  .object({
    jobId: z.string().min(1),
    versionId: z.string().min(1),
    artifact: AssetRef,
    artifactSha256: WorkflowHash,
    report: AssetRef,
    reportSha256: WorkflowHash,
    rubricHash: WorkflowHash,
    method: z.enum(["measurement", "provider_video"]),
    outcome: z.enum(["pass", "fail", "uncertain"]),
    observation: Text,
    uncertainty: z.array(Text).max(30),
    coverage: z
      .object({
        startMs: z.number().nonnegative(),
        endMs: z.number().positive(),
        samplingFps: z.number().positive().nullable(),
        limitations: z.array(Text).max(30),
      })
      .strict()
      .refine((v) => v.endMs > v.startMs),
  })
  .strict();
