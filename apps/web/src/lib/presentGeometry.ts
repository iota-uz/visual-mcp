import {
  type CanvasNode,
  fitCameraToBounds,
  PHONE_FRAME,
  type PrototypeInteraction,
} from "@visual-canvas/canvas";

/** Maps a prototype hotspot from authored frame coordinates into the fitted Present stage. */
export function presentHotspotBox(
  node: CanvasNode,
  hotspot: PrototypeInteraction["hotspot"],
  stage: { width: number; height: number },
) {
  const camera = fitCameraToBounds({ x: 0, y: 0, width: node.rect.w, height: node.rect.h }, stage, {
    heightRatio: 0.8,
  });
  const cameraScale = camera.scale;
  const frameLeft = camera.x;
  const frameTop = camera.y;
  let contentX = 0;
  let contentY = 0;
  let contentScale = 1;
  if (node.kind === "iframe" && node.frame.kind === "phone") {
    contentScale = Math.min(
      node.rect.w / PHONE_FRAME.width,
      Math.max(1, node.rect.h - PHONE_FRAME.captionHeight) / PHONE_FRAME.height,
    );
    const shellX = (node.rect.w - PHONE_FRAME.width * contentScale) / 2;
    const shellY =
      PHONE_FRAME.captionHeight +
      (node.rect.h - PHONE_FRAME.captionHeight - PHONE_FRAME.height * contentScale) / 2;
    contentX = shellX + (PHONE_FRAME.bezel + PHONE_FRAME.padding) * contentScale;
    contentY =
      shellY + (PHONE_FRAME.bezel + PHONE_FRAME.padding + PHONE_FRAME.statusHeight) * contentScale;
  } else if (node.kind === "iframe") {
    contentScale = Math.min(
      node.rect.w / node.viewport.width,
      Math.max(1, node.rect.h - PHONE_FRAME.captionHeight) / node.viewport.height,
    );
    contentX = (node.rect.w - node.viewport.width * contentScale) / 2;
    contentY =
      PHONE_FRAME.captionHeight +
      (node.rect.h - PHONE_FRAME.captionHeight - node.viewport.height * contentScale) / 2;
  }
  return {
    left: frameLeft + (contentX + hotspot.x * contentScale) * cameraScale,
    top: frameTop + (contentY + hotspot.y * contentScale) * cameraScale,
    width: hotspot.width * contentScale * cameraScale,
    height: hotspot.height * contentScale * cameraScale,
  };
}
