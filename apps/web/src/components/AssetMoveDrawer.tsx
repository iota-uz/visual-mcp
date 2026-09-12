import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "./ui/Button";
import { Drawer } from "./ui/Drawer";

type SelectedAsset = {
  assetRef: string;
  kind: string;
  name: string;
};

export function AssetMoveDrawer({
  assets,
  onClose,
  onMoved,
  open,
  sourceWorkspace,
}: {
  assets: SelectedAsset[];
  onClose: () => void;
  onMoved: (movedRefs: string[]) => void;
  open: boolean;
  sourceWorkspace: string;
}) {
  const workspaces = useQuery(api.workspaces.listMine, {});
  const [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const moveAssets = useMutation(api.assets.moveMine);
  const assetRefs = useMemo(() => assets.map((asset) => asset.assetRef), [assets]);
  const preview = useQuery(
    api.assets.previewMoveMine,
    open && destination
      ? {
          assetRefs,
          sourceWorkspaceSlug: sourceWorkspace,
          destinationWorkspaceSlug: destination,
        }
      : "skip",
  );
  const destinations = (workspaces ?? []).filter((workspace) => workspace.slug !== sourceWorkspace);
  const kindSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.kind, (counts.get(asset.kind) ?? 0) + 1);
    return [...counts.entries()].map(([kind, count]) => `${count} ${kind}`).join(" · ");
  }, [assets]);

  useEffect(() => {
    if (!open) {
      setDestination("");
      setError(null);
      setMoving(false);
    }
  }, [open]);

  async function submit() {
    if (!destination || preview?.status !== "ready") return;
    setMoving(true);
    setError(null);
    try {
      const moved = await moveAssets({
        assetRefs,
        sourceWorkspaceSlug: sourceWorkspace,
        destinationWorkspaceSlug: destination,
        idempotencyKey: crypto.randomUUID(),
      });
      if (moved.status === "blocked") {
        setError(moved.conflicts.map((conflict) => conflict.message).join(" · "));
        return;
      }
      onMoved(moved.items.map((item) => item.previousAssetRef));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to move assets");
    } finally {
      setMoving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Move assets"
      closeLabel="Close asset move"
      className="asset-move-drawer"
    >
      <div className="asset-move-body">
        <section className="asset-move-summary" aria-label="Selected assets">
          <strong>{assets.length} selected</strong>
          <span>{kindSummary}</span>
          <small>From {sourceWorkspace}</small>
        </section>

        <label className="asset-move-destination">
          <span>Destination workspace</span>
          <select
            value={destination}
            onChange={(event) => {
              setDestination(event.target.value);
              setError(null);
            }}
          >
            <option value="">Choose workspace…</option>
            {destinations.map((workspace) => (
              <option key={workspace.workspace_id} value={workspace.slug}>
                {workspace.name}
              </option>
            ))}
          </select>
        </label>

        <div className="asset-move-impact" aria-live="polite">
          {!destination && <p>Choose where these assets should live.</p>}
          {destination && preview === undefined && <p>Checking destination…</p>}
          {preview?.status === "ready" && (
            <p>
              Ready to move. Media bytes, revisions, tags and existing canvas or video bindings stay
              unchanged.
            </p>
          )}
          {preview?.status === "blocked" && (
            <div role="alert">
              <strong>Resolve these conflicts first</strong>
              <ul>
                {preview.conflicts.map((conflict) => (
                  <li key={`${conflict.assetRef}:${conflict.reason}`}>{conflict.message}</li>
                ))}
              </ul>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </div>

        <p className="asset-move-warning">
          Existing pinned uses keep working. The old asset refs stop resolving after the move.
        </p>

        <div className="asset-move-actions">
          <Button variant="secondary" onClick={onClose} disabled={moving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!destination || preview?.status !== "ready" || moving}
          >
            {moving ? "Moving…" : `Move ${assets.length} asset${assets.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
