export interface PrototypeViewportSize {
  width: number;
  height: number;
}

export interface PrototypeHotspotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampPrototypeHotspot(
  hotspot: PrototypeHotspotRect,
  viewport: PrototypeViewportSize,
): PrototypeHotspotRect {
  const width = clamp(hotspot.width, 1, viewport.width);
  const height = clamp(hotspot.height, 1, viewport.height);
  return {
    x: clamp(hotspot.x, 0, viewport.width - width),
    y: clamp(hotspot.y, 0, viewport.height - height),
    width,
    height,
  };
}

export function drawPrototypeHotspot(
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport: PrototypeViewportSize,
): PrototypeHotspotRect {
  const left = clamp(Math.min(start.x, end.x), 0, viewport.width - 1);
  const top = clamp(Math.min(start.y, end.y), 0, viewport.height - 1);
  return clampPrototypeHotspot(
    {
      x: left,
      y: top,
      width: Math.max(1, Math.abs(end.x - start.x)),
      height: Math.max(1, Math.abs(end.y - start.y)),
    },
    viewport,
  );
}

export function movePrototypeHotspot(
  hotspot: PrototypeHotspotRect,
  x: number,
  y: number,
  viewport: PrototypeViewportSize,
): PrototypeHotspotRect {
  return clampPrototypeHotspot({ ...hotspot, x, y }, viewport);
}

export function resizePrototypeHotspot(
  hotspot: PrototypeHotspotRect,
  width: number,
  height: number,
  viewport: PrototypeViewportSize,
): PrototypeHotspotRect {
  return clampPrototypeHotspot(
    {
      ...hotspot,
      width: Math.min(width, viewport.width - hotspot.x),
      height: Math.min(height, viewport.height - hotspot.y),
    },
    viewport,
  );
}
