import { z } from "zod";
import { CharacterSceneProps } from "./character.js";
import { AssetRef, ResourceRef } from "./refs.js";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const Key = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const Font = z.enum(["sans-serif", "serif", "monospace"]);
const Animation = z
  .object({
    property: z.enum(["x", "y", "width", "height", "opacity", "scale", "rotation", "blur"]),
    keyframes: z
      .array(
        z
          .object({
            frame: z.number().int().min(0).max(72000),
            value: z.number().finite(),
            easing: z.enum(["linear", "ease_in", "ease_out", "ease_in_out"]).default("linear"),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((animation, ctx) => {
    const bounds: Record<typeof animation.property, [number, number]> = {
      x: [-4, 4],
      y: [-4, 4],
      width: [0.001, 4],
      height: [0.001, 4],
      opacity: [0, 1],
      scale: [0, 10],
      rotation: [-3600, 3600],
      blur: [0, 80],
    };
    for (const [index, keyframe] of animation.keyframes.entries())
      if (
        (index > 0 && keyframe.frame <= animation.keyframes[index - 1]!.frame) ||
        keyframe.value < bounds[animation.property][0] ||
        keyframe.value > bounds[animation.property][1]
      )
        ctx.addIssue({
          code: "custom",
          path: ["keyframes", index],
          message: "Frames must increase; values must fit the property bounds",
        });
  });
const Geometry = {
  x: z.number().min(-4).max(4),
  y: z.number().min(-4).max(4),
  width: z.number().min(0.001).max(4),
  height: z.number().min(0.001).max(4),
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().min(-3600).max(3600).default(0),
  scale: z.number().min(0).max(10).default(1),
  animations: z.array(Animation).max(8).default([]),
};
export const SceneNode = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      ...Geometry,
      text: z.string().max(16000),
      fontSize: z.number().min(8).max(500),
      fontFamily: Font,
      color: Color,
      textAlign: z.enum(["left", "center", "right"]),
      fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700)]).default(400),
    })
    .strict(),
  z
    .object({
      kind: z.literal("shape"),
      ...Geometry,
      shape: z.enum(["rectangle", "ellipse"]),
      fill: Color,
      borderColor: Color.optional(),
      borderWidth: z.number().min(0).max(30).default(0),
      radius: z.number().min(0).max(0.5).default(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("image"),
      ...Geometry,
      asset: AssetRef,
      fit: z.enum(["cover", "contain"]),
    })
    .strict(),
]);
export const SceneGraphProps = z
  .object({
    background: Color,
    nodeOrder: z.array(Key).max(100),
    nodesById: z.record(Key, SceneNode),
  })
  .strict()
  .superRefine((props, ctx) => {
    if (
      new Set(props.nodeOrder).size !== props.nodeOrder.length ||
      props.nodeOrder.length !== Object.keys(props.nodesById).length ||
      props.nodeOrder.some((key) => !Object.hasOwn(props.nodesById, key))
    )
      ctx.addIssue({
        code: "custom",
        path: ["nodeOrder"],
        message: "Order must contain every stable node ID exactly once",
      });
    const count = Object.values(props.nodesById).reduce(
      (sum, node) => sum + node.animations.reduce((n, a) => n + a.keyframes.length, 0),
      0,
    );
    if (count > 1024 || new TextEncoder().encode(JSON.stringify(props)).byteLength > 131072)
      ctx.addIssue({
        code: "custom",
        message: "Scene graph exceeds 1024 keyframes or 128KiB props",
      });
    for (const [key, node] of Object.entries(props.nodesById))
      if (
        new Set(node.animations.map((animation) => animation.property)).size !==
        node.animations.length
      )
        ctx.addIssue({
          code: "custom",
          path: ["nodesById", key, "animations"],
          message: "Only one animation per property",
        });
  });
export const AnimatedBarsProps = z
  .object({
    title: z.string().max(200),
    entries: z
      .array(
        z
          .object({ label: z.string().max(120), value: z.number().min(0).max(1), color: Color })
          .strict(),
      )
      .min(1)
      .max(8),
    disclaimer: z.string().max(300),
    background: Color,
    color: Color,
    revealFrames: z.number().int().min(1).max(600),
  })
  .strict();
export const BigStatProps = z
  .object({
    value: z.string().max(40),
    label: z.string().max(160),
    source: z.string().max(300),
    background: Color,
    color: Color,
    revealFrames: z.number().int().min(1).max(600),
  })
  .strict();
export const CompareProps = z
  .object({
    title: z.string().max(200),
    left: z
      .object({ title: z.string().max(120), text: z.string().max(1000), color: Color })
      .strict(),
    right: z
      .object({ title: z.string().max(120), text: z.string().max(1000), color: Color })
      .strict(),
    background: Color,
    color: Color,
  })
  .strict();
export {
  CharacterAction,
  CharacterChannel,
  CharacterEmotion,
  CharacterGesture,
  CharacterPack,
  CharacterProp,
  CharacterSceneProps,
  CharacterShape,
  CharacterTarget,
  characterActionChannels,
  RigPoint,
} from "./character.js";
export { builtInCharacterPacks, phoneCharacterProp } from "./character-packs.js";

