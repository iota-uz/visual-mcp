import { useAction } from "convex/react";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import type { SceneNode } from "../../../../../packages/video/src/registry";

type AssetRef = { assetId: string; revisionId: string };
type ResolvedAsset = { url: string; mimeType: string; name: string };
type Clip = TimelineDocument["tracksById"][string]["clipsById"][string];

const assetKey = (asset: AssetRef) => `${asset.assetId}:${asset.revisionId}`;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const previewHeightStorageKey = "visual-canvas:video-preview-height";

function previewHeightLimits() {
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  return {
    min: 280,
    defaultValue: Math.round(Math.max(380, Math.min(720, viewportHeight * 0.58))),
    max: Math.round(Math.max(520, Math.min(900, viewportHeight * 0.82))),
  };
}

function initialPreviewHeight() {
  const limits = previewHeightLimits();
  if (typeof window === "undefined") return limits.defaultValue;
  const stored = Number(window.localStorage.getItem(previewHeightStorageKey));
  return Number.isFinite(stored) && stored >= limits.min && stored <= limits.max
    ? stored
    : limits.defaultValue;
}

function animatedValue(animation: SceneNode["animations"][number], frame: number) {
  const [first, ...rest] = animation.keyframes;
  if (!first) return 0;
  if (frame <= first.frame) return first.value;
  let previous = first;
  for (const next of rest) {
    if (frame <= next.frame) {
      const progress = clamp((frame - previous.frame) / (next.frame - previous.frame));
      const eased =
        next.easing === "ease_in"
          ? progress * progress
          : next.easing === "ease_out"
            ? 1 - (1 - progress) ** 2
            : next.easing === "ease_in_out"
              ? progress * progress * (3 - 2 * progress)
              : progress;
      return previous.value + (next.value - previous.value) * eased;
    }
    previous = next;
  }
  return previous.value;
}

function collectAssetRefs(document: TimelineDocument) {
  const refs = new Map<string, AssetRef>();
  for (const trackId of document.trackOrder) {
    const track = document.tracksById[trackId];
    if (!track) continue;
    for (const clipId of track.clipOrder) {
      const clip = track.clipsById[clipId];
      if (!clip) continue;
      if (clip.source.kind === "asset") refs.set(assetKey(clip.source.asset), clip.source.asset);
      if (
        clip.source.kind === "component" &&
        clip.source.component.resourceId === "video/component/scene-graph" &&
        "nodesById" in clip.source.props
      ) {
        for (const node of Object.values(clip.source.props.nodesById))
          if (node.kind === "image") refs.set(assetKey(node.asset), node.asset);
      }
    }
  }
  return [...refs.values()];
}

function clipStyle(clip: Clip, localFrame: number): CSSProperties {
  const layout = clip.layout ?? { x: 0, y: 0, width: 1, height: 1, fit: "cover" as const };
  let opacity = 1;
  let x = 0;
  let y = 0;
  let blur = 0;
  for (const effect of clip.effects ?? []) {
    const parameters = effect.parameters;
    if ("inFrames" in parameters) {
      opacity *= Math.min(
        parameters.inFrames ? clamp(localFrame / parameters.inFrames) : 1,
        parameters.outFrames
          ? clamp((clip.durationFrames - 1 - localFrame) / parameters.outFrames)
          : 1,
      );
    } else if ("fromX" in parameters) {
      const remaining = 1 - clamp(localFrame / parameters.durationFrames);
      x += parameters.fromX * remaining;
      y += parameters.fromY * remaining;
    } else blur += parameters.fromPx * (1 - clamp(localFrame / parameters.durationFrames));
  }
  const motionProgress = clamp(localFrame / Math.max(1, clip.durationFrames - 1));
  const scale =
    clip.motion === "push-in"
      ? 1 + motionProgress * 0.08
      : clip.motion === "pull-out"
        ? 1.08 - motionProgress * 0.08
        : 1;
  return {
    position: "absolute",
    left: `${layout.x * 100}%`,
    top: `${layout.y * 100}%`,
    width: `${layout.width * 100}%`,
    height: `${layout.height * 100}%`,
    opacity,
    filter: `blur(${blur}px)`,
    transform: `translate(${x * 100}%, ${y * 100}%) scale(${scale})`,
    transformOrigin: "center",
    overflow: "hidden",
  };
}

