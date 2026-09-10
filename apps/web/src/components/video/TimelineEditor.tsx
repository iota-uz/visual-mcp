import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Eye,
  Mic2,
  Music2,
  RotateCcw,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

const TRACK_META = {
  visual: { label: "Video", icon: Eye },
  voice: { label: "Voice", icon: Mic2 },
  music: { label: "Music", icon: Music2 },
  sfx: { label: "SFX", icon: Sparkles },
  caption: { label: "Captions", icon: Captions },
} as const;

function timecode(frame: number, fps: number) {
  const totalSeconds = Math.max(0, frame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = Math.floor(frame % fps);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export function TimelineEditor({
  document,
  onChange,
  disabled,
}: {
  document: TimelineDocument;
  onChange: (next: TimelineDocument) => void;
  disabled: boolean;
}) {
  const fps = document.fps.numerator / document.fps.denominator;
  const durationSeconds = document.durationFrames / fps;
  const [zoom, setZoom] = useState(1);
  const [playhead, setPlayhead] = useState(0);
  const firstClip = useMemo(() => {
    for (const trackId of document.trackOrder) {
      const clipId = document.tracksById[trackId]?.clipOrder[0];
      if (clipId) return `${trackId}:${clipId}`;
    }
    return undefined;
  }, [document]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const activeKey = selectedKey ?? firstClip;
  const [activeTrackId, activeClipId] = activeKey?.split(":") ?? [];
  const activeTrack = activeTrackId ? document.tracksById[activeTrackId] : undefined;
  const activeClip = activeTrack && activeClipId ? activeTrack.clipsById[activeClipId] : undefined;
  const ticks = Array.from({ length: 9 }, (_, index) => index / 8);

  function toFrames(seconds: number) {
    return Math.max(1, Math.round(seconds * fps));
  }
  function addText() {
    const trackId = `caption_${crypto.randomUUID().replaceAll("-", "")}`;
    onChange({
      ...document,
      trackOrder: [...document.trackOrder, trackId],
      tracksById: {
        ...document.tracksById,
        [trackId]: {
          kind: "caption",
          clipOrder: ["caption"],
          clipsById: {
            caption: {
              startFrame: 0,
              durationFrames: document.durationFrames,
              source: { kind: "text", text: "" },
            },
          },
        },
      },
    });
    setSelectedKey(`${trackId}:caption`);
  }
  function patch(
    trackId: string,
    clipId: string,
    next: Partial<TimelineDocument["tracksById"][string]["clipsById"][string]>,
  ) {
    const track = document.tracksById[trackId];
    const clip = track?.clipsById[clipId];
    if (!track || !clip) return;
    onChange({
      ...document,
      tracksById: {
        ...document.tracksById,
        [trackId]: { ...track, clipsById: { ...track.clipsById, [clipId]: { ...clip, ...next } } },
      },
    });
  }

  return (
    <section className="video-timeline" aria-label="Timeline">
      <div className="video-timeline-toolbar">
        <div>
          <h2>Timeline</h2>
          <span>
            {durationSeconds.toFixed(1)} s · {fps.toFixed(0)} fps
          </span>
        </div>
        <div className="video-actions">
          <Button
            size="sm"
            icon={Captions}
            onClick={addText}
            disabled={disabled || document.trackOrder.length >= 32}
          >
            Add captions
          </Button>
          <fieldset className="video-zoom-controls">
            <legend className="visually-hidden">Timeline zoom</legend>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 0.75}
              onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}
            >
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= 2.5}
              onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}
            >
              <ZoomIn size={15} aria-hidden="true" />
            </button>
          </fieldset>
        </div>
      </div>

      <fieldset className="video-transport">
        <legend className="visually-hidden">Timeline position</legend>
        <div className="video-transport-buttons">
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
            onClick={() => setPlayhead((value) => Math.min(document.durationFrames, value + 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <output aria-live="polite">{timecode(playhead, fps)}</output>
        <input
          aria-label="Playhead"
          type="range"
          min={0}
          max={document.durationFrames}
          value={Math.min(playhead, document.durationFrames)}
          onChange={(event) => setPlayhead(Number(event.target.value))}
        />
      </fieldset>

      <div className="video-timeline-viewport">
        <div className="video-timeline-canvas" style={{ minWidth: `${Math.round(760 * zoom)}px` }}>
          <div className="video-track-ruler">
            <div className="video-track-corner">Tracks</div>
            <div className="video-ruler-scale">
              {ticks.map((ratio) => (
                <span key={ratio} style={{ left: `${ratio * 100}%` }}>
                  {(durationSeconds * ratio).toFixed(durationSeconds < 20 ? 1 : 0)}s
                </span>
              ))}
            </div>
          </div>
          <div
            className="video-playhead"
            aria-hidden="true"
            style={{
              left: `calc(132px + (100% - 132px) * ${Math.min(1, playhead / document.durationFrames)})`,
            }}
          />
          {document.trackOrder.length === 0 && (
            <div className="video-timeline-empty">
              <Captions size={22} aria-hidden="true" />
              <span>No clips yet. Add captions or ask an agent to arrange pinned media.</span>
            </div>
          )}
          {document.trackOrder.map((trackId) => {
            const track = document.tracksById[trackId];
            if (!track) return null;
            const meta = TRACK_META[track.kind];
            const TrackIcon = meta.icon;
            return (
              <div className="video-track-row" key={trackId}>
                <div className="video-track-label">
                  <TrackIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{meta.label}</strong>
                    <small>
                      {track.clipOrder.length} {track.clipOrder.length === 1 ? "clip" : "clips"}
                    </small>
                  </span>
                </div>
                <div className={`video-track-lane video-track-lane-${track.kind}`}>
                  {track.clipOrder.map((clipId) => {
                    const clip = track.clipsById[clipId];
                    if (!clip) return null;
                    const invalid = clip.startFrame + clip.durationFrames > document.durationFrames;
                    const label =
                      clip.source.kind === "text"
                        ? clip.source.text || "Untitled caption"
                        : clip.source.kind === "component"
                          ? clip.source.component.resourceId
                          : clip.source.asset.assetId;
                    return (
                      <button
                        type="button"
                        key={clipId}
                        className="video-timeline-clip"
                        aria-pressed={activeKey === `${trackId}:${clipId}`}
                        aria-label={`${meta.label} clip: ${label}`}
                        title={`${label} · ${(clip.durationFrames / fps).toFixed(2)} s`}
                        onClick={() => setSelectedKey(`${trackId}:${clipId}`)}
                        style={{
                          left: `${Math.min(100, (clip.startFrame / document.durationFrames) * 100)}%`,
                          width: `${Math.max(1.5, Math.min(100, (clip.durationFrames / document.durationFrames) * 100))}%`,
                        }}
                      >
                        <span>{label}</span>
                        <small>{(clip.durationFrames / fps).toFixed(1)}s</small>
                        {invalid && <i title="Clip exceeds timeline">!</i>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="video-timeline-settings">
        <TextInput
          id="timeline-duration"
          type="number"
          label="Sequence duration"
          labelVisible
          min={0.1}
          max={2400}
          step={0.1}
          value={Number(durationSeconds.toFixed(2))}
          readOnly={disabled}
          trailingSlot={<span className="field-unit">sec</span>}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value > 0)
              onChange({ ...document, durationFrames: toFrames(value) });
          }}
        />
        <span className="video-hint">
          Changing timing updates the draft only. It does not start a render.
        </span>
      </div>

      {activeTrackId && activeClipId && activeTrack && activeClip && (
        <section className="video-clip-inspector" aria-label="Selected clip settings">
          <div className="video-clip-inspector-heading">
            <div>
              <span>Selected clip</span>
              <strong>{TRACK_META[activeTrack.kind].label}</strong>
            </div>
            <span>
              {timecode(activeClip.startFrame, fps)} –{" "}
              {timecode(activeClip.startFrame + activeClip.durationFrames, fps)}
            </span>
          </div>
          <div className="video-field-pair">
            <TextInput
              id={`${activeTrackId}-${activeClipId}-start`}
              label="Start"
              labelVisible
              type="number"
              min={0}
              step={0.1}
              value={Number((activeClip.startFrame / fps).toFixed(2))}
              readOnly={disabled}
              trailingSlot={<span className="field-unit">sec</span>}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 0)
                  patch(activeTrackId, activeClipId, { startFrame: Math.round(value * fps) });
              }}
            />
            <TextInput
              id={`${activeTrackId}-${activeClipId}-length`}
              label="Duration"
              labelVisible
              type="number"
              min={0.1}
              step={0.1}
              value={Number((activeClip.durationFrames / fps).toFixed(2))}
              readOnly={disabled}
              trailingSlot={<span className="field-unit">sec</span>}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0)
                  patch(activeTrackId, activeClipId, { durationFrames: toFrames(value) });
              }}
            />
          </div>
          {activeClip.source.kind === "text" ? (
            <TextInput
              id={`${activeTrackId}-${activeClipId}-text`}
              label="Caption text"
              labelVisible
              value={activeClip.source.text}
              readOnly={disabled}
              onChange={(event) =>
                patch(activeTrackId, activeClipId, {
                  source: { kind: "text", text: event.target.value },
                })
              }
            />
          ) : (
            <p className="video-hint">
              {activeClip.source.kind === "component"
                ? `Component: ${activeClip.source.component.resourceId} @ ${activeClip.source.component.revisionId}`
                : `Pinned asset: ${activeClip.source.asset.assetId}, revision ${activeClip.source.asset.revisionId}`}
            </p>
          )}
          {activeClip.startFrame + activeClip.durationFrames > document.durationFrames && (
            <p className="video-warning" role="alert">
              This clip extends beyond the sequence. Increase its duration or shorten the clip.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
