import { useAction } from "convex/react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { TimelineDocument } from "../../../../../packages/video/src/contracts";

type AssetRef = { assetId: string; revisionId: string };
type ResolvedAsset = { url: string; mimeType: string; name: string };
type Clip = TimelineDocument["tracksById"][string]["clipsById"][string];

const assetKey = (asset: AssetRef) => `${asset.assetId}:${asset.revisionId}`;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

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

function ComponentLayer({ clip, frame }: { clip: Clip; frame: number }) {
  if (clip.source.kind !== "component") return null;
  const props = clip.source.props;
  const localFrame = frame - clip.startFrame;
  const shellStyle = clipStyle(clip, localFrame);
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
  const captions = active.filter(
    ({ trackId, track }) => track.kind === "caption" && !hiddenTracks.has(trackId),
  );
  const audio = active.filter(
    ({ track }) => track.kind === "voice" || track.kind === "music" || track.kind === "sfx",
  );
  return (
    <section className="video-program-monitor" aria-label="Draft monitor">
      <div className="video-program-heading">
        <strong>Draft monitor</strong>
        <span>Live approximation · final MP4 is reviewed separately</span>
      </div>
      <div className="video-program-stage-wrap">
        <div
          className="video-program-stage"
          style={{ aspectRatio: `${format.width} / ${format.height}` }}
          role="img"
          aria-label="Timeline draft preview"
        >
          {visuals.length === 0 && (
            <span className="video-program-empty">No visual at this frame</span>
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
            return <ComponentLayer key={`${trackId}:${clipId}`} clip={clip} frame={displayFrame} />;
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
