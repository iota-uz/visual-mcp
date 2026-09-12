import {
  AnimatedBarsProps,
  BigStatProps,
  CharacterSceneProps,
  CompareProps,
  type ComponentSource,
  type Effect,
  SceneGraphProps,
  type SceneNode,
} from "@visual-canvas/video/registry";
import type { CSSProperties } from "react";
import { Img, staticFile } from "remotion";
import { CharacterScene } from "./character-scene.js";
import type { RenderProps } from "./composition.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function animatedValue(animation: SceneNode["animations"][number], frame: number): number {
  const first = animation.keyframes[0]!;
  if (frame <= first.frame) return first.value;
  for (let i = 1; i < animation.keyframes.length; i++) {
    const next = animation.keyframes[i]!;
    const previous = animation.keyframes[i - 1]!;
    if (frame <= next.frame) {
      const t = clamp((frame - previous.frame) / (next.frame - previous.frame));
      const eased =
        next.easing === "ease_in"
          ? t * t
          : next.easing === "ease_out"
            ? 1 - (1 - t) ** 2
            : next.easing === "ease_in_out"
              ? t * t * (3 - 2 * t)
              : t;
      return previous.value + (next.value - previous.value) * eased;
    }
  }
  return animation.keyframes.at(-1)!.value;
}
export function effectStyle(effects: Effect[], frame: number, duration: number): CSSProperties {
  let opacity = 1;
  let blur = 0;
  let x = 0;
  let y = 0;
  for (const effect of effects) {
    const p = effect.parameters;
    if ("inFrames" in p)
      opacity *= Math.min(
        p.inFrames ? clamp(frame / p.inFrames) : 1,
        p.outFrames ? clamp((duration - 1 - frame) / p.outFrames) : 1,
      );
    else if ("fromX" in p) {
      const remaining = 1 - clamp(frame / p.durationFrames);
      x += p.fromX * remaining;
      y += p.fromY * remaining;
    } else blur += p.fromPx * (1 - clamp(frame / p.durationFrames));
  }
  return { opacity, transform: `translate(${x * 100}%, ${y * 100}%)`, filter: `blur(${blur}px)` };
}
function NodeView({
  node,
  frame,
  files,
}: {
  node: SceneNode;
  frame: number;
  files: RenderProps["files"];
}) {
  const geometry = {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    scale: node.scale,
    rotation: node.rotation,
    blur: 0,
  };
  for (const animation of node.animations)
    geometry[animation.property] = animatedValue(animation, frame);
  const style: CSSProperties = {
    position: "absolute",
    left: `${geometry.x * 100}%`,
    top: `${geometry.y * 100}%`,
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
    opacity: geometry.opacity,
    transform: `rotate(${geometry.rotation}deg) scale(${geometry.scale})`,
    filter: `blur(${geometry.blur}px)`,
    boxSizing: "border-box",
    overflow: "hidden",
  };
  if (node.kind === "text")
    return (
      <div
        style={{
          ...style,
          fontSize: node.fontSize,
          fontFamily:
            node.fontFamily === "serif"
              ? "DejaVu Serif"
              : node.fontFamily === "monospace"
                ? "DejaVu Sans Mono"
                : "DejaVu Sans",
          color: node.color,
          textAlign: node.textAlign,
          fontWeight: node.fontWeight,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          lineHeight: 1.18,
        }}
      >
        {node.text}
      </div>
    );
  if (node.kind === "shape")
    return (
      <div
        style={{
          ...style,
          backgroundColor: node.fill,
          border: `${node.borderWidth}px solid ${node.borderColor ?? node.fill}`,
          borderRadius: node.shape === "ellipse" ? "50%" : `${node.radius * 100}%`,
        }}
      />
    );
  const file = files[`${node.asset.assetId}:${node.asset.revisionId}`];
  if (!file?.mimeType.startsWith("image/"))
    throw new Error("Scene graph requires a pinned image asset");
  return <Img src={staticFile(file.path)} style={{ ...style, objectFit: node.fit }} />;
}
export function TrustedComponent({
  source,
  frame,
  files,
  width,
}: {
  source: ComponentSource;
  frame: number;
  files: RenderProps["files"];
  width: number;
}) {
  const base: CSSProperties = {
    position: "absolute",
    inset: 0,
    padding: "8%",
    boxSizing: "border-box",
    fontFamily: "DejaVu Sans",
    overflow: "hidden",
    fontSize: width * 0.045,
    overflowWrap: "anywhere",
  };
  if (source.component.resourceId === "video/component/scene-graph") {
    const p = SceneGraphProps.parse(source.props);
    return (
      <div style={{ position: "absolute", inset: 0, background: p.background }}>
        {p.nodeOrder.map((id) => (
          <NodeView key={id} node={p.nodesById[id]!} frame={frame} files={files} />
        ))}
      </div>
    );
  }
  if (source.component.resourceId === "video/component/character-scene") {
    const p = CharacterSceneProps.parse(source.props);
    return <CharacterScene props={p} frame={frame} />;
  }
  if (source.component.resourceId === "video/component/animated-bars") {
    const p = AnimatedBarsProps.parse(source.props);
    const progress = clamp(frame / p.revealFrames);
    return (
      <div style={{ ...base, background: p.background, color: p.color }}>
        <h2 style={{ fontSize: "1.4em" }}>{p.title}</h2>
        {p.entries.map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Immutable render props; entries never reorder during this composition.
          <div key={`${i}:${entry.label}`} style={{ marginBlock: "5%" }}>
            <div>{entry.label}</div>
            <div
              style={{
                background: entry.color,
                height: width * 0.065,
                width: `${entry.value * progress * 100}%`,
                marginTop: "2%",
              }}
            />
          </div>
        ))}
        <div style={{ fontSize: ".6em", marginTop: "6%" }}>{p.disclaimer}</div>
      </div>
    );
  }
  if (source.component.resourceId === "video/component/big-stat") {
    const p = BigStatProps.parse(source.props);
    return (
      <div
        style={{
          ...base,
          background: p.background,
          color: p.color,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "5%",
        }}
      >
        <div style={{ fontSize: "3em", fontWeight: 700, opacity: clamp(frame / p.revealFrames) }}>
          {p.value}
        </div>
        <div>{p.label}</div>
        <div style={{ fontSize: ".6em" }}>{p.source}</div>
      </div>
    );
  }
  if (source.component.resourceId === "video/component/compare") {
    const p = CompareProps.parse(source.props);
    return (
      <div style={{ ...base, background: p.background, color: p.color }}>
        <h2>{p.title}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5%" }}>
          {Object.entries({ left: p.left, right: p.right }).map(([side, column]) => (
            <div
              key={side}
              style={{ borderTop: `6px solid ${column.color}`, whiteSpace: "pre-wrap" }}
            >
              <h3>{column.title}</h3>
              {column.text}
            </div>
          ))}
        </div>
      </div>
    );
  }
  throw new Error("Unknown trusted component");
}
