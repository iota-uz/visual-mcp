import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Copy,
  Magnet,
  Maximize2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { useMemo, useRef, useState } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";
import { TimelinePreview } from "./TimelinePreview";
import {
  type Clip,
  calculatePointerEdit,
  formatTimelineTimecode,
  newTimelineKey,
  type PointerEditMode,
  type PointerEditResult,
  type PointerInteraction,
  type Selection,
} from "./timeline/model";
import { TimelineTrackArea } from "./timeline/TimelineTrackArea";
import { TimelineTransport } from "./timeline/TimelineTransport";
import { TRACK_META } from "./timeline/trackMeta";
import { useTimelineHistory } from "./timeline/useTimelineHistory";
import { useTimelinePlayback } from "./timeline/useTimelinePlayback";

export { calculatePointerEdit, formatTimelineTimecode } from "./timeline/model";

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
  const { playhead, setPlayhead, playing, setPlaying, togglePlayback } = useTimelinePlayback(
    document.durationFrames,
    fps,
  );
  const [snapping, setSnapping] = useState(true);
  const [selection, setSelection] = useState<Selection>();
  const [pointerPreview, setPointerPreview] = useState<
    (PointerEditResult & { selection: Selection }) | undefined
  >();
  const [lockedTracks, setLockedTracks] = useState<Set<string>>(() => new Set());
  const [hiddenTracks, setHiddenTracks] = useState<Set<string>>(() => new Set());
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(() => new Set());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerInteraction = useRef<PointerInteraction | undefined>(undefined);
  const suppressClipClick = useRef(false);
  const { latestDocument, commit, undo, redo, canUndo, canRedo } = useTimelineHistory(
    document,
    onChange,
    disabled,
  );

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
    const trackId = existingTrackId ?? newTimelineKey("caption");
    const clipId = newTimelineKey("caption");
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
  function moveClip(delta: number, target: Selection | undefined = activeSelection) {
    if (!target) return;
    const track = document.tracksById[target.trackId];
    const clip = track?.clipsById[target.clipId];
    if (!clip) return;
    patchClip(target.trackId, target.clipId, {
      startFrame: Math.max(
        0,
        Math.min(document.durationFrames - clip.durationFrames, clip.startFrame + delta),
      ),
    });
  }
  function trimStart(delta: number, target: Selection | undefined = activeSelection) {
    if (!target) return;
    const track = document.tracksById[target.trackId];
    const clip = track?.clipsById[target.clipId];
    if (!clip) return;
    const nextStart = Math.max(
      0,
      Math.min(clip.startFrame + clip.durationFrames - 1, clip.startFrame + delta),
    );
    patchClip(target.trackId, target.clipId, {
      startFrame: nextStart,
      durationFrames: clip.durationFrames + clip.startFrame - nextStart,
    });
  }
  function trimEnd(delta: number, target: Selection | undefined = activeSelection) {
    if (!target) return;
    const track = document.tracksById[target.trackId];
    const clip = track?.clipsById[target.clipId];
    if (!clip) return;
    patchClip(target.trackId, target.clipId, {
      durationFrames: Math.max(
        1,
        Math.min(document.durationFrames - clip.startFrame, clip.durationFrames + delta),
      ),
    });
  }
  function splitClip(target: Selection | undefined = activeSelection) {
    if (!target || disabled) return;
    const track = document.tracksById[target.trackId];
    const clip = track?.clipsById[target.clipId];
    if (!track || !clip) return;
    const clipEnd = clip.startFrame + clip.durationFrames;
    if (playhead <= clip.startFrame || playhead >= clipEnd) return;
    const current = latestDocument.current;
    const liveTrack = current.tracksById[target.trackId];
    if (!liveTrack || lockedTracks.has(target.trackId)) return;
    const secondId = newTimelineKey("clip");
    const index = liveTrack.clipOrder.indexOf(target.clipId);
    const nextOrder = [...liveTrack.clipOrder];
    nextOrder.splice(index + 1, 0, secondId);
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [target.trackId]: {
          ...liveTrack,
          clipOrder: nextOrder,
          clipsById: {
            ...liveTrack.clipsById,
            [target.clipId]: {
              ...clip,
              durationFrames: playhead - clip.startFrame,
            },
            [secondId]: { ...clip, startFrame: playhead, durationFrames: clipEnd - playhead },
          },
        },
      },
    });
    setSelection({ trackId: target.trackId, clipId: secondId });
  }
  function duplicateClip(target: Selection | undefined = activeSelection) {
    if (!target) return;
    const track = document.tracksById[target.trackId];
    const clip = track?.clipsById[target.clipId];
    if (!track || !clip || disabled) return;
    const current = latestDocument.current;
    const liveTrack = current.tracksById[target.trackId];
    if (!liveTrack || liveTrack.clipOrder.length >= 500 || lockedTracks.has(target.trackId)) return;
    const clipId = newTimelineKey("clip");
    const startFrame = Math.min(
      document.durationFrames - clip.durationFrames,
      clip.startFrame + clip.durationFrames,
    );
    const index = liveTrack.clipOrder.indexOf(target.clipId);
    const nextOrder = [...liveTrack.clipOrder];
    nextOrder.splice(index + 1, 0, clipId);
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [target.trackId]: {
          ...liveTrack,
          clipOrder: nextOrder,
          clipsById: { ...liveTrack.clipsById, [clipId]: { ...clip, startFrame } },
        },
      },
    });
    setSelection({ trackId: target.trackId, clipId });
  }
  function deleteClip(target: Selection | undefined = activeSelection) {
    if (!target || disabled || lockedTracks.has(target.trackId)) return;
    const current = latestDocument.current;
    const track = current.tracksById[target.trackId];
    if (!track) return;
    const clipsById = { ...track.clipsById };
    delete clipsById[target.clipId];
    commit({
      ...current,
      tracksById: {
        ...current.tracksById,
        [target.trackId]: {
          ...track,
          clipOrder: track.clipOrder.filter((id) => id !== target.clipId),
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
              disabled={disabled || !canUndo}
              onClick={undo}
            >
              <Undo2 size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Redo timeline edit"
              title="Redo"
              disabled={disabled || !canRedo}
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

      <TimelineTransport
        playhead={playhead}
        playing={playing}
        durationFrames={document.durationFrames}
        numerator={numerator}
        denominator={denominator}
        setPlayhead={setPlayhead}
        onTogglePlayback={togglePlayback}
      />

      <TimelineTrackArea
        document={document}
        durationSeconds={durationSeconds}
        fps={fps}
        zoom={zoom}
        playhead={playhead}
        selection={activeSelection}
        pointerPreview={pointerPreview}
        lockedTracks={lockedTracks}
        hiddenTracks={hiddenTracks}
        mutedTracks={mutedTracks}
        disabled={disabled}
        viewportRef={viewportRef}
        suppressClipClick={suppressClipClick}
        setPlayhead={setPlayhead}
        setSelection={setSelection}
        toggleLocked={(trackId) => toggleSet(setLockedTracks, trackId)}
        toggleHidden={(trackId) => toggleSet(setHiddenTracks, trackId)}
        toggleMuted={(trackId) => toggleSet(setMutedTracks, trackId)}
        beginPointerEdit={beginPointerEdit}
        updatePointerEdit={updatePointerEdit}
        finishPointerEdit={finishPointerEdit}
        cancelPointerEdit={cancelPointerEdit}
        deleteClip={deleteClip}
        moveClip={moveClip}
        trimStart={trimStart}
        trimEnd={trimEnd}
        splitClip={splitClip}
        duplicateClip={duplicateClip}
      />

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
              onClick={() => splitClip()}
            >
              Split at playhead
            </Button>
            <Button
              size="sm"
              icon={Copy}
              disabled={disabled || clipIsLocked || activeTrack.clipOrder.length >= 500}
              onClick={() => duplicateClip()}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              disabled={disabled || clipIsLocked}
              onClick={() => deleteClip()}
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
