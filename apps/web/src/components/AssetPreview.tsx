import { FileJson, FileType2, Image as ImageIcon, Video } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type PreviewableAssetKind = "image" | "svg" | "font" | "video" | "audio" | "data";

export interface AssetPreviewProps {
  assetId: string;
  kind: PreviewableAssetKind;
  name: string;
  previewUrl: string;
  mode?: "card" | "full";
  eager?: boolean;
}

const AUDIO_DECODE_MAX_BYTES = 8 * 1024 * 1024;
const AUDIO_BARS_CARD = 72;
const AUDIO_BARS_FULL = 128;

function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function decorativePeaks(seed: string, count: number): number[] {
  let state = fnv1a(seed) || 1;
  const peaks = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const t = count === 1 ? 0.5 : i / (count - 1);
    const envelope = Math.sin(Math.PI * t);
    const noise = (state % 1000) / 1000;
    peaks[i] = 0.12 + envelope * (0.28 + noise * 0.6);
  }
  return peaks;
}

function peaksFromBuffer(buffer: AudioBuffer, count: number): number[] {
  const channel = buffer.getChannelData(0);
  const bucket = Math.max(1, Math.floor(channel.length / count));
  const step = Math.max(1, Math.floor(bucket / 48));
  const peaks = new Array<number>(count);
  let max = 0.0001;
  for (let i = 0; i < count; i += 1) {
    const start = i * bucket;
    const end = i === count - 1 ? channel.length : Math.min(channel.length, start + bucket);
    let peak = 0;
    for (let sample = start; sample < end; sample += step) {
      const value = Math.abs(channel[sample] ?? 0);
      if (value > peak) peak = value;
    }
    peaks[i] = peak;
    if (peak > max) max = peak;
  }
  return peaks.map((peak) => peak / max);
}

function formatAudioDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function audioContextConstructor(): (new () => AudioContext) | null {
  const Candidate =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Candidate ?? null;
}

function useAudioPeaks(previewUrl: string, seed: string, barCount: number, enabled: boolean) {
  const fallback = useMemo(() => decorativePeaks(seed, barCount), [barCount, seed]);
  const [peaks, setPeaks] = useState(fallback);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  useEffect(() => {
    setPeaks(fallback);
    setDurationSec(null);
    if (!enabled) return;
    const AudioCtx = audioContextConstructor();
    if (!AudioCtx) return;
    const controller = new AbortController();
    let ctx: AudioContext | null = null;
    void (async () => {
      const response = await fetch(previewUrl, { signal: controller.signal });
      if (!response.ok) return;
      const advertised = Number(response.headers.get("content-length"));
      if (Number.isFinite(advertised) && advertised > AUDIO_DECODE_MAX_BYTES) return;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > AUDIO_DECODE_MAX_BYTES) return;
      ctx = new AudioCtx();
      const audio = await ctx.decodeAudioData(bytes.slice(0));
      if (controller.signal.aborted) return;
      setPeaks(peaksFromBuffer(audio, barCount));
      setDurationSec(audio.duration);
    })().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
    });
    return () => {
      controller.abort();
      void ctx?.close();
    };
  }, [barCount, enabled, fallback, previewUrl]);

  return { peaks, durationSec };
}