function AssetLayer({
  clip,
  frame,
  fps,
  playing,
  media,
}: {
  clip: Clip;
  frame: number;
  fps: number;
  playing: boolean;
  media?: ResolvedAsset;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const localFrame = Math.max(0, frame - clip.startFrame);
  const sourceStart = clip.source.kind === "asset" ? (clip.source.sourceStartMs ?? 0) / 1000 : 0;
  const sourceTime = sourceStart + localFrame / fps;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!playing || Math.abs(element.currentTime - sourceTime) > 0.18)
      element.currentTime = sourceTime;
    if (playing) void element.play().catch(() => {});
    else element.pause();
  }, [playing, sourceTime]);
  const style = clipStyle(clip, localFrame);
  const fit = clip.layout?.fit ?? "cover";
  if (!media)
    return (
      <div className="video-program-missing" style={style}>
        Loading pinned media…
      </div>
    );
  if (loadFailed)
    return (
      <div className="video-program-missing" style={style}>
        Pinned media is unavailable
      </div>
    );
  if (media.mimeType.startsWith("image/"))
    return (
      <img
        src={media.url}
        alt={`Draft frame: ${media.name}`}
        style={{ ...style, objectFit: fit }}
        onError={() => setLoadFailed(true)}
      />
    );
  if (media.mimeType.startsWith("video/"))
    return (
      <video
        ref={video}
        src={media.url}
        muted
        playsInline
        preload="auto"
        aria-label={`Draft video: ${media.name}`}
        style={{ ...style, objectFit: fit }}
        onError={() => setLoadFailed(true)}
      />
    );
  return (
    <div className="video-program-missing" style={style}>
      This asset is not visual.
    </div>
  );
}

function TextLayer({ clip, frame }: { clip: Clip; frame: number }) {
  if (clip.source.kind !== "text") return null;
  return (
    <div
      className="video-program-text"
      style={{
        ...clipStyle(clip, frame - clip.startFrame),
        color: clip.source.style?.color,
        fontFamily: clip.source.style?.fontFamily,
        fontSize: clip.source.style?.fontSize ? `${clip.source.style.fontSize}px` : undefined,
        textAlign: clip.source.style?.textAlign,
      }}
    >
      {clip.source.text}
    </div>
  );
}

function SceneGraphNode({
  node,
  frame,
  media,
  formatWidth,
}: {
  node: SceneNode;
  frame: number;
  media: Record<string, ResolvedAsset>;
  formatWidth: number;
}) {
  const geometry = {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    opacity: node.opacity,
    scale: node.scale,
    rotation: node.rotation,
    blur: 0,
  };
  for (const animation of node.animations)
    geometry[animation.property] = animatedValue(animation, frame);
  const style: CSSProperties = {
    position: "absolute",
    left: `${geometry.x * 100}%`,
    top: `${geometry.y * 100}%`,
    width: `${geometry.width * 100}%`,
    height: `${geometry.height * 100}%`,
    opacity: geometry.opacity,
    transform: `rotate(${geometry.rotation}deg) scale(${geometry.scale})`,
    filter: `blur(${geometry.blur}px)`,
    boxSizing: "border-box",
    overflow: "hidden",
  };
  if (node.kind === "text")
    return (
      <div
        style={{
          ...style,
          fontSize: `${(node.fontSize / formatWidth) * 100}cqw`,
          fontFamily:
            node.fontFamily === "serif"
              ? "serif"
              : node.fontFamily === "monospace"
                ? "monospace"
                : "sans-serif",
          color: node.color,
          textAlign: node.textAlign,
          fontWeight: node.fontWeight,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          lineHeight: 1.18,
        }}
      >
        {node.text}
      </div>
    );
  if (node.kind === "shape")
    return (
      <div
        style={{
          ...style,
          backgroundColor: node.fill,
          border: `${(node.borderWidth / formatWidth) * 100}cqw solid ${node.borderColor ?? node.fill}`,
          borderRadius: node.shape === "ellipse" ? "50%" : `${node.radius * 100}%`,
        }}
      />
    );
  const resolved = media[assetKey(node.asset)];
  if (!resolved)
    return (
      <div className="video-program-missing" style={style}>
        Loading pinned media…
      </div>
    );
  if (!resolved.mimeType.startsWith("image/"))
    return (
      <div className="video-program-missing" style={style}>
        This asset is not an image.
      </div>
    );
  return (
    <img
      src={resolved.url}
      alt={`Draft frame: ${resolved.name}`}
      style={{ ...style, objectFit: node.fit }}
    />
  );
}

