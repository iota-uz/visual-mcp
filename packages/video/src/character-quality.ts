import { z } from "zod";
import type { CharacterSceneProps } from "./character.js";

const Frame = z.number().int().min(0).max(72000);
const Finite = z.number().finite();
const Bounds = z.object({ left: Finite, top: Finite, right: Finite, bottom: Finite }).strict();
const Subject = z.object({ bounds: Bounds, opacity: z.number().min(0).max(1) }).strict();
export const CharacterQualityEvidence = z
  .object({
    boundsBasis: z.literal("conservative_pack_aabb"),
    samples: z
      .array(
        z
          .object({
            frame: Frame,
            viewport: z
              .object({ width: z.number().positive(), height: z.number().positive() })
              .strict(),
            cameraMatrix: z.tuple([Finite, Finite, Finite, Finite, Finite, Finite]),
            actorsById: z.record(z.string(), Subject),
            propsById: z.record(z.string(), Subject),
          })
          .strict(),
      )
      .min(1)
      .max(7200),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (let i = 1; i < value.samples.length; i++)
      if (value.samples[i]!.frame <= value.samples[i - 1]!.frame)
        ctx.addIssue({
          code: "custom",
          path: ["samples", i, "frame"],
          message: "Sample frames must strictly increase",
        });
  });
export type CharacterQualityEvidence = z.infer<typeof CharacterQualityEvidence>;

export type CharacterQualityDiagnostic = {
  code:
    | "text_too_brief"
    | "unsafe_actor_bounds"
    | "unsafe_prop_bounds"
    | "nonfinite_transform"
    | "missing_frame_evidence";
  path: (string | number)[];
  frame?: number;
  severity: "error" | "warning";
  message: string;
  patch?: { op: "replace"; path: string; value: number };
};

function isTransitioning(props: CharacterSceneProps, actorId: string, frame: number) {
  return props.actionOrder.some((id) => {
    const action = props.actionsById[id];
    return (
      action?.actorId === actorId &&
      (action.type === "enter" || action.type === "exit") &&
      frame >= action.startFrame &&
      frame < action.startFrame + action.durationFrames
    );
  });
}

/** Spatial findings are exact for the supplied renderer-evaluated frames; unsampled frames are never inferred. */
export function diagnoseCharacterQuality(
  props: CharacterSceneProps,
  evidence: CharacterQualityEvidence,
  options: {
    safeFrameInset?: number;
    minimumReadableSeconds?: number;
    requiredFrames?: number[];
  } = {},
): CharacterQualityDiagnostic[] {
  const diagnostics: CharacterQualityDiagnostic[] = [];
  const fps = props.timebase.numerator / props.timebase.denominator;
  const minimumFrames = Math.ceil((options.minimumReadableSeconds ?? 0.7) * fps);
  for (const id of props.overlayOrder) {
    const overlay = props.overlaysById[id]!;
    const duration = overlay.endFrame - overlay.startFrame;
    if (duration < minimumFrames)
      diagnostics.push({
        code: "text_too_brief",
        path: ["overlaysById", id, "endFrame"],
        frame: overlay.startFrame,
        severity: "error",
        message: `Text is readable for ${duration} frames; minimum is ${minimumFrames}`,
        patch: {
          op: "replace",
          path: `/overlaysById/${id}/endFrame`,
          value: overlay.startFrame + minimumFrames,
        },
      });
  }
  const parsed = CharacterQualityEvidence.parse(evidence);
  const sampled = new Set(parsed.samples.map((sample) => sample.frame));
  for (const frame of options.requiredFrames ?? [])
    if (!sampled.has(frame))
      diagnostics.push({
        code: "missing_frame_evidence",
        path: ["samples"],
        frame,
        severity: "error",
        message: "Required renderer-evaluated frame is missing",
      });
  for (const [sampleIndex, sample] of parsed.samples.entries()) {
    if (!sample.cameraMatrix.every(Number.isFinite))
      diagnostics.push({
        code: "nonfinite_transform",
        path: ["samples", sampleIndex, "cameraMatrix"],
        frame: sample.frame,
        severity: "error",
        message: "Camera transform contains a non-finite value",
      });
    const inset = options.safeFrameInset ?? 0.05;
    const safe = {
      left: sample.viewport.width * inset,
      right: sample.viewport.width * (1 - inset),
      top: sample.viewport.height * inset,
      bottom: sample.viewport.height * (1 - inset),
    };
    const inspect = (
      kind: "actorsById" | "propsById",
      subjects: Record<string, z.infer<typeof Subject>>,
    ) => {
      for (const [id, subject] of Object.entries(subjects)) {
        if (!Object.values(subject.bounds).every(Number.isFinite))
          diagnostics.push({
            code: "nonfinite_transform",
            path: ["samples", sampleIndex, kind, id, "bounds"],
            frame: sample.frame,
            severity: "error",
            message: "Transformed bounds contain a non-finite value",
          });
        if (
          subject.opacity < 0.8 ||
          (kind === "actorsById" && isTransitioning(props, id, sample.frame))
        )
          continue;
        const clipped =
          subject.bounds.left < safe.left ||
          subject.bounds.right > safe.right ||
          subject.bounds.top < safe.top ||
          subject.bounds.bottom > safe.bottom;
        if (clipped)
          diagnostics.push({
            code: kind === "actorsById" ? "unsafe_actor_bounds" : "unsafe_prop_bounds",
            path: [kind, id],
            frame: sample.frame,
            severity: "warning",
            message: `Held ${kind === "actorsById" ? "actor" : "prop"} crosses the transformed safe frame`,
          });
      }
    };
    inspect("actorsById", sample.actorsById);
    inspect("propsById", sample.propsById);
  }
  return diagnostics;
}

export const CharacterRenderProfile = z.enum(["draft360", "draft540", "preview720", "final1080"]);
export function characterRenderDimensions(
  stage: CharacterSceneProps["stage"],
  profile: z.infer<typeof CharacterRenderProfile>,
) {
  const shortEdge = { draft360: 360, draft540: 540, preview720: 720, final1080: 1080 }[profile];
  const scale = shortEdge / Math.min(stage.width, stage.height);
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return { width: even(stage.width * scale), height: even(stage.height * scale) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
/** Deterministic JSON evidence bytes only; this makes no claim about pixel or encoded-video determinism. */
export function canonicalCharacterQualityBytes(value: CharacterQualityEvidence): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonical(CharacterQualityEvidence.parse(value))));
}
