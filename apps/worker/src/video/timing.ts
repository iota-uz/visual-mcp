import type { VideoRenderRequest } from "@visual-canvas/video/media";

export function renderRange(request: VideoRenderRequest) {
  const start = request.range?.startFrame ?? 0;
  const end = request.range?.endFrame ?? request.timeline.durationFrames;
  if (end <= start || end > request.timeline.durationFrames)
    throw new Error("Render range is outside the timeline");
  return {
    start,
    end,
    frames: end - start,
    partial: start !== 0 || end !== request.timeline.durationFrames,
  };
}
export function frameAligned(milliseconds: number, fps: number) {
  const frame = (milliseconds / 1000) * fps;
  if (Math.abs(frame - Math.round(frame)) > 0.00001)
    throw new Error(
      "Source trim must align to the project frame rate; do not round source timing silently",
    );
  return Math.round(frame);
}
function stamp(frame: number, fps: number) {
  const ms = Math.round((frame / fps) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
export function captionsVtt(request: VideoRenderRequest) {
  const range = renderRange(request);
  const fps = request.format.fps.numerator / request.format.fps.denominator;
  const cues: { start: number; end: number; text: string }[] = [];
  for (const trackId of request.timeline.trackOrder) {
    const track = request.timeline.tracksById[trackId];
    if (track?.kind !== "caption") continue;
    for (const clipId of track.clipOrder) {
      const clip = track.clipsById[clipId];
      if (
        !clip ||
        clip.source.kind !== "text" ||
        clip.startFrame >= range.end ||
        clip.startFrame + clip.durationFrames <= range.start
      )
        continue;
      cues.push({
        start: Math.max(range.start, clip.startFrame) - range.start,
        end: Math.min(range.end, clip.startFrame + clip.durationFrames) - range.start,
        text: clip.source.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\r/g, "")
          .replace(/\n\s*\n/g, "\n"),
      });
    }
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  return `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${stamp(cue.start, fps)} --> ${stamp(cue.end, fps)}\n${cue.text}\n`).join("\n")}`;
}
