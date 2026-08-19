import { useAction, useMutation } from "convex/react";
import {
  Archive,
  FileJson,
  FileType2,
  Image as ImageIcon,
  Link2,
  Music2,
  Search,
  Upload,
  Video,
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { CopyableValue } from "../components/ui/CopyableValue";
import { TextInput } from "../components/ui/TextInput";
import { formatBytes } from "../lib/formatBytes";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type AssetKind = "image" | "svg" | "font" | "video" | "audio" | "data";
interface AssetItem {
  asset_id: Id<"assets">;
  asset_ref: string;
  scope: "personal" | "workspace";
  workspace_slug: string | null;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  kind: AssetKind;
  revision: number;
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  original_filename: string;
  updated_at: number;
  preview_url: string;
}

const KIND_ICONS = {
  image: ImageIcon,
  svg: ImageIcon,
  font: FileType2,
  video: Video,
  audio: Music2,
  data: FileJson,
} as const;

function AssetCard({ asset, onArchive }: { asset: AssetItem; onArchive: () => void }) {
  const KindIcon = KIND_ICONS[asset.kind];
  const visual = asset.kind === "image" || asset.kind === "svg";
  return (
    <li className="asset-card">
      <div className={`asset-preview asset-preview-${asset.kind}`}>
        {visual ? (
          <img src={asset.preview_url} alt={`Preview of ${asset.name}`} loading="lazy" />
        ) : (
          <KindIcon size={34} strokeWidth={1.35} aria-hidden="true" />
        )}
        <span className="asset-kind">{asset.kind}</span>
        <span className="asset-revision">r{asset.revision}</span>
      </div>
      <div className="asset-card-body">
        <div className="asset-card-title-row">
          <strong>{asset.name}</strong>
          <button type="button" className="asset-archive" onClick={onArchive} title="Archive asset">
            <Archive size={14} aria-hidden="true" />
            <span className="visually-hidden">Archive {asset.name}</span>
          </button>
        </div>
        <span className="asset-filename">{asset.original_filename}</span>
        <div className="asset-card-facts">
          <span>{asset.mime_type.replace("image/", "")}</span>
          <span>{formatBytes(asset.size_bytes)}</span>
        </div>
        {asset.tags.length > 0 && (
          <div className="asset-tags">
            {asset.tags.slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
        <CopyableValue value={asset.asset_ref} label="Asset ref" copyLabel="Copy asset ref" />
      </div>
    </li>
  );
}

export function AssetsPage() {
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const scope = wsSlug ? ("workspace" as const) : ("personal" as const);
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [uploading, setUploading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const listAssets = useAction(api.assets.listMine);
  const prepareUpload = useAction(api.assets.prepareUploadMine);
  const finalizeUpload = useAction(api.assets.finalizeUploadMine);
  const importAsset = useAction(api.assets.importUrlMine);
  const archiveAsset = useMutation(api.assets.archiveMine);
  const { notify } = useToast();
  useDocumentTitle(wsSlug ? `${wsSlug} assets` : "Asset Library");

  const reload = useCallback(async () => {
    const rows = await listAssets({
      scope,
      workspaceSlug: wsSlug,
      query: debouncedQuery || undefined,
      kind: kind === "all" ? undefined : kind,
      limit: 100,
    });
    setAssets(rows as AssetItem[]);
  }, [debouncedQuery, kind, listAssets, scope, wsSlug]);

  useEffect(() => {
    let active = true;
    setAssets(null);
    reload().catch((error: unknown) => {
      if (active)
        notify({
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to load assets",
        });
    });
    return () => {
      active = false;
    };
  }, [reload, notify]);

  const tabs = useMemo(
    () => ["all", "image", "svg", "font", "video", "audio", "data"] as const,
    [],
  );

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const prepared = await prepareUpload({
          scope,
          workspaceSlug: wsSlug,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
        const response = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error(`Upload of ${file.name} failed: HTTP ${response.status}`);
        await finalizeUpload({
          uploadId: prepared.uploadId,
          name: file.name.replace(/\.[^.]+$/, ""),
          tags: [],
        });
      }
      notify({ message: `${files.length} asset${files.length === 1 ? "" : "s"} uploaded.` });
      await reload();
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function submitImport() {
    if (!importUrl || !importName) return;
    setUploading(true);
    try {
      await importAsset({
        scope,
        workspaceSlug: wsSlug,
        url: importUrl,
        name: importName,
        tags: [],
      });
      setImportUrl("");
      setImportName("");
      setImportOpen(false);
      notify({ message: `Imported “${importName}”.` });
      await reload();
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Import failed" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="page-stack assets-page">
      <PageHeader
        title={wsSlug ? "Workspace assets" : "Asset Library"}
        subtitle={
          wsSlug ? (
            <>
              Reusable media pinned to <strong>{wsSlug}</strong>.
            </>
          ) : (
            "Reusable media available across your workspaces."
          )
        }
        back={wsSlug ? { to: `/w/${wsSlug}`, label: wsSlug } : undefined}
        actions={
          <div className="asset-header-actions">
            <Button variant="secondary" icon={Link2} onClick={() => setImportOpen((open) => !open)}>
              Import URL
            </Button>
            <label className={`btn btn-primary${uploading ? " disabled" : ""}`}>
              <Upload size={15} aria-hidden="true" />
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" multiple hidden disabled={uploading} onChange={uploadFiles} />
            </label>
          </div>
        }
      />

      {wsSlug && (
        <nav className="workspace-tabs" aria-label="Workspace sections">
          <Link to={`/w/${wsSlug}`}>Canvases</Link>
          <Link to={`/w/${wsSlug}/assets`} className="active">
            Assets
          </Link>
        </nav>
      )}

      {importOpen && (
        <section className="asset-import-panel">
          <div>
            <span className="eyebrow">Import from HTTPS</span>
            <p>The file is copied into private storage; canvases never hotlink the source.</p>
          </div>
          <TextInput
            id="asset-import-name"
            label="Name"
            labelVisible
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
          />
          <TextInput
            id="asset-import-url"
            label="HTTPS URL"
            labelVisible
            value={importUrl}
            onChange={(event) => setImportUrl(event.target.value)}
          />
          <Button onClick={submitImport} disabled={uploading || !importName || !importUrl}>
            Import
          </Button>
        </section>
      )}

      <div className="asset-toolbar">
        <div className="asset-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, tag or filename"
            aria-label="Search assets"
          />
        </div>
        <div className="asset-kind-tabs" role="tablist" aria-label="Asset kind">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={kind === tab ? "active" : ""}
              onClick={() => setKind(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {assets === null && (
        <div className="asset-grid asset-grid-loading">
          {Array.from({ length: 8 }, (_, index) => `asset-skeleton-${index + 1}`).map((key) => (
            <div key={key} className="asset-card-skeleton" />
          ))}
        </div>
      )}
      {assets?.length === 0 && (
        <EmptyState
          icon={ImageIcon}
          title="No assets here yet."
          hint="Upload a file or import one from an HTTPS URL."
        />
      )}
      {assets && assets.length > 0 && (
        <ul className="asset-grid">
          {assets.map((asset) => (
            <AssetCard
              key={asset.asset_id}
              asset={asset}
              onArchive={async () => {
                await archiveAsset({ assetId: asset.asset_id, archived: true });
                setAssets(
                  (current) => current?.filter((item) => item.asset_id !== asset.asset_id) ?? [],
                );
                notify({ message: `Archived “${asset.name}”.` });
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
