import { z } from "zod";
import { AssetRef } from "./refs.js";
import { ComponentSource, componentTimingIssues, Effect } from "./registry.js";

export { AssetRef, ResourceRef } from "./refs.js";

export const Language = z.enum(["ru", "uz"]);
const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Text = z.string().max(16000);
export const Format = z
  .object({
    width: z.number().int().min(160).max(3840),
    height: z.number().int().min(160).max(3840),
    fps: z
      .object({
        numerator: z.number().int().min(1).max(60000),
        denominator: z.number().int().min(1).max(1001),
      })
      .strict(),
    plannedDurationMs: z
      .number()
      .int()
      .positive()
      .max(1200000)
      .optional()
      .describe(
        "Planning hint used only to initialize a new timeline; actual duration is always derived from timeline.durationFrames and fps",
      ),
  })
  .strict();
export const Brief = z
  .object({
    topic: Text.min(1),
    direction: Text.min(1),
    audience: Text.optional(),
    objective: Text.optional(),
    callToAction: Text.optional(),
    mustInclude: z.array(Text).max(100).default([]),
    mustAvoid: z.array(Text).max(100).default([]),
  })
  .strict();
const Shot = z
  .object({
    purpose: Text,
    method: z.enum(["remotion", "higgsfield", "recording"]),
    subjectAction: Text,
    cameraMotion: Text,
    durationMs: z.number().int().positive().max(30000).optional(),
    editHandlesMs: z
      .object({
        before: z.number().int().min(0).max(5000),
        after: z.number().int().min(0).max(5000),
      })
      .strict()
      .optional(),
    constraints: z.array(Text).max(100).default([]),
    startImage: AssetRef.optional(),
    selectedVideo: AssetRef.optional(),
    selectedVideoReason: z.string().max(4000).optional(),
    selectedVideoJobId: z.string().min(1).optional(),
  })
  .strict();
