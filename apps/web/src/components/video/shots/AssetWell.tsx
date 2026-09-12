import { useAction } from "convex/react";
import { type ReactNode, useEffect, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

export type WellAsset = { assetId: string; revisionId: string };

export function AssetWell({
  workspaceId,
  asset,
  fallback,
  className = "video-beat-frame",
}: {
  workspaceId: Id<"workspaces">;
  asset?: WellAsset;
  fallback?: ReactNode;
  className?: string;
}) {
  const preview = useAction(api.videoMedia.previewAsset);
  const [media, setMedia] = useState<{ url: string; mimeType: string } | null>(null);
  const assetId = asset?.assetId;
  const revisionId = asset?.revisionId;

  useEffect(() => {
    if (!assetId || !revisionId) {
      setMedia(null);
      return;
    }
    let active = true;
    void preview({
      workspaceId,
      asset: {
        assetId: assetId as Id<"assets">,
        revisionId: revisionId as Id<"assetVersions">,
      },
    })
      .then((result) => {
        if (active) setMedia({ url: result.url, mimeType: result.mimeType ?? "" });
      })
      .catch(() => {
        if (active) setMedia(null);
      });
    return () => {
      active = false;
    };
  }, [assetId, revisionId, workspaceId, preview]);

  const video = media?.mimeType.startsWith("video/");
  return (
    <div className={className} aria-hidden="true">
      {media && video ? (
        // biome-ignore lint/a11y/useMediaCaption: Glance frame only; captions live on the timeline.
        <video src={media.url} muted playsInline preload="metadata" />
      ) : media ? (
        <img src={media.url} alt="" />
      ) : (
        fallback
      )}
    </div>
  );
}