const definitions = {
  "video/component/scene-graph": {
    schema: SceneGraphProps,
    description:
      "Ordered text, shapes and pinned images with bounded keyframe animations. No scripts, expressions, remote URLs, arbitrary CSS or JSX. Coordinates normalized to the clip box.",
  },
  "video/component/animated-bars": {
    schema: AnimatedBarsProps,
    description:
      "Animated normalized bars with explicit labels and mandatory source/disclaimer text. Values do not become verified product claims.",
  },
  "video/component/big-stat": {
    schema: BigStatProps,
    description:
      "A prominent authored statistic, explanatory label and explicit source text. No factual verification implied.",
  },
  "video/component/compare": {
    schema: CompareProps,
    description: "Two authored comparison columns; no automatic winner or scoring.",
  },
  "video/component/character-scene": {
    schema: CharacterSceneProps,
    description:
      "Deterministic character-pack animation with normalized rigs, layered semantic actions, priority mixing, spatial gaze/IK targets and persistent prop attachments. Inline bounded vector artwork; no executable markup or remote media.",
  },
} as const;
export const ComponentProps = z.union([
  SceneGraphProps,
  AnimatedBarsProps,
  BigStatProps,
  CompareProps,
  CharacterSceneProps,
]);
export const ComponentSource = z
  .object({ kind: z.literal("component"), component: ResourceRef, props: ComponentProps })
  .strict()
  .superRefine((source, ctx) => {
    const definition = definitions[source.component.resourceId as keyof typeof definitions];
    if (
      !definition ||
      source.component.revisionId !==
        (source.component.resourceId === "video/component/character-scene" ? "2" : "1")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["component"],
        message: "Unknown component or revision; read the supported component catalog",
      });
      return;
    }
    const parsed = definition.schema.safeParse(source.props);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({ code: "custom", path: ["props", ...issue.path], message: issue.message });
  });
export const FadeParameters = z
  .object({
    inFrames: z.number().int().min(0).max(72000),
    outFrames: z.number().int().min(0).max(72000),
  })
  .strict();
export const SlideParameters = z
  .object({
    fromX: z.number().min(-2).max(2),
    fromY: z.number().min(-2).max(2),
    durationFrames: z.number().int().min(1).max(72000),
  })
  .strict();
export const BlurParameters = z
  .object({ fromPx: z.number().min(0).max(80), durationFrames: z.number().int().min(1).max(72000) })
  .strict();
const effects = {
  "video/effect/fade": FadeParameters,
  "video/effect/slide": SlideParameters,
  "video/effect/blur": BlurParameters,
} as const;
export const Effect = z
  .object({
    preset: ResourceRef,
    parameters: z.union([FadeParameters, SlideParameters, BlurParameters]),
  })
  .strict()
  .superRefine((effect, ctx) => {
    const schema = effects[effect.preset.resourceId as keyof typeof effects];
    if (!schema || effect.preset.revisionId !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["preset"],
        message: "Unknown effect or revision; use the verified effect catalog",
      });
      return;
    }
    const parsed = schema.safeParse(effect.parameters);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          path: ["parameters", ...issue.path],
          message: issue.message,
        });
  });
export const componentResources = Object.entries(definitions).map(([resourceId, definition]) => ({
  resourceId,
  revisionId: resourceId === "video/component/character-scene" ? "2" : "1",
  kind: "component" as const,
  description: definition.description,
  schema: z.toJSONSchema(definition.schema),
  trust: "reviewed_repository_code" as const,
}));
export const effectResources = Object.entries(effects).map(([resourceId, schema]) => ({
  resourceId,
  revisionId: "1",
  kind: "preset" as const,
  description: "Verified bounded render effect. Parameter frame counts are relative to the clip.",
  schema: z.toJSONSchema(schema),
  trust: "reviewed_repository_code" as const,
}));
export type ComponentSource = z.infer<typeof ComponentSource>;
export type SceneGraphProps = z.infer<typeof SceneGraphProps>;
export type SceneNode = z.infer<typeof SceneNode>;
export type Effect = z.infer<typeof Effect>;
/** Clip-relative timing is validated with the enclosing immutable timeline. */
export function componentTimingIssues(
  source: { kind: string; props?: unknown },
  effects: Effect[],
  durationFrames: number,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  if (source.kind === "component") {
    const props = source.props as ComponentSource["props"];
    if ("nodesById" in props)
      for (const [id, node] of Object.entries(props.nodesById))
        for (const [index, animation] of node.animations.entries())
          if (animation.keyframes.some((key) => key.frame >= durationFrames))
            issues.push({
              path: ["source", "props", "nodesById", id, "animations", index],
              message: "Keyframes must refer to frames within this clip",
            });
    if ("revealFrames" in props && props.revealFrames >= durationFrames)
      issues.push({
        path: ["source", "props", "revealFrames"],
        message: "Reveal must complete within this clip",
      });
    if ("actionsById" in props)
      for (const [id, action] of Object.entries(props.actionsById))
        if (action.startFrame + action.durationFrames > durationFrames)
          issues.push({
            path: ["source", "props", "actionsById", id],
            message: "Character action must fit within this clip",
          });
    if ("overlaysById" in props)
      for (const [id, overlay] of Object.entries(props.overlaysById))
        if (overlay.endFrame > durationFrames)
          issues.push({
            path: ["source", "props", "overlaysById", id],
            message: "Character overlay must fit within this clip",
          });
  }
  for (const [index, effect] of effects.entries()) {
    const p = effect.parameters;
    if (
      ("inFrames" in p &&
        (p.inFrames >= durationFrames ||
          p.outFrames >= durationFrames ||
          p.inFrames + p.outFrames > durationFrames)) ||
      ("durationFrames" in p && p.durationFrames >= durationFrames)
    )
      issues.push({
        path: ["effects", index, "parameters"],
        message: "Effect timing must fit within this clip without overlapping fade windows",
      });
  }
  return issues;
}
