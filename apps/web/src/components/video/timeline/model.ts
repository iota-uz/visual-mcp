import type { TimelineDocument } from "../../../../../../packages/video/src/contracts";

export type Selection = { trackId: string; clipId: string };
export type History = { past: TimelineDocument[]; future: TimelineDocument[] };
export type Clip = TimelineDocument["tracksById"][string]["clipsById"][string];
export type PointerEditMode = "move" | "trim-start" | "trim-end";
export type PointerEdit = {
  mode: PointerEditMode;
  startFrame: number;
  durationFrames: number;
  deltaPixels: number;
  laneWidth: number;
  timelineFrames: number;
  snapping: boolean;
  snapTargets: number[];
  snapThresholdPixels?: number;
};
export type PointerEditResult = { startFrame: number; durationFrames: number };
export type PointerInteraction = Omit<PointerEdit, "deltaPixels" | "snapping"> & {
  selection: Selection;
  startX: number;
};

export function sameSelection(left: Selection | undefined, right: Selection) {
  return left?.trackId === right.trackId && left.clipId === right.clipId;
}

function isDropFrameRate(numerator: number, denominator: number) {
  return denominator === 1001 && (numerator === 30000 || numerator === 60000);
}

/** SMPTE-style timecode, including the 29.97/59.94 drop-frame minute rules. */
export function formatTimelineTimecode(frame: number, numerator: number, denominator: number) {
  const nominalFps = Math.max(1, Math.round(numerator / denominator));
  let displayFrame = Math.max(0, Math.floor(frame));
  const dropFrame = isDropFrameRate(numerator, denominator);
  if (dropFrame) {
    const droppedPerMinute = Math.round(nominalFps * 0.066666);
    const framesPerMinute = nominalFps * 60 - droppedPerMinute;
    const framesPerTenMinutes = nominalFps * 600 - droppedPerMinute * 9;
    const framesPerDay = (nominalFps * 3600 - droppedPerMinute * 54) * 24;
    displayFrame %= framesPerDay;
    const blocks = Math.floor(displayFrame / framesPerTenMinutes);
    const remainder = displayFrame % framesPerTenMinutes;
    displayFrame += droppedPerMinute * 9 * blocks;
    if (remainder >= droppedPerMinute)
      displayFrame +=
        droppedPerMinute * Math.floor((remainder - droppedPerMinute) / framesPerMinute);
  }
  const hours = Math.floor(displayFrame / (nominalFps * 3600));
  const minutes = Math.floor(displayFrame / (nominalFps * 60)) % 60;
  const seconds = Math.floor(displayFrame / nominalFps) % 60;
  const frames = displayFrame % nominalFps;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${dropFrame ? ";" : ":"}${String(frames).padStart(2, "0")}`;
}

export function newTimelineKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function clipLabel(clip: Clip) {
  return clip.source.kind === "text"
    ? clip.source.text || "Untitled caption"
    : clip.source.kind === "component"
      ? clip.source.component.resourceId
      : clip.source.asset.assetId;
}

function nearestSnapDelta(edges: number[], targets: number[], threshold: number) {
  let nearest: number | undefined;
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge;
      if (
        Math.abs(delta) <= threshold &&
        (nearest === undefined || Math.abs(delta) < Math.abs(nearest))
      )
        nearest = delta;
    }
  }
  return nearest ?? 0;
}

/** Converts pointer distance to a bounded, optionally snapped frame edit. */
export function calculatePointerEdit(input: PointerEdit): PointerEditResult {
  const laneWidth = Math.max(1, input.laneWidth);
  const deltaFrames = Math.round((input.deltaPixels / laneWidth) * input.timelineFrames);
  const originalEnd = input.startFrame + input.durationFrames;
  const thresholdFrames = Math.max(
    1,
    Math.round(((input.snapThresholdPixels ?? 7) / laneWidth) * input.timelineFrames),
  );
  if (input.mode === "move") {
    let startFrame = Math.max(
      0,
      Math.min(input.timelineFrames - input.durationFrames, input.startFrame + deltaFrames),
    );
    if (input.snapping)
      startFrame += nearestSnapDelta(
        [startFrame, startFrame + input.durationFrames],
        input.snapTargets,
        thresholdFrames,
      );
    return {
      startFrame: Math.max(0, Math.min(input.timelineFrames - input.durationFrames, startFrame)),
      durationFrames: input.durationFrames,
    };
  }
  if (input.mode === "trim-start") {
    let startFrame = Math.max(0, Math.min(originalEnd - 1, input.startFrame + deltaFrames));
    if (input.snapping)
      startFrame += nearestSnapDelta([startFrame], input.snapTargets, thresholdFrames);
    startFrame = Math.max(0, Math.min(originalEnd - 1, startFrame));
    return { startFrame, durationFrames: originalEnd - startFrame };
  }
  let endFrame = Math.max(
    input.startFrame + 1,
    Math.min(input.timelineFrames, originalEnd + deltaFrames),
  );
  if (input.snapping) endFrame += nearestSnapDelta([endFrame], input.snapTargets, thresholdFrames);
  endFrame = Math.max(input.startFrame + 1, Math.min(input.timelineFrames, endFrame));
  return { startFrame: input.startFrame, durationFrames: endFrame - input.startFrame };
}
