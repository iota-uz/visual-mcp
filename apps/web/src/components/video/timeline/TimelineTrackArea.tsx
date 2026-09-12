import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  Dispatch,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../../packages/video/src/contracts";
import { useContextMenuTrigger } from "../../ui/ContextMenu";
import type { MenuItem } from "../../ui/Menu";
import { AssetWell } from "../shots/AssetWell";
import {
  type Clip,
  clipLabel,
  type PointerEditMode,
  type PointerEditResult,
  type Selection,
  sameSelection,
} from "./model";
import { TRACK_META } from "./trackMeta";

type PointerPreview = PointerEditResult & { selection: Selection };

export function TimelineTrackArea({
  document,
  durationSeconds,
  fps,
  zoom,
  playhead,
  selection,
  pointerPreview,
  lockedTracks,
  hiddenTracks,
  mutedTracks,
  disabled,
  workspaceId,
  viewportRef,
  suppressClipClick,
  setPlayhead,
  setSelection,
  toggleLocked,
  toggleHidden,
  toggleMuted,
  beginPointerEdit,
  updatePointerEdit,
  finishPointerEdit,
  cancelPointerEdit,
  deleteClip,
  moveClip,
  trimStart,
  trimEnd,
  splitClip,
  duplicateClip,
  onAddCaption,
}: {
  document: TimelineDocument;
  durationSeconds: number;
  fps: number;
  zoom: number;
  playhead: number;
  selection: Selection | undefined;
  pointerPreview: PointerPreview | undefined;
  lockedTracks: Set<string>;
  hiddenTracks: Set<string>;
  mutedTracks: Set<string>;
  disabled: boolean;
  workspaceId?: Id<"workspaces">;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  suppressClipClick: MutableRefObject<boolean>;
  setPlayhead: Dispatch<SetStateAction<number>>;
  setSelection: Dispatch<SetStateAction<Selection | undefined>>;
  toggleLocked: (trackId: string) => void;
  toggleHidden: (trackId: string) => void;
  toggleMuted: (trackId: string) => void;
  beginPointerEdit: (
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: PointerEditMode,
    selection: Selection,
    clip: Clip,
  ) => void;
  updatePointerEdit: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  finishPointerEdit: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  cancelPointerEdit: () => void;
  deleteClip: (target?: Selection) => void;
  moveClip: (delta: number, target?: Selection) => void;
  trimStart: (delta: number, target?: Selection) => void;
  trimEnd: (delta: number, target?: Selection) => void;
  splitClip: (target?: Selection) => void;
  duplicateClip: (target?: Selection) => void;
  /** Present only when the editor can add a caption right now. */
  onAddCaption?: () => void;
}) {
  const ticks = Array.from({ length: 9 }, (_, index) => index / 8);

  function clipMenu(trackId: string, clipId: string): { items: MenuItem[]; label: string } | null {
    const track = document.tracksById[trackId];
    const clip = track?.clipsById[clipId];
    if (!track || !clip) return null;
    const meta = TRACK_META[track.kind];
    const target = { trackId, clipId };
    setSelection(target);
    const locked = lockedTracks.has(trackId);
    const frozen = disabled || locked;
    const clipEnd = clip.startFrame + clip.durationFrames;
    const label = `${meta.label} clip: ${clipLabel(clip)}`;
    return {
      label,
      items: [
        {
          id: "nudge-left",
          label: "Nudge left",
          icon: ChevronLeft,
          disabled: frozen || clip.startFrame === 0,
          onSelect: () => moveClip(-1, target),
        },
        {
          id: "nudge-right",
          label: "Nudge right",
          icon: ChevronRight,
          disabled: frozen || clipEnd >= document.durationFrames,
          onSelect: () => moveClip(1, target),
        },
        {
          id: "split",
          label: "Split at playhead",
          icon: Scissors,
          disabled: frozen || playhead <= clip.startFrame || playhead >= clipEnd,
          onSelect: () => splitClip(target),
        },
        {
          id: "duplicate",
          label: "Duplicate",
          icon: Copy,
          disabled: frozen || track.clipOrder.length >= 500,
          onSelect: () => duplicateClip(target),
        },
        { id: "sep", separator: true as const },
        {
          id: "delete",
          label: "Delete clip",
          icon: Trash2,
          danger: true,
          disabled: frozen,
          onSelect: () => deleteClip(target),
        },
      ],
    };
  }

  function trackMenu(trackId: string): { items: MenuItem[]; label: string } | null {
    const track = document.tracksById[trackId];
    if (!track) return null;
    const meta = TRACK_META[track.kind];
    const locked = lockedTracks.has(trackId);
    const hasAudio = track.kind === "voice" || track.kind === "music" || track.kind === "sfx";
    const concealed = hasAudio ? mutedTracks.has(trackId) : hiddenTracks.has(trackId);
    return {
      label: `${meta.label} track`,
      items: [
        {
          id: "lock",
          label: locked ? "Unlock track" : "Lock track",
          icon: locked ? Unlock : Lock,
          onSelect: () => toggleLocked(trackId),
        },
        hasAudio
          ? {
              id: "mute",
              label: concealed ? "Unmute in editor" : "Mute in editor",
              icon: concealed ? VolumeX : Volume2,
              onSelect: () => toggleMuted(trackId),
            }
          : {
              id: "hide",
              label: concealed ? "Show in editor" : "Hide in editor",
              icon: concealed ? EyeOff : Eye,
              onSelect: () => toggleHidden(trackId),
            },
      ],
    };
  }

  const { triggerProps, menu } = useContextMenuTrigger({
    resolveAnchor: (target) => {
      const element = target instanceof HTMLElement ? target : null;
      const clip = element?.closest("[data-clip-id]");
      if (clip instanceof HTMLElement) return clip;
      const track = element?.closest("[data-track-id]");
      return track instanceof HTMLElement ? track : null;
    },
    getMenu: (anchor) => {
      const clipId = anchor.dataset.clipId;
      const trackId = anchor.dataset.trackId;
      if (clipId && trackId) return clipMenu(trackId, clipId);
      if (trackId) return trackMenu(trackId);
      return null;
    },
  });

  return (
    <div className="video-timeline-viewport" ref={viewportRef} {...triggerProps}>
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
            <p>No clips yet. Arrange pinned media, or start with a caption.</p>
            {onAddCaption && (
              <button type="button" onClick={onAddCaption}>
                Add caption
              </button>
            )}
          </div>
        )}
        {document.trackOrder.map((trackId) => {
          const track = document.tracksById[trackId];
          if (!track) return null;
          const meta = TRACK_META[track.kind];
          const TrackIcon = meta.icon;
          const isLocked = lockedTracks.has(trackId);
          const isHidden = hiddenTracks.has(trackId);
          const isMuted = mutedTracks.has(trackId);
          const hasAudio = track.kind === "voice" || track.kind === "music" || track.kind === "sfx";
          return (
            <div
              className="video-track-row"
              key={trackId}
              data-track-id={trackId}
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
                      onClick={() => toggleMuted(trackId)}
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
                      onClick={() => toggleHidden(trackId)}
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
                    onClick={() => toggleLocked(trackId)}
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
                  const label = clipLabel(clip);
                  const targetSelection = { trackId, clipId };
                  const selected = sameSelection(selection, targetSelection);
                  const preview =
                    pointerPreview && sameSelection(pointerPreview.selection, targetSelection)
                      ? pointerPreview
                      : clip;
                  return (
                    <div
                      key={clipId}
                      className="video-timeline-clip-shell"
                      data-clip-id={clipId}
                      data-track-id={trackId}
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
                        data-kind={track.kind}
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
                        {track.kind === "visual" && clip.source.kind === "asset" && workspaceId ? (
                          <AssetWell
                            workspaceId={workspaceId}
                            asset={clip.source.asset}
                            className="video-clip-frame"
                            fallback={<span>{label}</span>}
                          />
                        ) : null}
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
      {menu}
    </div>
  );
}