function ComponentLayer({
  clip,
  frame,
  media,
  formatWidth,
}: {
  clip: Clip;
  frame: number;
  media: Record<string, ResolvedAsset>;
  formatWidth: number;
}) {
  if (clip.source.kind !== "component") return null;
  const props = clip.source.props;
  const localFrame = frame - clip.startFrame;
  const shellStyle = clipStyle(clip, localFrame);
  if (clip.source.component.resourceId === "video/component/scene-graph" && "nodesById" in props)
    return (
      <div style={{ ...shellStyle, background: props.background, containerType: "inline-size" }}>
        {props.nodeOrder.map((id) => {
          const node = props.nodesById[id];
          return node ? (
            <SceneGraphNode
              key={id}
              node={node}
              frame={localFrame}
              media={media}
              formatWidth={formatWidth}
            />
          ) : null;
        })}
      </div>
    );
  if (clip.source.component.resourceId === "video/component/big-stat" && "value" in props)
    return (
      <div
        className="video-program-component video-program-big-stat"
        style={{ ...shellStyle, background: props.background, color: props.color }}
      >
        <strong style={{ opacity: clamp(localFrame / props.revealFrames) }}>{props.value}</strong>
        <span>{props.label}</span>
        <small>{props.source}</small>
      </div>
    );
  if (clip.source.component.resourceId === "video/component/animated-bars" && "entries" in props)
    return (
      <div
        className="video-program-component"
        style={{ ...shellStyle, background: props.background, color: props.color }}
      >
        <strong>{props.title}</strong>
        {props.entries.map((entry) => (
          <div className="video-program-bar" key={entry.label}>
            <span>{entry.label}</span>
            <i
              style={{
                width: `${entry.value * clamp(localFrame / props.revealFrames) * 100}%`,
                background: entry.color,
              }}
            />
          </div>
        ))}
        <small>{props.disclaimer}</small>
      </div>
    );
  if (clip.source.component.resourceId === "video/component/compare" && "left" in props)
    return (
      <div
        className="video-program-component"
        style={{ ...shellStyle, background: props.background, color: props.color }}
      >
        <strong>{props.title}</strong>
        <div className="video-program-compare">
          {[props.left, props.right].map((column) => (
            <div key={column.title} style={{ borderColor: column.color }}>
              <b>{column.title}</b>
              <span>{column.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  return (
    <div className="video-program-missing" style={shellStyle}>
      Generated graphic
    </div>
  );
}

function AudioLayer({
  clip,
  frame,
  fps,
  playing,
  media,
  muted,
}: {
  clip: Clip;
  frame: number;
  fps: number;
  playing: boolean;
  media?: ResolvedAsset;
  muted: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const localFrame = Math.max(0, frame - clip.startFrame);
  const sourceStart = clip.source.kind === "asset" ? (clip.source.sourceStartMs ?? 0) / 1000 : 0;
  const sourceTime = sourceStart + localFrame / fps;
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = muted ? 0 : clamp(10 ** ((clip.audio?.gainDb ?? 0) / 20));
    if (!playing || Math.abs(element.currentTime - sourceTime) > 0.18)
      element.currentTime = sourceTime;
    if (playing && !muted) void element.play().catch(() => {});
    else element.pause();
  }, [clip.audio?.gainDb, muted, playing, sourceTime]);
  if (!media?.mimeType.startsWith("audio/") && !media?.mimeType.startsWith("video/")) return null;
  // biome-ignore lint/a11y/useMediaCaption: Audio follows the separately rendered caption track.
  return <audio ref={audio} src={media.url} preload="auto" />;
}

export function TimelinePreview({
  workspaceId,
  document,
  frame,
  playing,
  format,
  hiddenTracks,
  mutedTracks,
}: {
  workspaceId: Id<"workspaces">;
  document: TimelineDocument;
  frame: number;
  playing: boolean;
  format: { width: number; height: number };
  hiddenTracks: Set<string>;
  mutedTracks: Set<string>;
}) {
  const resolve = useAction(api.videoMedia.previewAsset);
  const refs = useMemo(() => collectAssetRefs(document), [document]);
  const [media, setMedia] = useState<Record<string, ResolvedAsset>>({});
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [previewHeight, setPreviewHeight] = useState(initialPreviewHeight);
  const resize = useRef<{ startY: number; startHeight: number } | undefined>(undefined);
  const limits = previewHeightLimits();
  const setClampedPreviewHeight = (height: number) =>
    setPreviewHeight(Math.round(Math.max(limits.min, Math.min(limits.max, height))));
  function startResize(event: ReactPointerEvent<HTMLHRElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resize.current = { startY: event.clientY, startHeight: previewHeight };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function updateResize(event: ReactPointerEvent<HTMLHRElement>) {
    if (!resize.current) return;
    setClampedPreviewHeight(resize.current.startHeight + event.clientY - resize.current.startY);
  }
  function finishResize(event: ReactPointerEvent<HTMLHRElement>) {
    if (!resize.current) return;
    updateResize(event);
    resize.current = undefined;
  }
  useEffect(() => {
    window.localStorage.setItem(previewHeightStorageKey, String(previewHeight));
  }, [previewHeight]);
  useEffect(() => {
    let active = true;
    for (const asset of refs) {
      const key = assetKey(asset);
      if (media[key] || failed.has(key)) continue;
      void resolve({
        workspaceId,
        asset: asset as { assetId: Id<"assets">; revisionId: Id<"assetVersions"> },
      })
        .then((value) => {
          if (active) setMedia((current) => ({ ...current, [key]: value }));
        })
        .catch(() => {
          if (active) setFailed((current) => new Set(current).add(key));
        });
    }
    return () => {
      active = false;
    };
  }, [failed, media, refs, resolve, workspaceId]);
  const displayFrame = Math.min(Math.max(0, frame), Math.max(0, document.durationFrames - 1));
  const fps = document.fps.numerator / document.fps.denominator;
  const active = document.trackOrder.flatMap((trackId) => {
    const track = document.tracksById[trackId];
    if (!track) return [];
    return track.clipOrder.flatMap((clipId) => {
      const clip = track.clipsById[clipId];
      return clip &&
        displayFrame >= clip.startFrame &&
        displayFrame < clip.startFrame + clip.durationFrames
        ? [{ trackId, track, clipId, clip }]
        : [];
    });
  });
  const visuals = active.filter(
    ({ trackId, track }) => track.kind === "visual" && !hiddenTracks.has(trackId),
  );
  // Why the stage is empty has three different causes, and each needs its
  // own message: the user hid the tracks (a Show action undoes it), the
  // playhead sits in a gap between visual clips, or the timeline has no
  // visual clips at all.
  const hiddenVisualsAtFrame = active.filter(
    ({ trackId, track }) => track.kind === "visual" && hiddenTracks.has(trackId),
  );
  const hasVisualClips = document.trackOrder.some(
    (trackId) =>
      document.tracksById[trackId]?.kind === "visual" &&
      (document.tracksById[trackId]?.clipOrder.length ?? 0) > 0,
  );
  const emptyVisualNote = hiddenVisualsAtFrame.length
    ? "Visual tracks are hidden in the editor"
    : hasVisualClips
      ? "No visual at this frame"
      : "No visual clips on the timeline yet";
  const captions = active.filter(
    ({ trackId, track }) => track.kind === "caption" && !hiddenTracks.has(trackId),
  );
  const audio = active.filter(
    ({ track }) => track.kind === "voice" || track.kind === "music" || track.kind === "sfx",
  );
  return (
    <section className="video-program-monitor" aria-label="Draft monitor">
      <div className="video-program-heading">
        <div>
          <strong>Draft monitor</strong>
          <span>Live approximation · final MP4 is reviewed separately</span>
        </div>
        <fieldset className="video-icon-controls video-program-size-controls">
          <legend className="visually-hidden">Preview size</legend>
          <button
            type="button"
            aria-label="Shrink preview"
            title="Shrink preview"
            disabled={previewHeight <= limits.min}
            onClick={() => setClampedPreviewHeight(previewHeight - 80)}
          >
            <Minimize2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Reset preview size"
            title="Reset preview size"
            onClick={() => setPreviewHeight(limits.defaultValue)}
          >
            <RotateCcw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Enlarge preview"
            title="Enlarge preview"
            disabled={previewHeight >= limits.max}
            onClick={() => setClampedPreviewHeight(previewHeight + 80)}
          >
            <Maximize2 size={15} aria-hidden="true" />
          </button>
        </fieldset>
      </div>
      <div className="video-program-stage-wrap">
        <div
          className="video-program-stage"
          style={{
            aspectRatio: `${format.width} / ${format.height}`,
            width: `min(100%, ${previewHeight * (format.width / format.height)}px)`,
          }}
          role="img"
          aria-label="Timeline draft preview"
        >
          {visuals.length === 0 && (
            <span className="video-program-empty" role="status">
              {emptyVisualNote}
            </span>
          )}
          {visuals.map(({ trackId, clipId, clip }) => {
            const key = clip.source.kind === "asset" ? assetKey(clip.source.asset) : "";
            if (clip.source.kind === "asset")
              return (
                <AssetLayer
                  key={`${trackId}:${clipId}:${media[key]?.url ?? "pending"}`}
                  clip={clip}
                  frame={displayFrame}
                  fps={fps}
                  playing={playing}
                  media={media[key]}
                />
              );
            if (clip.source.kind === "text")
              return <TextLayer key={`${trackId}:${clipId}`} clip={clip} frame={displayFrame} />;
            return (
              <ComponentLayer
                key={`${trackId}:${clipId}`}
                clip={clip}
                frame={displayFrame}
                media={media}
                formatWidth={format.width}
              />
            );
          })}
          {captions.map(({ trackId, clipId, clip }) => (
            <TextLayer key={`${trackId}:${clipId}`} clip={clip} frame={displayFrame} />
          ))}
          {audio.map(({ trackId, clipId, clip }) => {
            if (clip.source.kind !== "asset") return null;
            return (
              <AudioLayer
                key={`${trackId}:${clipId}`}
                clip={clip}
                frame={displayFrame}
                fps={fps}
                playing={playing}
                media={media[assetKey(clip.source.asset)]}
                muted={mutedTracks.has(trackId)}
              />
            );
          })}
        </div>
      </div>
      <hr
        className="video-program-resize-handle"
        tabIndex={0}
        aria-label="Resize draft monitor"
        aria-orientation="horizontal"
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={previewHeight}
        title="Drag to resize preview"
        onPointerDown={startResize}
        onPointerMove={updateResize}
        onPointerUp={finishResize}
        onPointerCancel={() => {
          resize.current = undefined;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setClampedPreviewHeight(previewHeight + (event.key === "ArrowUp" ? 40 : -40));
          } else if (event.key === "Home") {
            event.preventDefault();
            setPreviewHeight(limits.min);
          } else if (event.key === "End") {
            event.preventDefault();
            setPreviewHeight(limits.max);
          }
        }}
      />
      {failed.size > 0 && (
        <button
          type="button"
          className="video-program-retry"
          onClick={() => {
            setFailed(new Set());
            setMedia({});
          }}
        >
          Retry unavailable media
        </button>
      )}
    </section>
  );
}
