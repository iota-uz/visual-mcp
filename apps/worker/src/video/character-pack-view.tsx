import type { CharacterPack, CharacterProp, CharacterShape } from "@visual-canvas/video/registry";
import type { EvaluatedRig, Matrix2D } from "./character-runtime.js";
import { inverseMatrix, transformPoint } from "./character-runtime.js";

export type CharacterFaceState = {
  /** Pupil displacement in pack coordinates, after the gaze solver. */
  gazeX: number;
  gazeY: number;
  eyeOpen: number;
  browTilt: number;
  mouthCurve: number;
  viseme: "rest" | "a" | "e" | "o" | "u" | "m";
  /** Continuous speech envelope, independent of the discrete mouth shape. */
  mouthOpen: number;
};

export type CharacterPointingState = {
  target: { x: number; y: number };
  /** Continuous action/blend weight used by the pointing silhouette. */
  weight: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const matrixAttribute = (matrix: Matrix2D) => `matrix(${matrix.join(" ")})`;

/** Typed artwork stays data: no pack-specific code, markup injection or URL loading. */
export function CharacterVectorShape({ shape }: { shape: CharacterShape }) {
  const stroke = {
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (shape.kind) {
    case "ellipse":
      return (
        <ellipse
          cx={shape.x}
          cy={shape.y}
          rx={shape.rx}
          ry={shape.ry}
          fill={shape.fill}
          {...stroke}
        />
      );
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.radius}
          fill={shape.fill}
          {...stroke}
        />
      );
    case "path":
      return <path d={shape.d} fill={shape.fill} {...stroke} />;
  }
}

