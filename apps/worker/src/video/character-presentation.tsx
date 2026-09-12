import type { CharacterSceneProps } from "@visual-canvas/video/registry";
import React, { type ReactNode } from "react";

const WIDTH = 1080;
const HEIGHT = 1920;

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

type Environment = CharacterSceneProps["environment"];
type Overlay = CharacterSceneProps["overlaysById"][string];
type Plane = Environment["layers"][number]["plane"];

const ADVERTISING_FONT_FAMILY = "DejaVu Sans, Arial, Helvetica, sans-serif";

type WorldBounds = { left: number; top: number; right: number; bottom: number };

function actorWorldBounds(
  props: CharacterSceneProps,
  actorId: string | undefined,
): WorldBounds | undefined {
  if (!actorId) return undefined;
  const actor = props.actorsById[actorId];
  const pack = actor && props.characterPacksById[actor.characterPackId];
  if (!actor || !pack) return undefined;
  const halfWidth = (pack.viewBox.width * actor.scale) / 2;
  const halfHeight = (pack.viewBox.height * actor.scale) / 2;
  return {
    left: actor.x * WIDTH - halfWidth,
    right: actor.x * WIDTH + halfWidth,
    top: actor.y * HEIGHT - halfHeight,
    bottom: actor.y * HEIGHT + halfHeight,
  };
}

export type PresentationCamera = {
  targetX: number;
  targetY: number;
  scale: number;
  progress: number;
  phase: "waiting" | "moving" | "holding" | "returning" | "settled";
  transform: string;
};

function layoutTarget(
  props: CharacterSceneProps,
  focus?: { productWorldPoint?: { x: number; y: number } },
) {
  const staging = props.staging;
  const actor = staging.focalActorId ? props.actorsById[staging.focalActorId] : undefined;
  const product = staging.productPropId ? props.propsById[staging.productPropId] : undefined;
  if (staging.layout === "reaction-closeup" && actor) {
    const pack = props.characterPacksById[actor.characterPackId];
    const authoredHeight = (pack?.viewBox.height ?? 600) * actor.scale;
    return {
      x: actor.x * WIDTH,
      y: actor.y * HEIGHT + (pack?.rig.head.y ?? -authoredHeight * 0.2) * actor.scale,
      scale: clamp(1040 / authoredHeight, 1.08, 1.72),
    };
  }
  if (staging.layout === "single-product" && product) {
    const productPoint = focus?.productWorldPoint ?? {
      x: product.x * WIDTH,
      y: product.y * HEIGHT,
    };
    const actorBounds = actorWorldBounds(props, staging.focalActorId ?? props.actorOrder[0]);
    if (!actorBounds)
      return {
        x: productPoint.x,
        y: productPoint.y,
        scale: clamp(
          Math.min(680 / (product.width * product.scale), 920 / (product.height * product.scale)),
          1.04,
          1.58,
        ),
      };

    // The product may move with an attached hand. Frame it together with the
    // staged spokesperson so camera motion cannot turn a valid static layout
    // into a clipped close-up.
    const productHalfWidth = (product.width * product.scale) / 2;
    const productHalfHeight = (product.height * product.scale) / 2;
    const bounds = {
      left: Math.min(actorBounds.left, productPoint.x - productHalfWidth),
      right: Math.max(actorBounds.right, productPoint.x + productHalfWidth),
      top: Math.min(actorBounds.top, productPoint.y - productHalfHeight),
      bottom: Math.max(actorBounds.bottom, productPoint.y + productHalfHeight),
    };
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
      scale: clamp(
        Math.min(880 / (bounds.right - bounds.left), 1240 / (bounds.bottom - bounds.top)),
        1.02,
        1.32,
      ),
    };
  }
  if (staging.layout === "two-shot") {
    // Frame every authored actor if a caller supplies more than the nominal pair;
    // never silently crop later actors from a "two-shot" scene.
    const actors = props.actorOrder
      .map((id) => {
        const item = props.actorsById[id];
        const pack = item && props.characterPacksById[item.characterPackId];
        return item && pack ? { ...item, pack } : undefined;
      })
      .filter((value) => value !== undefined);
    if (actors.length) {
      const left = Math.min(
        ...actors.map((item) => item.x * WIDTH - (item.pack.viewBox.width * item.scale) / 2),
      );
      const right = Math.max(
        ...actors.map((item) => item.x * WIDTH + (item.pack.viewBox.width * item.scale) / 2),
      );
      const top = Math.min(
        ...actors.map((item) => item.y * HEIGHT - (item.pack.viewBox.height * item.scale) / 2),
      );
      const bottom = Math.max(
        ...actors.map((item) => item.y * HEIGHT + (item.pack.viewBox.height * item.scale) / 2),
      );
      return {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        scale: clamp(Math.min(880 / (right - left), 1320 / (bottom - top)), 0.72, 1.28),
      };
    }
  }
  return { x: WIDTH / 2, y: HEIGHT / 2, scale: 1 };
}

