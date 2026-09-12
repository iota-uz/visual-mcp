import { useAction, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Image as ImageIcon,
  Link2,
  Pencil,
  Search,
  Tags,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AssetMoveDrawer } from "../components/AssetMoveDrawer";
import { AssetPreview, type PreviewableAssetKind } from "../components/AssetPreview";
import { AssetPreviewDialog } from "../components/AssetPreviewDialog";
import { AssetTagEditor } from "../components/AssetTagEditor";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { MediaUpload } from "../components/MediaUpload";
import { PageHeader } from "../components/PageHeader";
import { type PinnedImage, SharedImageStudio } from "../components/SharedImageStudio";
import { useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { Menu, type MenuItem } from "../components/ui/Menu";
import { TextInput } from "../components/ui/TextInput";
import { WorkspaceChrome } from "../components/WorkspaceChrome";
import { writeClipboard } from "../lib/clipboard";
import { formatBytes } from "../lib/formatBytes";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useDocumentTitle } from "../lib/useDocumentTitle";

type AssetKind = PreviewableAssetKind;
interface AssetItem {
  asset_id: Id<"assets">;
  asset_ref: string;
  scope: "shared" | "workspace";
  workspace_slug: string | null;
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  kind: AssetKind;
  revision: number;
  revision_id?: Id<"assetVersions">;
  mime_type: string;
  size_bytes: number;
  content_hash: string;
  original_filename: string;
  updated_at: number;
  preview_url: string;
}

interface AssetLibraryStats {
  active: { asset_count: number; size_bytes: number };
  archived: { asset_count: number; size_bytes: number };
  total: { asset_count: number; size_bytes: number };
  complete: boolean;
}

