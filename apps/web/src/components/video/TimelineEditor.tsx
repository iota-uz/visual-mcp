import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Maximize2,
  Mic2,
  Music2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { TimelinePreview } from "./TimelinePreview";

const TRACK_META = {
  visual: { label: "Video", icon: Eye },
  voice: { label: "Voice", icon: Mic2 },
  music: { label: "Music", icon: Music2 },
  sfx: { label: "SFX", icon: Sparkles },
  caption: { label: "Captions", icon: Captions },
} as const;
type Selection = { trackId: string; clipId: string };
type History = { past: TimelineDocument[]; future: TimelineDocument[] };
type Clip = TimelineDocument["tracksById"][string]["clipsById"][string];
type PointerEditMode = "move" | "trim-start" | "trim-end";
type PointerEdit = {
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
type PointerEditResult = { startFrame: number; durationFrames: number };
type PointerInteraction = Omit<PointerEdit, "deltaPixels" | "snapping"> & {
  selection: Selection;
  startX: number;
};

function sameSelection(left: Selection | undefined, right: Selection) {
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
function newKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
function clipLabel(clip: Clip) {
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

export function TimelineEditor({
  document,
  onChange,
  disabled,
  workspaceId,
  format = { width: 360, height: 640 },
}: {
  document: TimelineDocument;
  onChange: (next: TimelineDocument) => void;
  disabled: boolean;
  workspaceId?: Id<"workspaces">;
  format?: { width: number; height: number };
}) {
  const numerator = document.fps.numerator;
  const denominator = document.fps.denominator;
  const fps = numerator / denominator;
  const durationSeconds = (document.durationFrames * denominator) / numerator;
  const [zoom, setZoom] = useState(1);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [selection, setSelection] = useState<Selection>();
  const [pointerPreview, setPointerPreview] = useState<
    (PointerEditResult & { selection: Selection }) | undefined
  >();
  const [lockedTracks, setLockedTracks] = useState<Set<string>>(() => new Set());
  const [hiddenTracks, setHiddenTracks] = useState<Set<string>>(() => new Set());
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(() => new Set());
  const history = useRef<History>({ past: [], future: [] });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const latestDocument = useRef(document);
  const lastEmittedSignature = useRef<string | undefined>(undefined);
  const pointerInteraction = useRef<PointerInteraction | undefined>(undefined);
  const suppressClipClick = useRef(false);
  const [, refreshHistory] = useState(0);

  useEffect(() => {
    setPlayhead((value) => Math.min(value, document.durationFrames));
    if (JSON.stringify(document) === lastEmittedSignature.current)
      lastEmittedSignature.current = undefined;
    else if (document !== latestDocument.current) {
      history.current = { past: [], future: [] };
      refreshHistory((value) => value + 1);
    }
    latestDocument.current = document;
  }, [document]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () =>
        setPlayhead((value) => {
          if (value >= document.durationFrames) {
            setPlaying(false);
            return document.durationFrames;
          }
          return Math.min(document.durationFrames, value + 1);
        }),
      Math.max(8, 1000 / fps),
    );
    return () => window.clearInterval(timer);
  }, [document.durationFrames, fps, playing]);

  const firstClip = useMemo(() => {
    for (const trackId of document.trackOrder) {
      const clipId = document.tracksById[trackId]?.clipOrder[0];
      if (clipId) return { trackId, clipId };
    }
    return undefined;
  }, [document]);
  const activeSelection =
    selection && document.tracksById[selection.trackId]?.clipsById[selection.clipId]
      ? selection
      : firstClip;
  const activeTrack = activeSelection ? document.tracksById[activeSelection.trackId] : undefined;
  const activeClip =
    activeTrack && activeSelection ? activeTrack.clipsById[activeSelection.clipId] : undefined;
  const captionTrackId = document.trackOrder.find(
    (trackId) => document.tracksById[trackId]?.kind === "caption",
  );
  const captionTrack = captionTrackId ? document.tracksById[captionTrackId] : undefined;
  const cannotAddCaption =
    playhead >= document.durationFrames ||
    (captionTrack ? captionTrack.clipOrder.length >= 500 : document.trackOrder.length >= 32);
  const ticks = Array.from({ length: 9 }, (_, index) => index / 8);
  function emit(next: TimelineDocument) {
    latestDocument.current = next;
    lastEmittedSignature.current = JSON.stringify(next);
    onChange(next);
  }
  function commit(next: TimelineDocument) {
    if (disabled || next === latestDocument.current) return;
    history.current.past.push(latestDocument.current);
    if (history.current.past.length > 50) history.current.past.shift();
    history.current.future = [];
    refreshHistory((value) => value + 1);
    emit(next);
  }
  function undo() {
    if (disabled) return;
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(latestDocument.current);
    refreshHistory((value) => value + 1);
    emit(previous);
  }
  function redo() {
    if (disabled) return;
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(latestDocument.current);
    refreshHistory((value) => value + 1);
    emit(next);
  }
  function toFrames(seconds: number) {
    return Math.max(1, Math.round((seconds * numerator) / denominator));
  }
  function fitTimeline() {
    const width = viewportRef.current?.clientWidth;
    setZoom(width ? Math.max(0.5, Math.min(4, width / 760)) : 1);
  }
  function addCaption() {
    if (disabled || cannotAddCaption) return;
    const current = latestDocument.current;
    const existingTrackId = current.trackOrder.find(
      (id) => current.tracksById[id]?.kind === "caption",
    );
    const trackId = existingTrackId ?? newKey("caption");
    const clipId = newKey("caption");
    const durationFrames = Math.max(1, Math.min(current.durationFrames - playhead, toFrames(3)));
    const existingTrack = existingTrackId ? current.tracksById[existingTrackId] : undefined;
    const nextTrack = existingTrack
      ? {
          ...existingTrack,
          clipOrder: [...existingTrack.clipOrder, clipId],
          clipsById: {
            ...existingTrack.clipsById,
            [clipId]: {
              startFrame: playhead,
              durationFrames,
              source: { kind: "text" as const, text: "" },
            },
          },
        }
      : {
          kind: "caption" as const,
          clipOrder: [clipId],
          clipsById: {
            [clipId]: {
              startFrame: playhead,
              durationFrames,
              source: { kind: "text" as const, text: "" },
            },
          },
        };
    commit({
      ...current,
      trackOrder: existingTrackId ? current.trackOrder : [...current.trackOrder, trackId],
      tracksById: { ...current.tracksById, [trackId]: nextTrack },
    });
    setSelection({ trackId, clipId });
  }
  function patchClip(trackId: string, clipId: string, next: Partial<Clip>) {
    const current = latestDocument.current;
    const track = current.tracksById[trackId];
    const clip = track?.clipsById[clipId];
    if (!track || !clip || lockedTracks.has(trackId)) return;
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [trackId]: { ...track, clipsById: { ...track.clipsById, [clipId]: { ...clip, ...next } } },
      },
    });
  }
  function moveClip(delta: number) {
    if (!activeSelection || !activeClip) return;
    patchClip(activeSelection.trackId, activeSelection.clipId, {
      startFrame: Math.max(
        0,
        Math.min(
          document.durationFrames - activeClip.durationFrames,
          activeClip.startFrame + delta,
        ),
      ),
    });
  }
  function trimStart(delta: number) {
    if (!activeSelection || !activeClip) return;
    const nextStart = Math.max(
      0,
      Math.min(
        activeClip.startFrame + activeClip.durationFrames - 1,
        activeClip.startFrame + delta,
      ),
    );
    patchClip(activeSelection.trackId, activeSelection.clipId, {
      startFrame: nextStart,
      durationFrames: activeClip.durationFrames + activeClip.startFrame - nextStart,
    });
  }
  function trimEnd(delta: number) {
    if (!activeSelection || !activeClip) return;
    patchClip(activeSelection.trackId, activeSelection.clipId, {
      durationFrames: Math.max(
        1,
        Math.min(
          document.durationFrames - activeClip.startFrame,
          activeClip.durationFrames + delta,
        ),
      ),
    });
  }
  function splitClip() {
    if (!activeSelection || !activeTrack || !activeClip || disabled) return;
    const clipEnd = activeClip.startFrame + activeClip.durationFrames;
    if (playhead <= activeClip.startFrame || playhead >= clipEnd) return;
    const current = latestDocument.current;
    const track = current.tracksById[activeSelection.trackId];
    if (!track || lockedTracks.has(activeSelection.trackId)) return;
    const secondId = newKey("clip");
    const index = track.clipOrder.indexOf(activeSelection.clipId);
    const nextOrder = [...track.clipOrder];
    nextOrder.splice(index + 1, 0, secondId);
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [activeSelection.trackId]: {
          ...track,
          clipOrder: nextOrder,
          clipsById: {
            ...track.clipsById,
            [activeSelection.clipId]: {
              ...activeClip,
              durationFrames: playhead - activeClip.startFrame,
            },
            [secondId]: { ...activeClip, startFrame: playhead, durationFrames: clipEnd - playhead },
          },
        },
      },
    });
    setSelection({ trackId: activeSelection.trackId, clipId: secondId });
  }
  function duplicateClip() {
    if (!activeSelection || !activeTrack || !activeClip || disabled) return;
    const current = latestDocument.current;
    const track = current.tracksById[activeSelection.trackId];
    if (!track || track.clipOrder.length >= 500 || lockedTracks.has(activeSelection.trackId))
      return;
    const clipId = newKey("clip");
    const startFrame = Math.min(
      document.durationFrames - activeClip.durationFrames,
      activeClip.startFrame + activeClip.durationFrames,
    );
    const index = track.clipOrder.indexOf(activeSelection.clipId);
    const nextOrder = [...track.clipOrder];
    nextOrder.splice(index + 1, 0, clipId);
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [activeSelection.trackId]: {
          ...track,
          clipOrder: nextOrder,
          clipsById: { ...track.clipsById, [clipId]: { ...activeClip, startFrame } },
        },
      },
    });
    setSelection({ trackId: activeSelection.trackId, clipId });
  }
  function deleteClip() {
    if (!activeSelection || !activeTrack || disabled || lockedTracks.has(activeSelection.trackId))
      return;
    const current = latestDocument.current;
    const track = current.tracksById[activeSelection.trackId];
    if (!track) return;
    const clipsById = { ...track.clipsById };
    delete clipsById[activeSelection.clipId];
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [activeSelection.trackId]: {
          ...track,
          clipOrder: track.clipOrder.filter((id) => id !== activeSelection.clipId),
          clipsById,
        },
      },
    });
    setSelection(undefined);
  }
  function toggleSet(setter: Dispatch<SetStateAction<Set<string>>>, trackId: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }

  function snapTargetsFor(targetSelection: Selection) {
    const targets = new Set([0, document.durationFrames, playhead]);
    for (const trackId of document.trackOrder) {
      const track = document.tracksById[trackId];
      if (!track) continue;
      for (const clipId of track.clipOrder) {
        if (targetSelection.trackId === trackId && targetSelection.clipId === clipId) continue;
        const clip = track.clipsById[clipId];
        if (!clip) continue;
        targets.add(clip.startFrame);
        targets.add(clip.startFrame + clip.durationFrames);
      }
    }
    return [...targets];
  }

  function beginPointerEdit(
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: PointerEditMode,
    targetSelection: Selection,
    clip: Clip,
  ) {
    if (event.button !== 0 || disabled || lockedTracks.has(targetSelection.trackId)) return;
    event.preventDefault();
    event.stopPropagation();
    const lane = event.currentTarget.closest<HTMLElement>(".video-track-lane");
    pointerInteraction.current = {
      mode,
      selection: targetSelection,
      startX: event.clientX,
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      laneWidth: lane?.getBoundingClientRect().width || lane?.clientWidth || 760,
      timelineFrames: document.durationFrames,
      snapTargets: snapTargetsFor(targetSelection),
    };
    suppressClipClick.current = false;
    setPlaying(false);
    setSelection(targetSelection);
    if (mode === "move") setPlayhead(clip.startFrame);
    setPointerPreview({
      selection: targetSelection,
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updatePointerEdit(event: ReactPointerEvent<HTMLButtonElement>) {
    const interaction = pointerInteraction.current;
    if (!interaction) return;
    event.preventDefault();
    const next = calculatePointerEdit({
      ...interaction,
      deltaPixels: event.clientX - interaction.startX,
      snapping,
    });
    suppressClipClick.current =
      next.startFrame !== interaction.startFrame ||
      next.durationFrames !== interaction.durationFrames;
    setPointerPreview({ ...next, selection: interaction.selection });
  }

  function finishPointerEdit(event: ReactPointerEvent<HTMLButtonElement>) {
    const interaction = pointerInteraction.current;
    if (!interaction) return;
    event.preventDefault();
    event.stopPropagation();
    const next = calculatePointerEdit({
      ...interaction,
      deltaPixels: event.clientX - interaction.startX,
      snapping,
    });
    pointerInteraction.current = undefined;
    setPointerPreview(undefined);
    if (
      next.startFrame !== interaction.startFrame ||
      next.durationFrames !== interaction.durationFrames
    )
      patchClip(interaction.selection.trackId, interaction.selection.clipId, next);
  }

  function cancelPointerEdit() {
    pointerInteraction.current = undefined;
    suppressClipClick.current = false;
    setPointerPreview(undefined);
  }

  const clipIsLocked = activeSelection ? lockedTracks.has(activeSelection.trackId) : false;
  const canSplit = Boolean(
    activeClip &&
      playhead > activeClip.startFrame &&
      playhead < activeClip.startFrame + activeClip.durationFrames,
  );

  return (
    <section className="video-timeline" aria-label="Timeline">
      <div className="video-timeline-toolbar">
        <div>
          <h2>Timeline</h2>
          <span>
            {durationSeconds.toFixed(1)} s · {numerator}/{denominator} fps
          </span>
        </div>
        <div className="video-timeline-toolbar-actions">
          <fieldset className="video-icon-controls">
            <legend className="visually-hidden">Edit history</legend>
            <button
              type="button"
              aria-label="Undo timeline edit"
              title="Undo"
              disabled={disabled || history.current.past.length === 0}
              onClick={undo}
            >
              <Undo2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Redo timeline edit"
              title="Redo"
              disabled={disabled || history.current.future.length === 0}
              onClick={redo}
            >
              <Redo2 size={15} aria-hidden="true" />
            </button>
          </fieldset>
          <Button
            size="sm"
            icon={Captions}
            onClick={addCaption}
            disabled={disabled || cannotAddCaption}
          >
            Add caption
          </Button>
          <Button
            size="sm"
            icon={Magnet}
            aria-pressed={snapping}
            title="Snap to the playhead, sequence bounds and clip edges"
            onClick={() => setSnapping((value) => !value)}
          >
            Snap {snapping ? "on" : "off"}
          </Button>
          <fieldset className="video-zoom-controls">
            <legend className="visually-hidden">Timeline zoom</legend>
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
            >
              <ZoomOut size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Fit timeline"
              title="Fit timeline"
              onClick={fitTimeline}
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= 4}
              onClick={() => setZoom((v) => Math.min(4, v + 0.25))}
            >
              <ZoomIn size={15} aria-hidden="true" />
            </button>
          </fieldset>
        </div>
      </div>

      {workspaceId && (
        <TimelinePreview
          workspaceId={workspaceId}
          document={document}
          frame={playhead}
          playing={playing}
          format={format}
          hiddenTracks={hiddenTracks}
          mutedTracks={mutedTracks}
        />
      )}

      <fieldset className="video-transport">
        <legend className="visually-hidden">Timeline transport</legend>
        <div className="video-transport-buttons">
          <button
            type="button"
            aria-label={playing ? "Pause timeline" : "Play timeline"}
            onClick={() => {
              if (!playing && playhead >= document.durationFrames) setPlayhead(0);
              setPlaying((v) => !v);
            }}
          >
            {playing ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </button>
          <button type="button" aria-label="Go to start" onClick={() => setPlayhead(0)}>
            <RotateCcw size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Previous frame"
            onClick={() => setPlayhead((v) => Math.max(0, v - 1))}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next frame"
            onClick={() => setPlayhead((v) => Math.min(document.durationFrames, v + 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <output aria-live="polite">
          {formatTimelineTimecode(playhead, numerator, denominator)}
        </output>
        <input
          aria-label="Playhead"
          type="range"
          min={0}
          max={document.durationFrames}
          value={Math.min(playhead, document.durationFrames)}
          onChange={(event) => setPlayhead(Number(event.target.value))}
        />
      </fieldset>

      <div className="video-timeline-viewport" ref={viewportRef}>
        <div className="video-timeline-canvas" style={{ minWidth: `${Math.round(760 * zoom)}px` }}>
          <div className="video-track-ruler">
            <div className="video-track-corner">Tracks</div>
            <div className="video-ruler-scale">
              {ticks.map((ratio) => (
                <span key={ratio} style={{ left: `${ratio * 100}%` }}>
                  {(durationSeconds * ratio).toFixed(durationSeconds < 20 ? 1 : 0)}s
                </span>
              ))}
              <input
                className="video-ruler-scrubber"
                aria-label="Timeline ruler"
                type="range"
                min={0}
                max={document.durationFrames}
                value={Math.min(playhead, document.durationFrames)}
                onChange={(event) => setPlayhead(Number(event.target.value))}
              />
            </div>
          </div>
          <div
            className="video-playhead"
            aria-hidden="true"
            style={{
              left: `calc(176px + (100% - 176px) * ${Math.min(1, playhead / document.durationFrames)})`,
            }}
          />
          {document.trackOrder.length === 0 && (
            <div className="video-timeline-empty">
              <Captions size={22} aria-hidden="true" />
              <span>No clips yet. Add a caption or ask an agent to arrange pinned media.</span>
            </div>
          )}
          {document.trackOrder.map((trackId) => {
            const track = document.tracksById[trackId];
            if (!track) return null;
            const meta = TRACK_META[track.kind];
            const TrackIcon = meta.icon;
            const isLocked = lockedTracks.has(trackId),
              isHidden = hiddenTracks.has(trackId),
              isMuted = mutedTracks.has(trackId);
            const hasAudio =
              track.kind === "voice" || track.kind === "music" || track.kind === "sfx";
            return (
              <div
                className="video-track-row"
                key={trackId}
                data-track-disabled={isHidden || isMuted || undefined}
              >
                <div className="video-track-label">
                  <TrackIcon size={15} aria-hidden="true" />
                  <span>
                    <strong>{meta.label}</strong>
                    <small>
                      {track.clipOrder.length} {track.clipOrder.length === 1 ? "clip" : "clips"}
                    </small>
                  </span>
                  <div className="video-track-controls">
                    {hasAudio ? (
                      <button
                        type="button"
                        aria-label={`${isMuted ? "Unmute" : "Mute"} ${meta.label} track in editor`}
                        aria-pressed={isMuted}
                        title={isMuted ? "Unmute in editor" : "Mute in editor"}
                        onClick={() => toggleSet(setMutedTracks, trackId)}
                      >
                        {isMuted ? (
                          <VolumeX size={13} aria-hidden="true" />
                        ) : (
                          <Volume2 size={13} aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`${isHidden ? "Show" : "Hide"} ${meta.label} track in editor`}
                        aria-pressed={isHidden}
                        title={isHidden ? "Show in editor" : "Hide in editor"}
                        onClick={() => toggleSet(setHiddenTracks, trackId)}
                      >
                        {isHidden ? (
                          <EyeOff size={13} aria-hidden="true" />
                        ) : (
                          <Eye size={13} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${isLocked ? "Unlock" : "Lock"} ${meta.label} track`}
                      aria-pressed={isLocked}
                      title={isLocked ? "Unlock track" : "Lock track"}
                      onClick={() => toggleSet(setLockedTracks, trackId)}
                    >
                      {isLocked ? (
                        <Lock size={13} aria-hidden="true" />
                      ) : (
                        <Unlock size={13} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                <div className={`video-track-lane video-track-lane-${track.kind}`}>
                  {track.clipOrder.map((clipId) => {
                    const clip = track.clipsById[clipId];
                    if (!clip) return null;
                    const label = clipLabel(clip),
                      selected = sameSelection(activeSelection, { trackId, clipId });
                    const targetSelection = { trackId, clipId };
                    const preview =
                      pointerPreview && sameSelection(pointerPreview.selection, targetSelection)
                        ? pointerPreview
                        : clip;
                    return (
                      <div
                        key={clipId}
                        className="video-timeline-clip-shell"
                        data-dragging={
                          sameSelection(pointerPreview?.selection, targetSelection) || undefined
                        }
                        style={{
                          left: `${Math.min(100, (preview.startFrame / document.durationFrames) * 100)}%`,
                          width: `${Math.max(1.5, Math.min(100, (preview.durationFrames / document.durationFrames) * 100))}%`,
                        }}
                      >
                        <button
                          type="button"
                          className="video-timeline-clip"
                          aria-pressed={selected}
                          aria-label={`${meta.label} clip: ${label}`}
                          aria-keyshortcuts="ArrowLeft ArrowRight Alt+ArrowLeft Alt+ArrowRight Shift+ArrowLeft Shift+ArrowRight Delete"
                          title={`${label} · ${(clip.durationFrames / fps).toFixed(2)} s · Drag to move`}
                          onClick={() => {
                            if (suppressClipClick.current) {
                              suppressClipClick.current = false;
                              return;
                            }
                            setSelection(targetSelection);
                            setPlayhead(clip.startFrame);
                          }}
                          onFocus={() => setSelection(targetSelection)}
                          onPointerDown={(event) =>
                            beginPointerEdit(event, "move", targetSelection, clip)
                          }
                          onPointerMove={updatePointerEdit}
                          onPointerUp={finishPointerEdit}
                          onPointerCancel={cancelPointerEdit}
                          onKeyDown={(event) => {
                            if (disabled || isLocked) return;
                            if (event.key === "Delete" || event.key === "Backspace") {
                              event.preventDefault();
                              deleteClip();
                            } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                              event.preventDefault();
                              const delta = event.key === "ArrowLeft" ? -1 : 1;
                              if (event.altKey) trimStart(delta);
                              else if (event.shiftKey) trimEnd(delta);
                              else moveClip(delta);
                            }
                          }}
                        >
                          <span>{label}</span>
                          <small>{(preview.durationFrames / fps).toFixed(1)}s</small>
                          {clip.startFrame + clip.durationFrames > document.durationFrames && (
                            <i title="Clip exceeds timeline">!</i>
                          )}
                        </button>
                        <button
                          type="button"
                          className="video-clip-trim-handle video-clip-trim-handle-start"
                          aria-label={`Trim start of ${label}`}
                          disabled={disabled || isLocked}
                          onClick={() => {
                            suppressClipClick.current = false;
                          }}
                          onPointerDown={(event) =>
                            beginPointerEdit(event, "trim-start", targetSelection, clip)
                          }
                          onPointerMove={updatePointerEdit}
                          onPointerUp={finishPointerEdit}
                          onPointerCancel={cancelPointerEdit}
                        />
                        <button
                          type="button"
                          className="video-clip-trim-handle video-clip-trim-handle-end"
                          aria-label={`Trim end of ${label}`}
                          disabled={disabled || isLocked}
                          onClick={() => {
                            suppressClipClick.current = false;
                          }}
                          onPointerDown={(event) =>
                            beginPointerEdit(event, "trim-end", targetSelection, clip)
                          }
                          onPointerMove={updatePointerEdit}
                          onPointerUp={finishPointerEdit}
                          onPointerCancel={cancelPointerEdit}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="video-timeline-settings">
        <output className="video-sequence-length" aria-labelledby="sequence-length-label">
          <span id="sequence-length-label">Sequence length</span>
          <strong>{formatTimelineTimecode(document.durationFrames, numerator, denominator)}</strong>
          <small>{durationSeconds.toFixed(2)} sec</small>
        </output>
        <span className="video-hint">
          Draft timing follows the arranged clips. Monitor controls do not change the final render.
        </span>
      </div>

      {activeSelection && activeTrack && activeClip && (
        <section className="video-clip-inspector" aria-label="Selected clip settings">
          <div className="video-clip-inspector-heading">
            <div>
              <span>Selected clip</span>
              <strong>{TRACK_META[activeTrack.kind].label}</strong>
            </div>
            <span>
              {formatTimelineTimecode(activeClip.startFrame, numerator, denominator)} –{" "}
              {formatTimelineTimecode(
                activeClip.startFrame + activeClip.durationFrames,
                numerator,
                denominator,
              )}
            </span>
          </div>
          <fieldset className="video-clip-actions">
            <legend className="visually-hidden">Selected clip actions</legend>
            <Button
              size="sm"
              icon={ChevronLeft}
              disabled={disabled || clipIsLocked || activeClip.startFrame === 0}
              onClick={() => moveClip(-1)}
            >
              Nudge left
            </Button>
            <Button
              size="sm"
              iconEnd={ChevronRight}
              disabled={
                disabled ||
                clipIsLocked ||
                activeClip.startFrame + activeClip.durationFrames >= document.durationFrames
              }
              onClick={() => moveClip(1)}
            >
              Nudge right
            </Button>
            <Button
              size="sm"
              icon={Scissors}
              disabled={disabled || clipIsLocked || !canSplit}
              onClick={splitClip}
            >
              Split at playhead
            </Button>
            <Button
              size="sm"
              icon={Copy}
              disabled={disabled || clipIsLocked || activeTrack.clipOrder.length >= 500}
              onClick={duplicateClip}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              disabled={disabled || clipIsLocked}
              onClick={deleteClip}
            >
              Delete
            </Button>
          </fieldset>
          <fieldset className="video-trim-controls">
            <legend className="visually-hidden">Frame trim controls</legend>
            <span>Trim one frame</span>
            <Button
              size="sm"
              disabled={disabled || clipIsLocked || activeClip.startFrame === 0}
              onClick={() => trimStart(-1)}
            >
              Start −
            </Button>
            <Button
              size="sm"
              disabled={disabled || clipIsLocked || activeClip.durationFrames <= 1}
              onClick={() => trimStart(1)}
            >
              Start +
            </Button>
            <Button
              size="sm"
              disabled={disabled || clipIsLocked || activeClip.durationFrames <= 1}
              onClick={() => trimEnd(-1)}
            >
              End −
            </Button>
            <Button
              size="sm"
              disabled={
                disabled ||
                clipIsLocked ||
                activeClip.startFrame + activeClip.durationFrames >= document.durationFrames
              }
              onClick={() => trimEnd(1)}
            >
              End +
            </Button>
          </fieldset>
          <div className="video-field-pair">
            <TextInput
              id={`${activeSelection.trackId}-${activeSelection.clipId}-start`}
              label="Start"
              labelVisible
              type="number"
              min={0}
              max={Number(((document.durationFrames - activeClip.durationFrames) / fps).toFixed(3))}
              step={Number((denominator / numerator).toFixed(6))}
              value={Number((activeClip.startFrame / fps).toFixed(3))}
              readOnly={disabled || clipIsLocked}
              trailingSlot={<span className="field-unit">sec</span>}
              onChange={(event) => {
                const value = Number(event.target.value),
                  startFrame = Math.round(value * fps);
                if (
                  Number.isFinite(value) &&
                  startFrame >= 0 &&
                  startFrame + activeClip.durationFrames <= document.durationFrames
                )
                  patchClip(activeSelection.trackId, activeSelection.clipId, { startFrame });
              }}
            />
            <TextInput
              id={`${activeSelection.trackId}-${activeSelection.clipId}-length`}
              label="Duration"
              labelVisible
              type="number"
              min={Number((denominator / numerator).toFixed(6))}
              max={Number(((document.durationFrames - activeClip.startFrame) / fps).toFixed(3))}
              step={Number((denominator / numerator).toFixed(6))}
              value={Number((activeClip.durationFrames / fps).toFixed(3))}
              readOnly={disabled || clipIsLocked}
              trailingSlot={<span className="field-unit">sec</span>}
              onChange={(event) => {
                const value = Number(event.target.value),
                  durationFrames = toFrames(value);
                if (
                  Number.isFinite(value) &&
                  value > 0 &&
                  activeClip.startFrame + durationFrames <= document.durationFrames
                )
                  patchClip(activeSelection.trackId, activeSelection.clipId, { durationFrames });
              }}
            />
          </div>
          {activeClip.source.kind === "text" ? (
            <TextInput
              id={`${activeSelection.trackId}-${activeSelection.clipId}-text`}
              label="Caption text"
              labelVisible
              value={activeClip.source.text}
              readOnly={disabled || clipIsLocked}
              onChange={(event) =>
                patchClip(activeSelection.trackId, activeSelection.clipId, {
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
          {clipIsLocked && (
            <p className="video-hint">Unlock this track to edit the selected clip.</p>
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