function CharacterArms({ pack, rig }: { pack: CharacterPack; rig: EvaluatedRig }) {
  if (!pack.capabilities.arms) return null;
  // Draw in body space to preserve stroke width under scale/squash while the IK
  // result remains in the same world space as every other evaluated node.
  const body = rig.body!.matrix;
  const toBody = inverseMatrix(body);
  return (
    <g transform={matrixAttribute(body)} data-character-part="arms">
      {(["left", "right"] as const).map((side) => {
        const shoulder = transformPoint(toBody, rig[`${side}Shoulder`]!.origin);
        const elbow = transformPoint(toBody, rig[`${side}Elbow`]!.origin);
        const hand = transformPoint(toBody, rig[`${side}Hand`]!.origin);
        return (
          <path
            key={side}
            data-arm={side}
            d={`M${shoulder.x} ${shoulder.y} L${elbow.x} ${elbow.y} L${hand.x} ${hand.y}`}
            fill="none"
            stroke={pack.style.limbColor}
            strokeWidth={pack.style.limbWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </g>
  );
}

/** A separate pass lets the scene draw a held object between the palm and fingers. */
export function CharacterHandsView({
  pack,
  rig,
  pointing = {},
  foregroundArms = {},
  opacity = 1,
}: {
  pack: CharacterPack;
  rig: EvaluatedRig;
  pointing?: Partial<Record<"left" | "right", CharacterPointingState>>;
  foregroundArms?: Partial<Record<"left" | "right", boolean>>;
  opacity?: number;
}) {
  if (!pack.capabilities.arms) return null;
  const artworkHands = pack.style.handRenderer === "artwork";
  return (
    <g data-character-part="hands" opacity={opacity}>
      {(["left", "right"] as const).map((side) => {
        const hand = rig[`${side}Hand`]!.origin;
        const point = pointing[side];
        const target = point?.target;
        const pointWeight = clamp(point?.weight ?? 0, 0, 1);
        const distance = target ? Math.hypot(target.x - hand.x, target.y - hand.y) : 0;
        const fingerLength = pack.style.handRadius * 2.4 * pointWeight;
        const tip =
          target && distance > 0
            ? {
                x: hand.x + ((target.x - hand.x) / distance) * fingerLength,
                y: hand.y + ((target.y - hand.y) / distance) * fingerLength,
              }
            : null;
        const foreground = foregroundArms[side] === true;
        return (
          <g key={side} data-hand={side}>
            {tip || foreground ? (
              <path
                data-character-point-arm={tip ? side : undefined}
                data-character-foreground-arm={foreground ? side : undefined}
                d={`M${rig[`${side}Shoulder`]!.origin.x} ${rig[`${side}Shoulder`]!.origin.y} L${rig[`${side}Elbow`]!.origin.x} ${rig[`${side}Elbow`]!.origin.y} L${hand.x} ${hand.y}`}
                fill="none"
                stroke={pack.style.limbColor}
                strokeWidth={pack.style.limbWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={tip ? pointWeight : undefined}
              />
            ) : null}
            {artworkHands ? (
              pack.layers
                .filter((layer) => layer.node === `${side}Hand`)
                .map((layer) => (
                  <g
                    key={layer.id}
                    data-layer={layer.id}
                    transform={matrixAttribute(rig[layer.node]!.matrix)}
                  >
                    {layer.shapes.map((shape, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: Pack shape order is immutable within a checkpoint.
                      <CharacterVectorShape key={index} shape={shape} />
                    ))}
                  </g>
                ))
            ) : (
              <circle
                transform={matrixAttribute(rig[`${side}Hand`]!.matrix)}
                r={pack.style.handRadius}
                fill={pack.style.handColor ?? pack.style.limbColor}
                stroke={pack.style.handStroke ?? (foreground ? pack.style.eyeColor : undefined)}
                strokeWidth={
                  pack.style.handStrokeWidth ??
                  (foreground ? Math.max(2, pack.style.handRadius * 0.25) : undefined)
                }
              />
            )}
            {tip ? (
              <path
                data-character-point-finger={side}
                d={`M${hand.x} ${hand.y} L${tip.x} ${tip.y}`}
                fill="none"
                stroke={pack.style.limbColor}
                strokeWidth={Math.max(5, pack.style.handRadius * 0.7)}
                strokeLinecap="round"
                opacity={pointWeight}
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function CharacterFace({
  pack,
  rig,
  face,
}: {
  pack: CharacterPack;
  rig: EvaluatedRig;
  face: CharacterFaceState;
}) {
  const { eyeRadius: radius, eyeSpacing, eyeWhite, eyeColor, mouthColor, mouthWidth } = pack.style;
  const eyeAspectRatio = pack.style.eyeAspectRatio ?? 1;
  const pupilScale = pack.style.pupilScale ?? 0.4;
  // Keep pupils inside their eye whites, even if an unusually shaped pack asks
  // for a gaze offset larger than its eye radius.
  const gazeLength = Math.hypot(face.gazeX, face.gazeY);
  const gazeScale = pack.capabilities.gaze
    ? Math.min(1, (radius * 0.5) / Math.max(1e-9, gazeLength))
    : 0;
  const eyeOpen = clamp(face.eyeOpen, 0.02, 2);
  const browTilt = clamp(face.browTilt, -1, 1) * radius * 0.55;
  const halfWidth = mouthWidth / 2;
  const viseme = pack.capabilities.talk ? face.viseme : "rest";
  const spokenMouthOpen = pack.capabilities.talk ? clamp(face.mouthOpen, 0, 1) : 0;
  const mouthOpen =
    viseme === "rest" ? Math.max(pack.style.mouthRestOpen ?? 0, spokenMouthOpen) : spokenMouthOpen;
  const round = viseme === "o" || viseme === "u";
  const open =
    mouthOpen > 0.01 &&
    ((viseme === "rest" && Boolean(pack.style.mouthRestOpen)) ||
      round ||
      viseme === "a" ||
      viseme === "e");
  const mouthHalfWidth =
    halfWidth * (viseme === "u" ? 0.36 : viseme === "o" ? 0.55 : viseme === "e" ? 1 : 0.85);
  const mouthHeight =
    mouthWidth * (viseme === "e" ? 0.16 : viseme === "u" ? 0.25 : 0.36) * mouthOpen;
  return (
    <>
      <g transform={matrixAttribute(rig.eyes!.matrix)} data-character-part="eyes">
        {([-1, 1] as const).map((side) => (
          <g key={side} transform={`translate(${(side * eyeSpacing) / 2} 0)`}>
            <g transform={`scale(1 ${eyeOpen})`}>
              <ellipse rx={radius} ry={radius * eyeAspectRatio} fill={eyeWhite} />
              <ellipse
                cx={face.gazeX * gazeScale}
                cy={face.gazeY * gazeScale}
                rx={radius * pupilScale}
                ry={radius * eyeAspectRatio * pupilScale}
                fill={eyeColor}
              />
              {pack.style.eyeHighlightColor && pack.style.eyeHighlightRadius ? (
                <circle
                  cx={face.gazeX * gazeScale + (pack.style.eyeHighlightX ?? -radius * 0.16)}
                  cy={
                    face.gazeY * gazeScale +
                    (pack.style.eyeHighlightY ?? -radius * eyeAspectRatio * 0.22)
                  }
                  r={pack.style.eyeHighlightRadius}
                  fill={pack.style.eyeHighlightColor}
                />
              ) : null}
            </g>
            <path
              d={`M${-(pack.style.browWidth ?? radius * 1.6) / 2} ${-radius * eyeAspectRatio - radius * 0.8 + side * browTilt} Q0 ${-radius * eyeAspectRatio - radius * 1.25} ${(pack.style.browWidth ?? radius * 1.6) / 2} ${-radius * eyeAspectRatio - radius * 0.8 - side * browTilt}`}
              fill="none"
              stroke={eyeColor}
              strokeWidth={pack.style.browStrokeWidth ?? Math.max(1, radius * 0.16)}
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
      <g
        transform={matrixAttribute(rig.mouth!.matrix)}
        data-character-part="mouth"
        data-viseme={viseme}
      >
        {open ? (
          <>
            <ellipse rx={mouthHalfWidth} ry={Math.max(0.5, mouthHeight)} fill={mouthColor} />
            {pack.style.tongueColor ? (
              <path
                d={`M${-mouthHalfWidth * 0.72} ${mouthHeight * 0.28} Q0 ${mouthHeight * 0.9} ${mouthHalfWidth * 0.72} ${mouthHeight * 0.28} Q0 ${mouthHeight * 0.05} ${-mouthHalfWidth * 0.72} ${mouthHeight * 0.28} Z`}
                fill={pack.style.tongueColor}
              />
            ) : null}
          </>
        ) : (
          <path
            d={`M${-halfWidth} 0 Q0 ${clamp(face.mouthCurve, -1, 1) * mouthWidth * 0.55} ${halfWidth} 0`}
            fill="none"
            stroke={mouthColor}
            strokeWidth={Math.max(1.5, mouthWidth * 0.11)}
            strokeLinecap="round"
          />
        )}
      </g>
    </>
  );
}

/** All evaluated matrices are SVG world coordinates. Artwork is node-local. */
export function CharacterPackView({
  pack,
  rig,
  face,
  opacity = 1,
  renderHands = true,
  pointing,
  foregroundArms,
}: {
  pack: CharacterPack;
  rig: EvaluatedRig;
  face: CharacterFaceState;
  opacity?: number;
  renderHands?: boolean;
  pointing?: Partial<Record<"left" | "right", CharacterPointingState>>;
  foregroundArms?: Partial<Record<"left" | "right", boolean>>;
}) {
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: SVG groups require an explicit role for their accessible labels.
    <g role="img" aria-label={pack.label} data-character-pack={pack.id} opacity={opacity}>
      <CharacterArms pack={pack} rig={rig} />
      {pack.layers
        .filter(
          (layer) =>
            pack.style.handRenderer !== "artwork" ||
            (layer.node !== "leftHand" && layer.node !== "rightHand"),
        )
        .map((layer) => (
          <g
            key={layer.id}
            data-layer={layer.id}
            transform={matrixAttribute(rig[layer.node]!.matrix)}
          >
            {layer.shapes.map((shape, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Pack shape order is immutable within a checkpoint.
              <CharacterVectorShape key={index} shape={shape} />
            ))}
          </g>
        ))}
      <CharacterFace pack={pack} rig={rig} face={face} />
      {renderHands ? (
        <CharacterHandsView
          pack={pack}
          rig={rig}
          pointing={pointing}
          foregroundArms={foregroundArms}
        />
      ) : null}
    </g>
  );
}

export function CharacterPropView({
  prop,
  matrix,
  opacity = 1,
}: {
  prop: CharacterProp;
  matrix: Matrix2D;
  opacity?: number;
}) {
  return (
    // biome-ignore lint/a11y/noInteractiveElementToNoninteractiveRole: SVG groups require an explicit role for their accessible labels.
    <g
      role="img"
      aria-label={prop.label}
      data-character-prop="true"
      transform={matrixAttribute(matrix)}
      opacity={opacity}
    >
      {prop.shapes.map((shape, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Prop shape order is immutable within a checkpoint.
        <CharacterVectorShape key={index} shape={shape} />
      ))}
    </g>
  );
}
