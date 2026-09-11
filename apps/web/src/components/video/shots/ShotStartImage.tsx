import { useAction, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import type { PinnedImage } from "../../SharedImageStudio";
import { Button } from "../../ui/Button";
import { TextInput } from "../../ui/TextInput";

type LibraryImage = {
  asset_id: Id<"assets">;
  revision_id: Id<"assetVersions">;
  name: string;
  preview_url: string;
};

export function ShotStartImage({
  workspaceId,
  source,
  onSelected,
  disabled,
}: {
  workspaceId: Id<"workspaces">;
  source?: PinnedImage;
  onSelected: (asset: PinnedImage) => void;
  disabled: boolean;
}) {
  const workspace = useQuery(api.workspaces.getById, { workspaceId });
  const list = useAction(api.assets.listMine);
  const preview = useAction(api.videoMedia.previewAsset);
  const [library, setLibrary] = useState<LibraryImage[]>([]);
  const [assetId, setAssetId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const workspaceSlug = workspace?.slug;

  useEffect(() => {
    if (!workspaceSlug) return;
    let active = true;
    void list({ scope: "workspace", workspaceSlug, kind: "image", limit: 20 }).then((rows) => {
      if (active) setLibrary(rows);
    });
    return () => {
      active = false;
    };
  }, [workspaceSlug, list]);

  const sourceAssetId = source?.assetId;
  const sourceRevisionId = source?.revisionId;
  useEffect(() => {
    setUrl(null);
    if (!sourceAssetId || !sourceRevisionId) return;
    let active = true;
    void preview({ workspaceId, asset: { assetId: sourceAssetId, revisionId: sourceRevisionId } })
      .then((result) => {
        if (active) setUrl(result.url);
      })
      .catch(() => {
        if (active) setMessage("Pinned source unavailable.");
      });
    return () => {
      active = false;
    };
  }, [sourceAssetId, sourceRevisionId, workspaceId, preview]);

  function pinExactRevision() {
    const asset = {
      assetId: assetId as Id<"assets">,
      revisionId: revisionId as Id<"assetVersions">,
    };
    void preview({ workspaceId, asset })
      .then((result) => {
        if (!result.mimeType.startsWith("image/")) throw new Error();
        onSelected(asset);
        setMessage("Pinned start image selected.");
      })
      .catch(() =>
        setMessage("Select an accessible image and its exact revision in this workspace."),
      );
  }

  return (
    <div className="video-shot-source">
      <h3>Start image</h3>
      {url && <img src={url} alt="Pinned start frame" />}
      <p className="video-hint">
        Recent 20 shared images. Selecting pins this exact revision, including Codex imagegen
        uploads.
      </p>
      <div className="video-keyframe-library">
        {library.map((item) => (
          <button
            type="button"
            key={item.revision_id}
            className="video-keyframe-thumb"
            disabled={disabled}
            aria-pressed={source?.revisionId === item.revision_id}
            onClick={() => onSelected({ assetId: item.asset_id, revisionId: item.revision_id })}
          >
            <img src={item.preview_url} alt="" />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <details className="video-advanced">
        <summary>Pin exact revision</summary>
        <TextInput
          id="shot-source-asset"
          label="Asset ID"
          labelVisible
          value={assetId}
          disabled={disabled}
          onChange={(event) => setAssetId(event.target.value)}
        />
        <TextInput
          id="shot-source-revision"
          label="Asset revision ID"
          labelVisible
          value={revisionId}
          disabled={disabled}
          onChange={(event) => setRevisionId(event.target.value)}
        />
        <Button size="sm" disabled={disabled || !assetId || !revisionId} onClick={pinExactRevision}>
          Pin start image
        </Button>
      </details>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