function AssetCard({
  asset,
  onArchive,
  onRestore,
  onPreview,
  onEditTags,
  onTagSelect,
  onEdit,
  onSelect,
  selected,
  selectionMode,
  archived,
}: {
  asset: AssetItem;
  onArchive?: () => void;
  onRestore?: () => void;
  onPreview: () => void;
  onEditTags: () => void;
  onTagSelect: (tag: string) => void;
  onEdit?: () => void;
  onSelect: () => void;
  selected: boolean;
  selectionMode: boolean;
  archived: boolean;
}) {
  const menuRef = useRef<HTMLButtonElement>(null);
  const { notify } = useToast();

  async function copyRef() {
    const failure = await writeClipboard(asset.asset_ref);
    notify(
      failure
        ? { tone: "error", message: `Couldn't copy to the clipboard: ${failure}` }
        : { message: `Copied “${asset.asset_ref}”.` },
    );
  }

  return (
    <li
      className="asset-card"
      data-selected={selected || undefined}
      data-archived={archived || undefined}
    >
      <button
        type="button"
        className={`asset-preview asset-preview-${asset.kind}`}
        aria-label={`Open preview of ${asset.name}`}
        onClick={onPreview}
      >
        <AssetPreview
          assetId={asset.asset_id}
          kind={asset.kind}
          name={asset.name}
          previewUrl={asset.preview_url}
        />
        <span className="asset-kind">{asset.kind}</span>
      </button>
      <div className="asset-card-body">
        <div className="asset-card-title-row">
          {selectionMode && (
            <input
              type="checkbox"
              className="asset-select"
              checked={selected}
              onChange={onSelect}
              aria-label={`Select ${asset.name}`}
            />
          )}
          <strong>{asset.name}</strong>
          {archived ? (
            <button
              type="button"
              className="asset-card-action asset-restore"
              onClick={onRestore}
              title="Restore asset"
            >
              <ArchiveRestore size={14} aria-hidden="true" />
              <span className="visually-hidden">Restore {asset.name}</span>
            </button>
          ) : (
            <Menu
              triggerRef={menuRef}
              className="card-hit-actions"
              label={`Actions for ${asset.name}`}
              items={
                [
                  { id: "preview", label: "Open", onSelect: onPreview },
                  { id: "copy", label: "Copy ref", icon: Copy, onSelect: () => void copyRef() },
                  { id: "tags", label: "Edit tags", icon: Tags, onSelect: onEditTags },
                  ...(onEdit
                    ? [{ id: "edit", label: "Edit image", icon: Pencil, onSelect: onEdit }]
                    : []),
                  { id: "sep", separator: true },
                  {
                    id: "archive",
                    label: "Archive…",
                    icon: Archive,
                    danger: true,
                    onSelect: () => onArchive?.(),
                  },
                ] satisfies MenuItem[]
              }
            />
          )}
        </div>
        {asset.tags.length > 0 && (
          <div className="asset-tags">
            {asset.tags.slice(0, 3).map((tag) => (
              <button type="button" key={tag} onClick={() => onTagSelect(tag)}>
                {tag}
              </button>
            ))}
            {asset.tags.length > 3 && <span>+{asset.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function AssetLibrarySummary({ stats }: { stats: AssetLibraryStats | null }) {
  const prefix = stats && !stats.complete ? "At least " : "";
  return (
    <section className="asset-library-summary" aria-label="Asset library size">
      {stats
        ? `${prefix}${formatBytes(stats.total.size_bytes)} · ${stats.active.asset_count} active`
        : "Loading size…"}
    </section>
  );
}

export function AssetsPage() {
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const workspace = useQuery(api.workspaces.getBySlug, wsSlug ? { slug: wsSlug } : "skip");
  const [editSource, setEditSource] = useState<PinnedImage | undefined>();
  const [mediaPane, setMediaPane] = useState<"image" | "upload" | null>(null);
  const scope = wsSlug ? ("workspace" as const) : ("shared" as const);
  const [assets, setAssets] = useState<AssetItem[] | null>(null);
  const [libraryStats, setLibraryStats] = useState<AssetLibraryStats | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [libraryView, setLibraryView] = useState<"active" | "archived">("active");
  const [uploading, setUploading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importName, setImportName] = useState("");
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);
  const [tagAsset, setTagAsset] = useState<AssetItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AssetItem | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 180);
  const listAssets = useAction(api.assets.listMine);
  const getLibraryStats = useAction(api.assets.getLibraryStatsMine);
  const prepareUpload = useAction(api.assets.prepareUploadMine);
  const finalizeUpload = useAction(api.assets.finalizeUploadMine);
  const importAsset = useAction(api.assets.importUrlMine);
  const archiveAsset = useMutation(api.assets.archiveMine);
  const restoreAsset = useMutation(api.assets.restoreMine);
  const setAssetTags = useMutation(api.assets.setTagsMine);
  const renameWorkspace = useMutation(api.workspaces.renameMine);
  const { notify } = useToast();
  useDocumentTitle(wsSlug ? `${wsSlug} assets` : "Shared Asset Library");

  const reload = useCallback(async () => {
    const rows = await listAssets({
      scope,
      workspaceSlug: wsSlug,
      query: debouncedQuery || undefined,
      kind: kind === "all" ? undefined : kind,
      archived: libraryView === "archived",
      limit: 100,
    });
    setAssets(rows as AssetItem[]);
  }, [debouncedQuery, kind, libraryView, listAssets, scope, wsSlug]);

  const reloadStats = useCallback(async () => {
    const stats = await getLibraryStats({ scope, workspaceSlug: wsSlug });
    setLibraryStats(stats);
  }, [getLibraryStats, scope, wsSlug]);

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

  useEffect(() => {
    let active = true;
    setLibraryStats(null);
    reloadStats().catch((error: unknown) => {
      if (active)
        notify({
          tone: "error",
          message: error instanceof Error ? error.message : "Unable to load asset sizes",
        });
    });
    return () => {
      active = false;
    };
  }, [reloadStats, notify]);

  const tabs = useMemo(
    () => ["all", "image", "svg", "font", "video", "audio", "data"] as const,
    [],
  );

  const selectedAssets = useMemo(
    () => assets?.filter((asset) => selectedAssetIds.has(asset.asset_id)) ?? [],
    [assets, selectedAssetIds],
  );

  function leaveSelectionMode() {
    setSelectionMode(false);
    setSelectedAssetIds(new Set());
    setMoveOpen(false);
  }

  function changeLibraryView(view: "active" | "archived") {
    leaveSelectionMode();
    setPreviewAsset(null);
    setTagAsset(null);
    setArchiveTarget(null);
    setLibraryView(view);
  }

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
      await Promise.all([reload(), reloadStats()]);
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
      await Promise.all([reload(), reloadStats()]);
    } catch (error) {
      notify({ tone: "error", message: error instanceof Error ? error.message : "Import failed" });
    } finally {
      setUploading(false);
    }
  }

  function editImageHandler(asset: AssetItem): (() => void) | undefined {
    if (libraryView === "archived" || !workspace || asset.kind !== "image" || !asset.revision_id)
      return undefined;
    const revisionId = asset.revision_id;
    return () => {
      setEditSource({ assetId: asset.asset_id, revisionId });
      setMediaPane("image");
    };
  }

  const headerActions = (
    <div className="asset-header-actions">
      {workspace && (
        <>
          <Button
            variant="secondary"
            onClick={() => setMediaPane(mediaPane === "image" ? null : "image")}
          >
            Generate image
          </Button>
          <Button
            variant="primary"
            onClick={() => setMediaPane(mediaPane === "upload" ? null : "upload")}
          >
            Upload media
          </Button>
        </>
      )}
      <Button variant="secondary" icon={Link2} onClick={() => setImportOpen((open) => !open)}>
        Import URL
      </Button>
      {!wsSlug && (
        <label className={`btn btn-primary${uploading ? " disabled" : ""}`}>
          <Upload size={15} aria-hidden="true" />
          {uploading ? "Uploading…" : "Upload"}
          <input type="file" multiple hidden disabled={uploading} onChange={uploadFiles} />
        </label>
      )}
    </div>
  );

  return (
    <div className="page-stack">
      {wsSlug ? (
        <WorkspaceChrome
          slug={wsSlug}
          workspace={workspace ?? undefined}
          onRename={
            workspace
              ? (name) => renameWorkspace({ workspaceId: workspace.workspace_id, name })
              : undefined
          }
          subtitle={
            <>
              Reusable media for <strong>{workspace?.name ?? wsSlug}</strong>.
            </>
          }
          actions={headerActions}
        />
      ) : (
        <PageHeader
          title="Shared Asset Library"
          subtitle="Organization-wide media available to every Canvas user and workspace."
          actions={headerActions}
        />
      )}

      <AssetLibrarySummary stats={libraryStats} />

      {workspace && mediaPane && (
        <section aria-label="Media action">
          <Button
            size="sm"
            onClick={() => {
              setMediaPane(null);
              setEditSource(undefined);
            }}
          >
            Close media action
          </Button>
          {mediaPane === "image" ? (
            <>
              <SharedImageStudio
                key={editSource?.revisionId ?? "generate"}
                workspaceId={workspace.workspace_id}
                source={editSource}
              />
              {editSource && (
                <Button size="sm" onClick={() => setEditSource(undefined)}>
                  Back to new image
                </Button>
              )}
            </>
          ) : (
            <MediaUpload
              workspaceId={workspace.workspace_id}
              onReady={() => void Promise.all([reload(), reloadStats()])}
            />
          )}
        </section>
      )}
      <Drawer
        open={importOpen}
        onClose={() => {
          if (!uploading) setImportOpen(false);
        }}
        title="Import from HTTPS"
        closeLabel="Close import"
        side="right"
      >
        <div className="asset-import-form">
          <p className="muted">
            The file is copied into private storage; canvases never hotlink the source.
          </p>
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
        </div>
      </Drawer>

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
        <fieldset className="asset-status-tabs">
          <legend className="visually-hidden">Asset status</legend>
          <button
            type="button"
            aria-pressed={libraryView === "active"}
            className={libraryView === "active" ? "active" : ""}
            onClick={() => changeLibraryView("active")}
          >
            Active
          </button>
          <button
            type="button"
            aria-pressed={libraryView === "archived"}
            className={libraryView === "archived" ? "active" : ""}
            onClick={() => changeLibraryView("archived")}
          >
            Archived
          </button>
        </fieldset>
        <fieldset className="asset-kind-tabs">
          <legend className="visually-hidden">Filter by asset kind</legend>
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={kind === tab ? "active" : ""}
              aria-pressed={kind === tab}
              onClick={() => setKind(tab)}
            >
              {tab}
            </button>
          ))}
        </fieldset>
        {libraryView === "active" && workspace && assets && assets.length > 0 && !selectionMode && (
          <Button size="sm" variant="secondary" onClick={() => setSelectionMode(true)}>
            Select
          </Button>
        )}
      </div>

      {selectionMode && assets && (
        <div className="asset-selection-toolbar" role="toolbar" aria-label="Asset selection">
          <label>
            <input
              type="checkbox"
              checked={assets.length > 0 && selectedAssets.length === assets.length}
              ref={(input) => {
                if (input)
                  input.indeterminate =
                    selectedAssets.length > 0 && selectedAssets.length < assets.length;
              }}
              onChange={() =>
                setSelectedAssetIds(
                  selectedAssets.length === assets.length
                    ? new Set()
                    : new Set(assets.map((asset) => asset.asset_id)),
                )
              }
            />
            Select all visible
          </label>
          <strong aria-live="polite">{selectedAssets.length} selected</strong>
          <div>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedAssets.length === 0}
              onClick={() => setMoveOpen(true)}
            >
              Move
            </Button>
            <Button size="sm" variant="secondary" onClick={leaveSelectionMode}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {assets === null && (
        <div className="asset-grid">
          {Array.from({ length: 8 }, (_, index) => `asset-skeleton-${index + 1}`).map((key) => (
            <div key={key} className="asset-card-skeleton" />
          ))}
        </div>
      )}
      {assets?.length === 0 && (
        <EmptyState
          icon={libraryView === "archived" ? ArchiveRestore : ImageIcon}
          title={libraryView === "archived" ? "No archived assets." : "No assets here yet."}
          hint={
            libraryView === "archived"
              ? "Assets you archive will appear here and can be restored."
              : "Upload a file or import one from an HTTPS URL."
          }
        />
      )}
      {assets && assets.length > 0 && (
        <ul className="asset-grid">
          {assets.map((asset) => (
            <AssetCard
              key={asset.asset_id}
              asset={asset}
              archived={libraryView === "archived"}
              onPreview={() => setPreviewAsset(asset)}
              onEditTags={() => setTagAsset(asset)}
              onTagSelect={(tag) => setQuery(tag)}
              selectionMode={selectionMode}
              selected={selectedAssetIds.has(asset.asset_id)}
              onSelect={() =>
                setSelectedAssetIds((current) => {
                  const next = new Set(current);
                  if (next.has(asset.asset_id)) next.delete(asset.asset_id);
                  else if (next.size < 100) next.add(asset.asset_id);
                  return next;
                })
              }
              onEdit={editImageHandler(asset)}
              onRestore={async () => {
                await restoreAsset({ assetRef: asset.asset_ref });
                setAssets(
                  (current) => current?.filter((item) => item.asset_id !== asset.asset_id) ?? [],
                );
                notify({ message: `Restored “${asset.name}”.` });
                await reloadStats();
              }}
              onArchive={() => setArchiveTarget(asset)}
            />
          ))}
        </ul>
      )}
      {previewAsset && (
        <AssetPreviewDialog
          asset={{
            assetId: previewAsset.asset_id,
            assetRef: previewAsset.asset_ref,
            kind: previewAsset.kind,
            mimeType: previewAsset.mime_type,
            name: previewAsset.name,
            originalFilename: previewAsset.original_filename,
            previewUrl: previewAsset.preview_url,
            revision: previewAsset.revision,
            sizeBytes: previewAsset.size_bytes,
          }}
          onClose={() => setPreviewAsset(null)}
        />
      )}
      {tagAsset && (
        <AssetTagEditor
          assetName={tagAsset.name}
          initialTags={tagAsset.tags}
          open
          onClose={() => setTagAsset(null)}
          onSave={async (tags) => {
            const updated = await setAssetTags({ assetRef: tagAsset.asset_ref, tags });
            setAssets(
              (current) =>
                current?.map((asset) =>
                  asset.asset_id === tagAsset.asset_id ? { ...asset, tags: updated.tags } : asset,
                ) ?? null,
            );
            setTagAsset(null);
            notify({ message: `Tags for “${tagAsset.name}” saved.` });
          }}
        />
      )}
      {archiveTarget && (
        <ConfirmDialog
          title={`Archive “${archiveTarget.name}”?`}
          description="It will disappear from Active assets but remain available in Archived, where it can be restored. Existing pinned canvas revisions stay unchanged."
          confirmLabel="Archive asset"
          busyLabel="Archiving…"
          onCancel={() => setArchiveTarget(null)}
          onConfirm={async () => {
            await archiveAsset({ assetRef: archiveTarget.asset_ref });
            setAssets(
              (current) =>
                current?.filter((item) => item.asset_id !== archiveTarget.asset_id) ?? [],
            );
            notify({ message: `Archived “${archiveTarget.name}”.` });
            setArchiveTarget(null);
            await reloadStats();
          }}
        />
      )}
      {workspace && (
        <AssetMoveDrawer
          open={moveOpen}
          sourceWorkspace={workspace.slug}
          assets={selectedAssets.map((asset) => ({
            assetRef: asset.asset_ref,
            kind: asset.kind,
            name: asset.name,
          }))}
          onClose={() => setMoveOpen(false)}
          onMoved={(movedRefs) => {
            const moved = new Set(movedRefs);
            setAssets((current) => current?.filter((asset) => !moved.has(asset.asset_ref)) ?? null);
            notify({
              message: `${movedRefs.length} asset${movedRefs.length === 1 ? "" : "s"} moved.`,
            });
            leaveSelectionMode();
            void reloadStats();
          }}
        />
      )}
    </div>
  );
}
