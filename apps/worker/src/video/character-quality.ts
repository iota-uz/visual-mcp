import {
  type CharacterQualityDiagnostic,
  type CharacterQualityEvidence,
  diagnoseCharacterQuality,
} from "@visual-canvas/video/character-quality";
import type { CharacterSceneProps } from "@visual-canvas/video/registry";
import { evaluatePresentationCamera } from "./character-presentation.js";
import { resolvePersistentPropAttachments, transformPoint } from "./character-runtime.js";
import { evaluateCharacterActors, resolveDynamicTarget } from "./character-scene.js";

type Bounds = { left: number; top: number; right: number; bottom: number };
function throughCamera(
  bounds: Bounds,
  camera: ReturnType<typeof evaluatePresentationCamera>,
  width: number,
  height: number,
): Bounds {
  const point = (x: number, y: number) => ({
    x: width / 2 + (x - camera.targetX) * camera.scale,
    y: height / 2 + (y - camera.targetY) * camera.scale,
  });
  const corners = [
    point(bounds.left, bounds.top),
    point(bounds.right, bounds.top),
    point(bounds.left, bounds.bottom),
    point(bounds.right, bounds.bottom),
  ];
  return {
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}

/** Uses the real actor evaluator and camera. Bounds are deliberately conservative pack/prop AABBs, not exact painted silhouettes. */
export function evaluateCharacterQualityEvidence(
  props: CharacterSceneProps,
  frames: readonly number[],
): CharacterQualityEvidence {
  return {
    boundsBasis: "conservative_pack_aabb",
    samples: [...new Set(frames)]
      .sort((a, b) => a - b)
      .map((frame) => {
        const camera = evaluatePresentationCamera(props, frame, undefined, (target, atFrame) =>
          resolveDynamicTarget(props, target, atFrame),
        );
        const actors = evaluateCharacterActors(props, frame, camera);
        const actorsById = Object.fromEntries(
          props.actorOrder.map((id) => {
            const actor = props.actorsById[id]!;
            const pack = props.characterPacksById[actor.characterPackId]!;
            const state = actors[id]!;
            const rootMatrix = state.rig.root!.matrix;
            const halfWidth = pack.viewBox.width / 2;
            const halfHeight = pack.viewBox.height / 2;
            const points = [
              transformPoint(rootMatrix, { x: -halfWidth, y: -halfHeight }),
              transformPoint(rootMatrix, { x: halfWidth, y: -halfHeight }),
              transformPoint(rootMatrix, { x: -halfWidth, y: halfHeight }),
              transformPoint(rootMatrix, { x: halfWidth, y: halfHeight }),
              ...Object.values(state.rig).map((node) => node.origin),
            ];
            return [
              id,
              {
                opacity: state.opacity,
                bounds: throughCamera(
                  {
                    left: Math.min(...points.map((point) => point.x)),
                    right: Math.max(...points.map((point) => point.x)),
                    top: Math.min(...points.map((point) => point.y)),
                    bottom: Math.max(...points.map((point) => point.y)),
                  },
                  camera,
                  props.stage.width,
                  props.stage.height,
                ),
              },
            ];
          }),
        );
        const attachments = resolvePersistentPropAttachments(props, frame);
        const propsById = Object.fromEntries(
          props.propOrder.map((id) => {
            const prop = props.propsById[id]!;
            const attachment = attachments[id];
            const attachedPoint = attachment
              ? actors[attachment.actorId]?.rig[`${attachment.hand}Hand`]?.origin
              : undefined;
            const x = attachedPoint?.x ?? prop.x * props.stage.width,
              y = attachedPoint?.y ?? prop.y * props.stage.height;
            const halfWidth = (prop.width * prop.scale) / 2,
              halfHeight = (prop.height * prop.scale) / 2;
            return [
              id,
              {
                opacity:
                  prop.initiallyVisible ||
                  attachment ||
                  props.actionOrder.some((actionId) => {
                    const action = props.actionsById[actionId];
                    return (
                      action?.type === "showProp" &&
                      action.propId === id &&
                      action.weight > 0 &&
                      frame >= action.startFrame
                    );
                  })
                    ? 1
                    : 0,
                bounds: throughCamera(
                  {
                    left: x - halfWidth,
                    right: x + halfWidth,
                    top: y - halfHeight,
                    bottom: y + halfHeight,
                  },
                  camera,
                  props.stage.width,
                  props.stage.height,
                ),
              },
            ];
          }),
        );
        return {
          frame,
          viewport: { width: props.stage.width, height: props.stage.height },
          cameraMatrix: [
            camera.scale,
            0,
            0,
            camera.scale,
            props.stage.width / 2 - camera.targetX * camera.scale,
            props.stage.height / 2 - camera.targetY * camera.scale,
          ] as [number, number, number, number, number, number],
          actorsById,
          propsById,
        };
      }),
  };
}

export function runCharacterQualityDiagnostics(
  props: CharacterSceneProps,
  frames: readonly number[],
): CharacterQualityDiagnostic[] {
  return diagnoseCharacterQuality(props, evaluateCharacterQualityEvidence(props, frames), {
    requiredFrames: [...frames],
  });
}
