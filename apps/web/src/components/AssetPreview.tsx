import { FileJson, FileType2, Image as ImageIcon, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type PreviewableAssetKind = "image" | "svg" | "font" | "video" | "data";

interface AssetPreviewProps {
  assetId: string;
  kind: PreviewableAssetKind;
  name: string;
  previewUrl: string;
}

function useNearViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
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
  }, []);

  return { ref, nearViewport };
}

function PreviewMessage({
  kind,
  failed = false,
}: {
  kind: PreviewableAssetKind;
  failed?: boolean;
}) {
  const Icon =
    kind === "font" ? FileType2 : kind === "video" ? Video : kind === "data" ? FileJson : ImageIcon;
  return (
    <span className="asset-preview-message" role={failed ? "status" : undefined}>
      <Icon size={26} strokeWidth={1.4} aria-hidden="true" />
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

function FontPreview({ assetId, name, previewUrl }: Omit<AssetPreviewProps, "kind">) {
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

  if (state === "failed") return <PreviewMessage kind="font" failed />;
  return (
    <div className={`asset-font-specimen${state === "ready" ? " ready" : ""}`}>
      <span className="asset-font-glyphs" style={{ fontFamily: family }} aria-hidden="true">
        Aa
      </span>
      <span className="asset-font-line" style={{ fontFamily: family }}>
        {name} · 0123456789
      </span>
      {state === "loading" && <span className="visually-hidden">Loading font preview</span>}
    </div>
  );
}

function VideoPreview({ name, previewUrl }: Pick<AssetPreviewProps, "name" | "previewUrl">) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PreviewMessage kind="video" failed />;
  return (
    <video
      src={previewUrl}
      controls
      muted
      playsInline
      preload="metadata"
      aria-label={`Preview of ${name}`}
      onError={() => setFailed(true)}
    />
  );
}

function DataPreview({ name, previewUrl }: Pick<AssetPreviewProps, "name" | "previewUrl">) {
  const [preview, setPreview] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(previewUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed: unknown = await response.json();
        const formatted = JSON.stringify(parsed, null, 2);
        setPreview(formatted.length > 900 ? `${formatted.slice(0, 900)}\n…` : formatted);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [previewUrl]);

  if (failed) return <PreviewMessage kind="data" failed />;
  if (preview === null) return <PreviewMessage kind="data" />;
  return (
    <section className="asset-data-region" aria-label={`JSON preview of ${name}`}>
      <pre className="asset-data-preview">{preview}</pre>
    </section>
  );
}

export function AssetPreview(props: AssetPreviewProps) {
  const { ref, nearViewport } = useNearViewport();
  const { assetId, kind, name, previewUrl } = props;

  return (
    <div ref={ref} className={`asset-preview-content asset-preview-content-${kind}`}>
      {!nearViewport ? (
        <PreviewMessage kind={kind} />
      ) : kind === "image" || kind === "svg" ? (
        <ImagePreview kind={kind} name={name} previewUrl={previewUrl} />
      ) : kind === "font" ? (
        <FontPreview assetId={assetId} name={name} previewUrl={previewUrl} />
      ) : kind === "video" ? (
        <VideoPreview name={name} previewUrl={previewUrl} />
      ) : (
        <DataPreview name={name} previewUrl={previewUrl} />
      )}
    </div>
  );
}