/** Converts a screen-space overlay target back into the untransformed actor world. */
export function presentationScreenToWorld(
  camera: PresentationCamera,
  point: { x: number; y: number },
) {
  return {
    x: camera.targetX + (point.x - WIDTH / 2) / camera.scale,
    y: camera.targetY + (point.y - HEIGHT / 2) / camera.scale,
  };
}

/** A deterministic, final-stage camera: it never changes rig or facing evaluation. */
export function evaluatePresentationCamera(
  props: CharacterSceneProps,
  frame: number,
  focus?: { productWorldPoint?: { x: number; y: number } },
): PresentationCamera {
  const camera = props.camera;
  const base = layoutTarget(props, focus);
  const raw = (frame - camera.startFrame) / camera.durationFrames;
  const moveEnd = camera.startFrame + camera.durationFrames;
  const holdEnd = moveEnd + camera.holdFrames;
  const returnFrames = Math.min(camera.durationFrames, 18);
  const returns = camera.holdFrames > 0 && frame >= holdEnd;
  const progress = returns ? 1 - smooth((frame - holdEnd) / returnFrames) : smooth(raw);
  const phase =
    frame < camera.startFrame
      ? "waiting"
      : frame < moveEnd
        ? "moving"
        : !returns
          ? "holding"
          : frame < holdEnd + returnFrames
            ? "returning"
            : "settled";
  const amount = camera.intensity * progress;
  let targetX = WIDTH / 2 + (base.x - WIDTH / 2) * amount;
  let targetY = HEIGHT / 2 + (base.y - HEIGHT / 2) * amount;
  let scale = 1 + (base.scale - 1) * amount;
  if (camera.movement === "push-in") scale += 0.16 * amount;
  if (camera.movement === "pan-left") targetX -= WIDTH * 0.12 * amount;
  if (camera.movement === "pan-right") targetX += WIDTH * 0.12 * amount;
  if (camera.movement === "locked") {
    targetX = WIDTH / 2;
    targetY = HEIGHT / 2;
    scale = 1;
  }
  const tx = WIDTH / 2 - targetX * scale;
  const ty = HEIGHT / 2 - targetY * scale;
  return {
    targetX,
    targetY,
    scale,
    progress,
    phase,
    transform: `matrix(${scale} 0 0 ${scale} ${tx} ${ty})`,
  };
}

export function CameraWorld({
  camera,
  children,
}: {
  camera: PresentationCamera;
  children: ReactNode;
}) {
  // Keep the React runtime explicit for consumers that transpile this shared
  // TSX module with the classic JSX transform (notably the worker SSR path).
  return React.createElement(
    "g",
    { "data-presentation": "camera-world", transform: camera.transform },
    children,
  );
}

function LayerShape({ layer }: { layer: Environment["layers"][number] }) {
  const x = layer.x * WIDTH;
  const y = layer.y * HEIGHT;
  const width = layer.width * WIDTH;
  const height = layer.height * HEIGHT;
  if (layer.shape === "orb")
    return <ellipse cx={x} cy={y} rx={width / 2} ry={height / 2} fill={layer.color} />;
  if (layer.shape === "sweep")
    return (
      <path
        d={`M${x - width / 2} ${y + height / 2} Q${x} ${y - height / 2} ${x + width / 2} ${y + height / 2}Z`}
        fill={layer.color}
      />
    );
  return (
    <rect
      x={x - width / 2}
      y={y - height / 2}
      width={width}
      height={height}
      rx={Math.min(width, height) * 0.12}
      fill={layer.color}
    />
  );
}

export function EnvironmentBase({ environment }: { environment: Environment }) {
  return (
    <g data-presentation="environment-base">
      <rect width={WIDTH} height={HEIGHT} fill={environment.background} />
      <rect
        y={environment.horizonY * HEIGHT}
        width={WIDTH}
        height={HEIGHT * (1 - environment.horizonY)}
        fill={environment.ground}
      />
      <rect
        y={environment.horizonY * HEIGHT - 5}
        width={WIDTH}
        height="10"
        fill={environment.accent}
        opacity="0.55"
      />
    </g>
  );
}

/** Plane filtering makes the scene's occlusion order explicit at the call site. */
export function EnvironmentPlane({
  environment,
  plane,
  camera,
}: {
  environment: Environment;
  plane: Plane;
  camera: PresentationCamera;
}) {
  // Counter-translate inside CameraWorld: parallax=0 stays screen-still,
  // parallax=1 follows the subject/world camera displacement in full.
  const travelX = camera.targetX - WIDTH / 2;
  const travelY = camera.targetY - HEIGHT / 2;
  return (
    <g data-presentation={`environment-${plane}`}>
      {environment.layers
        .filter((layer) => layer.plane === plane)
        .map((layer) => (
          <g
            key={layer.id}
            opacity={layer.opacity}
            transform={`translate(${travelX * (1 - layer.parallax)} ${travelY * (1 - layer.parallax)})`}
          >
            <LayerShape layer={layer} />
          </g>
        ))}
    </g>
  );
}