const Scene = z
  .object({
    purpose: Text,
    narration: Text,
    onScreenText: z.array(Text).max(100),
    visual: z
      .object({
        description: Text,
        shot: Text,
        motion: Text,
        continuityNotes: Text.optional(),
        keyframeOrder: z.array(Key).max(100).default([]),
        keyframesById: z
          .record(
            Key,
            z
              .object({
                position: z.enum(["start", "middle", "end"]),
                prompt: Text,
                references: z.array(AssetRef).max(20),
                selectedImage: AssetRef.optional(),
              })
              .strict(),
          )
          .default({}),
      })
      .strict(),
    shotOrder: z.array(Key).max(100),
    shotsById: z.record(Key, Shot),
    claims: z
      .array(
        z
          .object({
            text: Text,
            evidenceIds: z.array(z.string()).max(100),
            status: z.enum(["supported", "unverified"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
function ordered(order: string[], records: Record<string, unknown>) {
  return (
    new Set(order).size === order.length &&
    order.length === Object.keys(records).length &&
    order.every((id) => Object.hasOwn(records, id))
  );
}
export const Script = z
  .object({
    language: Language,
    writingSystem: z.enum(["cyrillic", "latin"]),
    title: Text,
    premise: Text,
    sceneOrder: z.array(Key).max(100),
    scenesById: z.record(Key, Scene),
  })
  .strict()
  .superRefine((s, c) => {
    if (!ordered(s.sceneOrder, s.scenesById))
      c.addIssue({
        code: "custom",
        path: ["sceneOrder"],
        message: "Order must contain every scene exactly once",
      });
    for (const [id, scene] of Object.entries(s.scenesById)) {
      if (!ordered(scene.visual.keyframeOrder, scene.visual.keyframesById))
        c.addIssue({
          code: "custom",
          path: ["scenesById", id, "visual", "keyframeOrder"],
          message: "Order must contain every keyframe exactly once",
        });
      if (!ordered(scene.shotOrder, scene.shotsById))
        c.addIssue({
          code: "custom",
          path: ["scenesById", id, "shotOrder"],
          message: "Order must contain every shot exactly once",
        });
    }
  });
const Clip = z
  .object({
    sceneId: Key.optional(),
    shotId: Key.optional(),
    startFrame: z.number().int().nonnegative(),
    durationFrames: z.number().int().positive(),
    layout: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
        fit: z.enum(["cover", "contain"]),
      })
      .strict()
      .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1)
      .optional(),
    audio: z
      .object({
        gainDb: z.number().min(-60).max(18),
        fadeInMs: z.number().int().min(0).max(1200000),
        fadeOutMs: z.number().int().min(0).max(1200000),
      })
      .strict()
      .optional(),
    motion: z.enum(["static", "push-in", "pull-out"]).optional(),
    effects: z.array(Effect).max(8).optional(),
    source: z.discriminatedUnion("kind", [
      ComponentSource,
      z
        .object({
          kind: z.literal("asset"),
          asset: AssetRef,
          sourceStartMs: z.number().int().nonnegative().optional(),
          sourceEndMs: z.number().int().positive().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("text"),
          text: Text,
          style: z
            .object({
              fontSize: z.number().min(8).max(500).optional(),
              color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .optional(),
              fontFamily: z.enum(["sans-serif", "serif", "monospace"]).optional(),
              textAlign: z.enum(["left", "center", "right"]).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export const Timeline = z
  .object({
    fps: Format.shape.fps,
    durationFrames: z.number().int().min(1).max(72000),
    trackOrder: z.array(Key).max(32),
    tracksById: z.record(
      Key,
      z
        .object({
          kind: z.enum(["visual", "voice", "music", "sfx", "caption"]),
          clipOrder: z.array(Key).max(500),
          clipsById: z.record(Key, Clip),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((t, c) => {
    if (!ordered(t.trackOrder, t.tracksById))
      c.addIssue({
        code: "custom",
        path: ["trackOrder"],
        message: "Order must contain every track exactly once",
      });
    for (const [id, track] of Object.entries(t.tracksById)) {
      if (!ordered(track.clipOrder, track.clipsById))
        c.addIssue({
          code: "custom",
          path: ["tracksById", id, "clipOrder"],
          message: "Order must contain every clip exactly once",
        });
      for (const [clipId, clip] of Object.entries(track.clipsById)) {
        if (clip.source.kind === "component" && track.kind !== "visual")
          c.addIssue({
            code: "custom",
            path: ["tracksById", id, "clipsById", clipId, "source"],
            message: "Components require a visual track",
          });
        for (const issue of componentTimingIssues(
          clip.source,
          clip.effects ?? [],
          clip.durationFrames,
        ))
          c.addIssue({
            code: "custom",
            path: ["tracksById", id, "clipsById", clipId, ...issue.path],
            message: issue.message,
          });
        if (clip.startFrame + clip.durationFrames > t.durationFrames)
          c.addIssue({
            code: "custom",
            path: ["tracksById", id, "clipsById", clipId],
            message: "Clip exceeds timeline",
          });
      }
    }
  });
export const Patch = z
  .array(
    z.discriminatedUnion("op", [
      z.object({ op: z.literal("add"), path: z.string(), value: z.unknown() }).strict(),
      z
        .object({
          op: z.literal("replace"),
          path: z.string(),
          value: z.unknown(),
        })
        .strict(),
      z.object({ op: z.literal("test"), path: z.string(), value: z.unknown() }).strict(),
      z.object({ op: z.literal("remove"), path: z.string() }).strict(),
    ]),
  )
  .min(1)
  .max(100);
export type ScriptDocument = z.infer<typeof Script>;
export type TimelineDocument = z.infer<typeof Timeline>;
/** Timeline frames and its rational FPS are the sole source of actual duration. */
export function durationMsForFrames(
  frames: number,
  fps: { numerator: number; denominator: number },
) {
  return (frames * 1000 * fps.denominator) / fps.numerator;
}
export function timelineDurationMs(timeline: TimelineDocument) {
  return durationMsForFrames(timeline.durationFrames, timeline.fps);
}
const DependencyReason = z.enum([
  "script_changed",
  "timeline_changed",
  "narration_changed",
  "scene_visual_changed",
  "shot_plan_changed",
  "scene_context_changed",
  "additional_dependencies_require_review",
]);
const DependencyId = z.string().min(1).max(200);
export const StaleDependency = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("checkpoint"), versionId: DependencyId, reason: DependencyReason })
    .strict(),
  z
    .object({
      kind: z.literal("timeline_clip"),
      draftId: DependencyId,
      timelineRevision: DependencyId,
      trackId: Key,
      clipId: Key,
      asset: AssetRef.optional(),
      reason: DependencyReason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("shot_candidate"),
      draftId: DependencyId,
      sceneId: Key,
      shotId: Key,
      asset: AssetRef,
      jobId: DependencyId.optional(),
      reason: DependencyReason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("job"),
      jobId: DependencyId,
      versionId: DependencyId,
      reason: DependencyReason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("job_collection"),
      projectId: DependencyId,
      versionId: DependencyId,
      jobKind: z.literal("render"),
      reason: DependencyReason,
    })
    .strict(),
  z
    .object({
      kind: z.literal("draft_dependents"),
      draftId: DependencyId,
      reason: DependencyReason,
    })
    .strict(),
]);
export type StaleDependency = z.infer<typeof StaleDependency>;
export function bounded(value: unknown, max = 262144) {
  if (new TextEncoder().encode(canonical(value)).length > max)
    throw new Error(`Document exceeds ${max} bytes`);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("Invalid JSON");
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
export class PatchFailure extends Error {
  constructor(
    public path: string,
    message: string,
  ) {
    super(message);
  }
}
export function applyPatch<T>(document: unknown, input: unknown, schema: z.ZodType<T>): T {
  const result = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  for (const op of Patch.parse(input)) {
    if (!op.path.startsWith("/") || /\/(?:__proto__|constructor|prototype)(?:\/|$)/.test(op.path))
      throw new PatchFailure(op.path, "Invalid patch path");
    const keys = op.path
      .slice(1)
      .split("/")
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k)))
      throw new PatchFailure(op.path, "Invalid patch path");
    let parent: Record<string, unknown> = result;
    for (const key of keys.slice(0, -1)) {
      if (
        !Object.hasOwn(parent, key) ||
        !parent[key] ||
        typeof parent[key] !== "object" ||
        Array.isArray(parent[key])
      )
        throw new PatchFailure(
          op.path,
          "Patch parent must be a keyed object; replace order arrays as a whole",
        );
      parent = parent[key] as Record<string, unknown>;
    }
    const key = keys.at(-1)!;
    const exists = Object.hasOwn(parent, key);
    if (op.op !== "add" && !exists) throw new PatchFailure(op.path, "Patch target does not exist");
    if (op.op === "test") {
      if (canonical(parent[key]) !== canonical(op.value))
        throw new PatchFailure(op.path, "Patch test failed");
    } else if (op.op === "remove") delete parent[key];
    else parent[key] = op.value;
  }
  const parsed = schema.parse(result);
  if (new TextEncoder().encode(canonical(parsed)).length > 262144)
    throw new Error("Document exceeds 262144 bytes");
  return parsed;
}