function useNearViewport(eager = false) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(eager);

  useEffect(() => {
    if (eager) {
      setNearViewport(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);

  return { ref, nearViewport };
}

function PreviewMessage({
  kind,
  failed = false,
}: {
  kind: PreviewableAssetKind;
  failed?: boolean;
}) {
  if (kind === "video" && !failed) return null;
  const Icon =
    kind === "font" ? FileType2 : kind === "video" ? Video : kind === "data" ? FileJson : ImageIcon;
  return (
    <span
      className={`asset-preview-message${kind === "video" ? " asset-preview-message-overlay" : ""}`}
      role={failed ? "status" : undefined}
    >
      {kind !== "video" && <Icon size={26} strokeWidth={1.4} aria-hidden="true" />}
      <span>{failed ? "Preview unavailable" : "Loading preview…"}</span>
    </span>
  );
}

function ImagePreview({ kind, name, previewUrl }: Omit<AssetPreviewProps, "assetId">) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PreviewMessage kind={kind} failed />;
  return (
    <img
      src={previewUrl}
      alt={`Preview of ${name}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function FontPreview({
  assetId,
  name,
  previewUrl,
  mode = "card",
}: Omit<AssetPreviewProps, "kind" | "eager">) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const family = `asset-preview-${assetId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    let active = true;
    let face: FontFace | null = null;
    if (!("FontFace" in window) || !document.fonts) {
      setState("failed");
      return;
    }
    face = new FontFace(family, `url(${JSON.stringify(previewUrl)})`);
    face
      .load()
      .then((loaded) => {
        if (!active) return;
        document.fonts.add(loaded);
        setState("ready");
      })
      .catch(() => active && setState("failed"));
    return () => {
      active = false;
      if (face) document.fonts.delete(face);
    };
  }, [family, previewUrl]);

  const specimenStyle = state === "ready" ? { fontFamily: family } : undefined;
  return (
    <div className={`asset-font-specimen${state !== "loading" ? " ready" : ""}`}>
      <span className="asset-font-glyphs" style={specimenStyle} aria-hidden="true">
        {mode === "full" ? "Aa Ўў Ғғ Ққ" : "Aa"}
      </span>
      <span className="asset-font-line" style={specimenStyle}>
        {mode === "full"
          ? `${name} — Oʻzbekiston, sugʻurta va ishonch · 0123456789`
          : `${name} · 0123456789`}
      </span>
      {state === "loading" && <span className="visually-hidden">Loading font preview</span>}
      {state === "failed" && (
        <span className="visually-hidden" role="status">
          Preview unavailable
        </span>
      )}
    </div>
  );
}

function VideoPreview({
  name,
  previewUrl,
  mode = "card",
}: Pick<AssetPreviewProps, "name" | "previewUrl" | "mode">) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PreviewMessage kind="video" failed />;
  return (
    <video
      src={previewUrl}
      controls={mode === "full"}
      muted
      playsInline
      preload="metadata"
      aria-label={`Preview of ${name}`}
      onError={() => setFailed(true)}
    />
  );
}

function AudioWaveform({ peaks }: { peaks: number[] }) {
  const height = 40;
  const mid = height / 2;
  const d = peaks
    .map((peak, index) => {
      const bar = Math.max(1.6, peak * (height - 2));
      const x = index + 0.5;
      return `M${x} ${mid - bar / 2}V${mid + bar / 2}`;
    })
    .join("");
  return (
    <svg
      className="asset-audio-wave"
      viewBox={`0 0 ${peaks.length} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function AudioPreview({
  assetId,
  name,
  previewUrl,
  mode = "card",
  enabled,
}: Omit<AssetPreviewProps, "kind" | "eager"> & { enabled: boolean }) {
  const barCount = mode === "full" ? AUDIO_BARS_FULL : AUDIO_BARS_CARD;
  const { peaks, durationSec } = useAudioPeaks(previewUrl, assetId, barCount, enabled);
  const duration = durationSec === null ? null : formatAudioDuration(durationSec);

  return (
    <div className="asset-audio-stage">
      <div className="asset-audio-visual" aria-hidden="true">
        <AudioWaveform peaks={peaks} />
        <div className="asset-audio-meta">
          <span className="asset-audio-disc" />
          {duration && <span className="asset-audio-duration">{duration}</span>}
        </div>
      </div>
      {mode === "full" && (
        // biome-ignore lint/a11y/useMediaCaption: Raw library audio may be music/SFX; transcripts belong to authored video captions, not fabricated source metadata.
        <audio
          controls
          preload="metadata"
          aria-label={`Audio preview of ${name}`}
          src={previewUrl}
        />
      )}
    </div>
  );
}

function DataPreview({
  name,
  previewUrl,
  mode = "card",
}: Pick<AssetPreviewProps, "name" | "previewUrl" | "mode">) {
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(previewUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed: unknown = await response.json();
        const formatted = JSON.stringify(parsed, null, 2);
        setPreview(
          mode === "card" && formatted.length > 900 ? `${formatted.slice(0, 900)}\n…` : formatted,
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [mode, previewUrl]);

  if (failed) return <PreviewMessage kind="data" failed />;
  if (preview === null) return <PreviewMessage kind="data" />;
  return (
    <section className="asset-data-region" aria-label={`JSON preview of ${name}`}>
      <pre className="asset-data-preview">{preview}</pre>
    </section>
  );
}

export function AssetPreview(props: AssetPreviewProps) {
  const { assetId, kind, name, previewUrl, mode = "card", eager = false } = props;
  const { ref, nearViewport } = useNearViewport(eager);
  const ready = eager || nearViewport;

  return (
    <div
      ref={ref}
      className={`asset-preview-content asset-preview-content-${kind} asset-preview-content-${mode}`}
    >
      {kind === "audio" ? (
        <AudioPreview
          assetId={assetId}
          name={name}
          previewUrl={previewUrl}
          mode={mode}
          enabled={ready}
        />
      ) : !ready ? (
        <PreviewMessage kind={kind} />
      ) : kind === "image" || kind === "svg" ? (
        <ImagePreview kind={kind} name={name} previewUrl={previewUrl} />
      ) : kind === "font" ? (
        <FontPreview assetId={assetId} name={name} previewUrl={previewUrl} mode={mode} />
      ) : kind === "video" ? (
        <VideoPreview name={name} previewUrl={previewUrl} mode={mode} />
      ) : (
        <DataPreview name={name} previewUrl={previewUrl} mode={mode} />
      )}
      {kind === "video" && mode === "card" && (
        <span className="asset-video-play" aria-hidden="true">
          <span className="asset-video-play-mark" />
        </span>
      )}
      {kind === "data" && (
        <span className="asset-data-mark" aria-hidden="true">
          {"{ }"}
        </span>
      )}
    </div>
  );
}
