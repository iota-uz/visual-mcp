import type { CanvasPoster } from "@visual-canvas/canvas/poster.js";
import { Film, Images, LayoutDashboard, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatBytes } from "../lib/formatBytes";
import { CanvasCover } from "./CanvasCover";
import { ConfirmButton } from "./ConfirmButton";
import { RenameForm } from "./RenameForm";
import type { StaticRenderState } from "./StaticRenderStatus";
import { useToast } from "./Toast";
import { Menu } from "./ui/Menu";

/** One entry in `workspaces.listMine`'s recent-canvas projection. */
export interface RecentCanvas {
  canvas_id: string;
  title: string;
  kind: string;
  thumbnail_url: string | null;
  poster: CanvasPoster | null;
  static_render_status: StaticRenderState;
}

export interface WorkspaceSummary {
  workspace_id: Id<"workspaces">;
  slug: string;
  name: string;
  description?: string;
  canvas_count?: number;
  recent?: RecentCanvas[];
}

/** How many covers fit across a card without shrinking to stamps. */
const COVERS = 3;

/*
 * One workspace, in a grid.
 *
 * It used to be a full-width lane whose only clickable thing was the name,
 * while the whole row grew an accent ring on hover and the four preview
 * thumbnails inside it were each a link. So the contents of a workspace
 * looked more clickable than the workspace, and the row looked clickable
 * where it wasn't. Now the card is one hit area (`.card-hit`), the covers
 * are decoration, and the two destructive actions live behind ⋯ instead of
 * sitting permanently in the row at 55% opacity.
 */
export function WorkspaceCard({
  workspace,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceSummary;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<{ canvases_deleted: number; bytes_reclaimed: number }>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const { notify } = useToast();

  // Both come from `listMine`'s own projection. They used to come from a
  // per-row `listForWorkspace` subscription that fetched every canvas in
  // every workspace, signed a URL for each thumbnail, and kept `.length`.
  const count = workspace.canvas_count;
  const recent = (workspace.recent ?? []).slice(0, COVERS);

  return (
    <li className="workspace-card card-hit">
      <div className="workspace-card-head">
        {renaming ? (
          <RenameForm
            initial={workspace.name}
            label="Workspace name"
            className="workspace-card-link"
            onSave={onRename}
            onDone={() => setRenaming(false)}
          />
        ) : (
          <Link to={`/w/${workspace.slug}`} className="workspace-card-link card-hit-link">
            {workspace.name}
          </Link>
        )}
        <Menu
          triggerRef={menuRef}
          className="card-hit-actions"
          label={`Actions for ${workspace.name}`}
          items={[
            {
              id: "canvases",
              label: "Open canvases",
              icon: LayoutDashboard,
              to: `/w/${workspace.slug}`,
            },
            { id: "videos", label: "Videos", icon: Film, to: `/w/${workspace.slug}/videos` },
            // The sidebar's workspace links are asset-library shortcuts and
            // say so nowhere else; this is where that library is findable
            // from the surface workspaces actually live on.
            { id: "assets", label: "Assets", icon: Images, to: `/w/${workspace.slug}/assets` },
            { id: "rename", label: "Rename", icon: Pencil, onSelect: () => setRenaming(true) },
            { id: "sep", separator: true },
            {
              id: "delete",
              label: "Delete workspace…",
              icon: Trash2,
              danger: true,
              onSelect: () => setConfirming(true),
            },
          ]}
        />
      </div>
      {count !== undefined && (
        <span className="eyebrow workspace-card-count">
          {count} {count === 1 ? "canvas" : "canvases"}
        </span>
      )}
      {workspace.description && <p className="workspace-card-note">{workspace.description}</p>}

      {/* What is in here, without going in. Decoration, not navigation: as
          links these were the loudest hover target on the card. */}
      {recent.length > 0 && (
        <div className="workspace-card-covers" aria-hidden="true">
          {recent.map((canvas) => (
            <CanvasCover
              key={canvas.canvas_id}
              kind={canvas.kind}
              poster={canvas.poster}
              thumbnailUrl={canvas.thumbnail_url}
              size="strip"
              className={`canvas-card-${canvas.kind}`}
            />
          ))}
        </div>
      )}

      {confirming && (
        <ConfirmButton
          defaultArmed
          onDisarm={() => setConfirming(false)}
          returnFocusRef={menuRef}
          confirmLabel="Delete workspace"
          description={
            count === undefined
              ? "Deletes this workspace and every canvas in it. Permanent."
              : `Deletes this workspace and ${count} ${count === 1 ? "canvas" : "canvases"}. Permanent.`
          }
          onConfirm={async () => {
            // The mutation has always returned what it destroyed; the row
            // just vanished and never said so.
            const result = await onDelete();
            notify({
              message: `Deleted “${workspace.name}” — ${result.canvases_deleted} ${
                result.canvases_deleted === 1 ? "canvas" : "canvases"
              }, ${formatBytes(result.bytes_reclaimed)} freed.`,
            });
          }}
        />
      )}
    </li>
  );
}
