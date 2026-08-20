import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { formatBytes } from "../lib/formatBytes";
import { AssetPreview, type PreviewableAssetKind } from "./AssetPreview";
import { CopyableValue } from "./ui/CopyableValue";
import { IconButton } from "./ui/IconButton";

export interface AssetPreviewDialogAsset {
  assetId: string;
  assetRef: string;
  kind: PreviewableAssetKind;
  mimeType: string;
  name: string;
  originalFilename: string;
  previewUrl: string;
  revision: number;
  sizeBytes: number;
}

interface AssetPreviewDialogProps {
  asset: AssetPreviewDialogAsset;
  onClose: () => void;
}

export function AssetPreviewDialog({ asset, onClose }: AssetPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onBackdropPress = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", onBackdropPress);
    return () => dialog.removeEventListener("click", onBackdropPress);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="asset-lightbox"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="asset-lightbox-shell">
        <header className="asset-lightbox-header">
          <div className="asset-lightbox-heading">
            <span className="eyebrow">
              {asset.kind} · r{asset.revision}
            </span>
            <h2 id={titleId}>{asset.name}</h2>
            <p>
              {asset.originalFilename} · {asset.mimeType} · {formatBytes(asset.sizeBytes)}
            </p>
          </div>
          <IconButton
            icon={X}
            label={`Close preview of ${asset.name}`}
            iconSize={20}
            className="asset-lightbox-close"
            onClick={onClose}
          />
        </header>
        <div className={`asset-lightbox-stage asset-lightbox-stage-${asset.kind}`}>
          <AssetPreview
            assetId={asset.assetId}
            kind={asset.kind}
            name={asset.name}
            previewUrl={asset.previewUrl}
            mode="full"
            eager
          />
        </div>
        <footer className="asset-lightbox-footer">
          <CopyableValue value={asset.assetRef} label="Asset ref" copyLabel="Copy asset ref" />
        </footer>
      </div>
    </dialog>
  );
}
