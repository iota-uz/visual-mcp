import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { formatTimelineTimecode } from "./model";

export function TimelineTransport({
  playhead,
  playing,
  durationFrames,
  numerator,
  denominator,
  setPlayhead,
  onTogglePlayback,
}: {
  playhead: number;
  playing: boolean;
  durationFrames: number;
  numerator: number;
  denominator: number;
  setPlayhead: Dispatch<SetStateAction<number>>;
  onTogglePlayback: () => void;
}) {
  return (
    <fieldset className="video-transport">
      <legend className="visually-hidden">Timeline transport</legend>
      <div className="video-transport-buttons">
        <button
          type="button"
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          onClick={onTogglePlayback}
        >
          {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <button type="button" aria-label="Go to start" onClick={() => setPlayhead(0)}>
          <RotateCcw size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Previous frame"
          onClick={() => setPlayhead((value) => Math.max(0, value - 1))}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next frame"
          onClick={() => setPlayhead((value) => Math.min(durationFrames, value + 1))}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <output aria-live="polite">{formatTimelineTimecode(playhead, numerator, denominator)}</output>
      <input
        aria-label="Playhead"
        type="range"
        min={0}
        max={durationFrames}
        value={Math.min(playhead, durationFrames)}
        onChange={(event) => setPlayhead(Number(event.target.value))}
      />
    </fieldset>
  );
}