const overlayMetrics: Record<
  Overlay["style"],
  { width: number; height: number; size: number; weight: number }
> = {
  caption: { width: 850, height: 116, size: 45, weight: 650 },
  "price-old": { width: 430, height: 126, size: 48, weight: 650 },
  "price-new": { width: 510, height: 156, size: 62, weight: 850 },
  savings: { width: 360, height: 112, size: 42, weight: 850 },
  callout: { width: 690, height: 154, size: 46, weight: 750 },
  cta: { width: 780, height: 132, size: 44, weight: 800 },
};

function overlayLines(text: string, maxLines = 3) {
  if (text.length <= 28) return [text];
  const target = Math.max(1, Math.ceil(text.length / maxLines));
  const lines: string[] = [];
  let rest = text.trim();
  while (rest && lines.length < maxLines - 1) {
    let cut = Math.min(target, rest.length);
    const boundary = rest.lastIndexOf(" ", cut);
    if (boundary > target * 0.55) cut = boundary;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) lines.push(rest);
  return lines;
}

/** Screen-space advertising typography; place outside CameraWorld. */
export function AdvertisingOverlay({ overlay, frame }: { overlay: Overlay; frame: number }) {
  if (frame < overlay.startFrame || frame >= overlay.endFrame) return null;
  const enter = smooth((frame - overlay.startFrame) / 10);
  const exit = smooth((overlay.endFrame - frame) / 8);
  const opacity = Math.min(enter, exit);
  const metric = overlayMetrics[overlay.style];
  const accent = overlay.accent ?? "#ff7a1a";
  const dark = "#211108";
  const light = "#fff8ee";
  const fill = overlay.style === "price-new" || overlay.style === "cta" ? accent : light;
  const color = fill === light ? dark : dark;
  const pop = 0.94 + enter * 0.06;
  const lines = overlayLines(overlay.text, overlay.emphasis ? 2 : 3);
  const availableWidth = metric.width * 0.84;
  const lineHeight = metric.size * 1.04;
  const textTop = overlay.emphasis
    ? metric.size * 0.38
    : metric.size * 0.34 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <g
      data-presentation={`overlay-${overlay.style}`}
      transform={`translate(${overlay.x * WIDTH} ${overlay.y * HEIGHT}) scale(${pop})`}
      opacity={opacity}
    >
      {overlay.style === "price-new" && enter < 1
        ? ["e", "se", "s", "sw", "w", "nw", "n", "ne"].map((ray, index) => {
            const angle = (index * Math.PI) / 4;
            return (
              <line
                key={ray}
                x1={Math.cos(angle) * (metric.width / 2 + 16)}
                y1={Math.sin(angle) * (metric.height / 2 + 16)}
                x2={Math.cos(angle) * (metric.width / 2 + 42 * enter)}
                y2={Math.sin(angle) * (metric.height / 2 + 42 * enter)}
                stroke={accent}
                strokeWidth="8"
                strokeLinecap="round"
                opacity={1 - enter}
              />
            );
          })
        : null}
      <rect
        x={-metric.width / 2}
        y={-metric.height / 2}
        width={metric.width}
        height={metric.height}
        rx={overlay.style === "savings" ? metric.height / 2 : 28}
        fill={fill}
        stroke={overlay.style === "callout" ? accent : "none"}
        strokeWidth="8"
      />
      {overlay.emphasis ? (
        <text
          y={-metric.size * 0.48}
          textAnchor="middle"
          fill={accent}
          fontFamily={ADVERTISING_FONT_FAMILY}
          fontWeight="800"
          fontSize={Math.round(metric.size * 0.48)}
          letterSpacing="1.5"
        >
          {overlay.emphasis.toUpperCase()}
        </text>
      ) : null}
      <text
        textAnchor="middle"
        fill={color}
        fontFamily={ADVERTISING_FONT_FAMILY}
        fontWeight={metric.weight}
        fontSize={metric.size}
      >
        {lines.map((line, index) => (
          <tspan
            key={`${line}:${lines.slice(0, index).filter((candidate) => candidate === line).length}`}
            x="0"
            y={textTop + index * lineHeight}
            textLength={Math.min(
              availableWidth,
              Math.max(metric.size, line.length * metric.size * 0.56),
            )}
            lengthAdjust="spacingAndGlyphs"
          >
            {line}
          </tspan>
        ))}
      </text>
      {overlay.style === "price-old" ? (
        <line
          x1={-metric.width * 0.38}
          x2={metric.width * 0.38}
          y1="0"
          y2="0"
          stroke={accent}
          strokeWidth="10"
          strokeLinecap="round"
        />
      ) : null}
    </g>
  );
}
