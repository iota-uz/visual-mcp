import type { TimelineDocument } from "@visual-canvas/video";
import { type CSSProperties, useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { effectStyle, TrustedComponent } from "./components.js";

declare const FontFace: new (family: string, source: string) => { load(): Promise<unknown> };
declare const document: { fonts: { add(font: unknown): void } };

export type RenderProps = {
  format: { width: number; height: number; fps: { numerator: number; denominator: number } };
  timeline: TimelineDocument;
  files: Record<string, { path: string; mimeType: string }>;
};
type Clip = TimelineDocument["tracksById"][string]["clipsById"][string];

function ClipView({ clip, props, kind }: { clip: Clip; props: RenderProps; kind: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={effectStyle(clip.effects ?? [], frame, clip.durationFrames)}>
      <ClipContent clip={clip} props={props} kind={kind} />
    </AbsoluteFill>
  );
}
function ClipContent({ clip, props, kind }: { clip: Clip; props: RenderProps; kind: string }) {
  const frame = useCurrentFrame();
  const fps = props.format.fps.numerator / props.format.fps.denominator;
  const progress = frame / Math.max(1, clip.durationFrames - 1);
  const scale =
    clip.motion === "push-in"
      ? 1 + progress * 0.08
      : clip.motion === "pull-out"
        ? 1.08 - progress * 0.08
        : 1;
  const layout = clip.layout ?? { x: 0, y: 0, width: 1, height: 1, fit: "cover" as const };
  const position: CSSProperties = {
    position: "absolute",
    left: `${layout.x * 100}%`,
    top: `${layout.y * 100}%`,
    width: `${layout.width * 100}%`,
    height: `${layout.height * 100}%`,
    overflow: "hidden",
  };
  const visual: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: layout.fit,
    transform: `scale(${scale})`,
  };
  if (clip.source.kind === "component")
    return (
      <div style={position}>
        <TrustedComponent
          source={clip.source}
          frame={frame}
          files={props.files}
          width={props.format.width * layout.width}
        />
      </div>
    );
  if (clip.source.kind === "text") {
    const style = clip.source.style;
    const family =
      style?.fontFamily === "serif"
        ? "DejaVu Serif"
        : style?.fontFamily === "monospace"
          ? "DejaVu Sans Mono"
          : "DejaVu Sans";
    return (
      <div
        style={{
          ...position,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "5%",
          boxSizing: "border-box",
          color: style?.color ?? "#ffffff",
          fontFamily: family,
          fontSize: style?.fontSize ?? Math.round(props.format.width * 0.055),
          textAlign: style?.textAlign ?? "center",
          lineHeight: 1.2,
          fontWeight: 600,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
        data-qa-caption={kind === "caption" ? "true" : undefined}
      >
        {clip.source.text}
      </div>
    );
  }
  const file = props.files[`${clip.source.asset.assetId}:${clip.source.asset.revisionId}`];
  if (!file) throw new Error("Pinned clip source is missing");
  const src = staticFile(file.path);
  const start = Math.round(((clip.source.sourceStartMs ?? 0) / 1000) * fps);
  const volume = (localFrame: number) => {
    const elapsedMs = (localFrame / fps) * 1000;
    const remainingMs = ((clip.durationFrames - localFrame) / fps) * 1000;
    const fadeIn = clip.audio?.fadeInMs ? Math.min(1, elapsedMs / clip.audio.fadeInMs) : 1;
    const fadeOut = clip.audio?.fadeOutMs ? Math.min(1, remainingMs / clip.audio.fadeOutMs) : 1;
    return 10 ** ((clip.audio?.gainDb ?? 0) / 20) * Math.max(0, Math.min(fadeIn, fadeOut));
  };
  if (file.mimeType.startsWith("audio/"))
    return <Audio src={src} trimBefore={start} volume={volume} />;
  if (file.mimeType.startsWith("video/"))
    return (
      <div style={position}>
        <OffthreadVideo
          src={src}
          trimBefore={start}
          muted={!clip.audio}
          volume={volume}
          style={visual}
        />
      </div>
    );
  return (
    <div style={position}>
      <Img src={src} style={visual} />
    </div>
  );
}

export function VideoComposition(props: RenderProps) {
  const [fontHandle] = useState(() => delayRender("Loading pinned renderer fonts"));
  useEffect(() => {
    Promise.all(
      [
        ["DejaVu Sans", "DejaVuSans.ttf"],
        ["DejaVu Serif", "DejaVuSerif.ttf"],
        ["DejaVu Sans Mono", "DejaVuSansMono.ttf"],
      ].map(async ([family, path]) => {
        const font = new FontFace(family!, `url(${staticFile(path!)})`);
        document.fonts.add(await font.load());
      }),
    )
      .then(() => continueRender(fontHandle))
      .catch((error: Error) => cancelRender(error));
  }, [fontHandle]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#061b36", overflow: "hidden" }}>
      {props.timeline.trackOrder.flatMap((trackId) => {
        const track = props.timeline.tracksById[trackId];
        if (!track) return [];
        return track.clipOrder.map((clipId) => {
          const clip = track.clipsById[clipId];
          return clip ? (
            <Sequence
              key={`${trackId}:${clipId}`}
              from={clip.startFrame}
              durationInFrames={clip.durationFrames}
            >
              <ClipView clip={clip} props={props} kind={track.kind} />
            </Sequence>
          ) : null;
        });
      })}
    </AbsoluteFill>
  );
}
