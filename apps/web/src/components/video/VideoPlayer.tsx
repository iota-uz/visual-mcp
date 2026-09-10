import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

export type VideoReviewAsset = {
  jobId: string;
  versionId: string;
  language: "ru" | "uz";
  sha256: string;
  videoUrl: string;
  posterUrl?: string;
  captionsUrl?: string;
  width: number;
  height: number;
  durationMs: number;
  frameCount: number;
  videoDurationMs: number;
  containerDurationMs: number;
  fps: { numerator: number; denominator: number };
  partial: boolean;
};
export type VideoRegion = { x: number; y: number; width: number; height: number };
/** Remount with exact target key. Load failure resets the human acknowledgement. */
export function VideoPlayer({
  asset,
  onLoaded,
  onTime,
  seekMs,
  region,
  onRefresh,
}: {
  asset: VideoReviewAsset;
  onLoaded: (ready: boolean) => void;
  onTime: (milliseconds: number) => void;
  seekMs?: number;
  region?: VideoRegion;
  onRefresh?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const playback = useRef({ hash: asset.sha256, time: 0, paused: true });
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fps = asset.fps.numerator / asset.fps.denominator;
  const lastFrame = Math.max(0, asset.frameCount - 1);
  const lastAnchorMs = Math.ceil((lastFrame / fps) * 1000);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (seekMs !== undefined && video.current) {
      video.current.pause();
      video.current.currentTime = Math.max(0, Math.min(seekMs, lastAnchorMs)) / 1000;
    }
  }, [seekMs, lastAnchorMs]);
  return (
    <section className="video-player" aria-label="Rendered video">
      <div className="video-player-heading">
        <strong>
          {asset.language.toUpperCase()} · {asset.partial ? "Partial preview" : "Exact MP4"}
        </strong>
        <span>
          {asset.width} × {asset.height}
        </span>
      </div>
      <div className="video-player-stage">
        <div
          className="video-player-frame"
          style={{ aspectRatio: `${asset.width}/${asset.height}` }}
        >
          {/* biome-ignore lint/a11y/useMediaCaption: The actual optional pinned caption track is included below; do not fabricate captions when unavailable. */}
          <video
            key={`${asset.sha256}-${asset.videoUrl}-${attempt}`}
            ref={video}
            controls
            playsInline
            preload="metadata"
            poster={asset.posterUrl}
            aria-label="Video preview"
            onLoadedData={() => {
              setError(false);
              onLoaded(true);
            }}
            onLoadedMetadata={(event) => {
              const prior = playback.current;
              event.currentTarget.currentTime =
                Math.max(
                  0,
                  Math.min(
                    seekMs ?? (prior.hash === asset.sha256 ? prior.time * 1000 : 0),
                    lastAnchorMs,
                  ),
                ) / 1000;
              if (prior.hash === asset.sha256 && !prior.paused)
                void event.currentTarget.play().catch(() => {});
            }}
            onPlay={() => {
              playback.current.paused = false;
            }}
            onPause={() => {
              playback.current.paused = true;
            }}
            onError={() => {
              setError(true);
              onLoaded(false);
            }}
            onTimeUpdate={(event) => {
              playback.current = {
                hash: asset.sha256,
                time: event.currentTarget.currentTime,
                paused: event.currentTarget.paused,
              };
              const frame = Math.min(
                lastFrame,
                Math.max(0, Math.floor(event.currentTarget.currentTime * fps)),
              );
              setFrame(frame);
              onTime(Math.ceil((frame / fps) * 1000));
            }}
          >
            <source src={asset.videoUrl} type="video/mp4" />
            {asset.captionsUrl && (
              <track
                kind="captions"
                src={asset.captionsUrl}
                srcLang={asset.language}
                label={asset.language.toUpperCase()}
              />
            )}
            Your browser cannot play this video. Use the download link.
          </video>
          {region && (
            <div
              className="video-region-overlay"
              role="img"
              aria-label="Saved comment region"
              style={{
                left: `${region.x * 100}%`,
                top: `${region.y * 100}%`,
                width: `${region.width * 100}%`,
                height: `${region.height * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="video-actions">
        <span className="video-hint">
          Frame {frame} of {lastFrame} · {(frame / fps).toFixed(3)} s · video{" "}
          {(asset.videoDurationMs / 1000).toFixed(3)} s (container{" "}
          {(asset.containerDurationMs / 1000).toFixed(3)} s)
        </span>
        <a href={asset.videoUrl} download>
          Download {asset.partial ? "preview" : "MP4"}
        </a>
      </div>
      {error && (
        <div role="alert">
          <p>The video could not load. Your feedback is unchanged.</p>
          <Button
            onClick={() => {
              onLoaded(false);
              onRefresh?.();
              setAttempt((value) => value + 1);
            }}
          >
            Reload video
          </Button>
        </div>
      )}
      {asset.partial && (
        <p className="video-hint">
          This is a range preview, not a full video. Human approval is unavailable.
        </p>
      )}
    </section>
  );
}
