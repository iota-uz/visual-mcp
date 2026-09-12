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
import { AssetWell } from "./video/shots/AssetWell";

export type WorkspaceCover =
  | {
      type: "canvas";
      canvas_id: string;
      title: string;
      kind: string;
      thumbnail_url: string | null;
      poster: CanvasPoster | null;
      static_render_status: StaticRenderState;
    }
  | {
      type: "video";
      projectId: string;
      title: string;
      workspaceId: Id<"workspaces">;
      poster: { assetId: string; revisionId: string } | null;
    };

export interface WorkspaceSummary {
  workspace_id: Id<"workspaces">;
  slug: string;
  name: string;
  description?: string;
  canvas_count?: number;
  video_count?: number;
  recent?: WorkspaceCover[];
}

const COVERS = 3;

function countLine(canvases: number | undefined, videos: number | undefined) {
  const parts: string[] = [];
  if (canvases !== undefined) parts.push(`${canvases} ${canvases === 1 ? "canvas" : "canvases"}`);
  if (videos !== undefined) parts.push(`${videos} ${videos === 1 ? "video" : "videos"}`);
  return parts.join(" · ");
}

export function WorkspaceCard({
  workspace,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceSummary;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<{
    canvases_deleted: number;
    videos_deleted?: number;
    bytes_reclaimed: number;
  }>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const { notify } = useToast();
  const canvases = workspace.canvas_count;
  const videos = workspace.video_count;
  const recent = (workspace.recent ?? []).slice(0, COVERS);
  const counts = countLine(canvases, videos);

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
      {counts && <span className="eyebrow workspace-card-count">{counts}</span>}
      {workspace.description && <p className="workspace-card-note">{workspace.description}</p>}

      {recent.length > 0 && (
        <div className="workspace-card-covers" aria-hidden="true">
          {recent.map((item) =>
            item.type === "video" ? (
              <AssetWell
                key={item.projectId}
                workspaceId={item.workspaceId}
                asset={item.poster ?? undefined}
                className="workspace-card-video"
                fallback={<Film size={18} />}
              />
            ) : (
              <CanvasCover
                key={item.canvas_id}
                kind={item.kind}
                poster={item.poster}
                thumbnailUrl={item.thumbnail_url}
                size="strip"
                className={`canvas-card-${item.kind}`}
              />
            ),
          )}
        </div>
      )}

      {confirming && (
        <ConfirmButton
          defaultArmed
          onDisarm={() => setConfirming(false)}
          returnFocusRef={menuRef}
          confirmLabel="Delete workspace"
          description={
            !canvases && !videos
              ? "Deletes this workspace and every canvas and video in it. Permanent."
              : `Deletes this workspace, ${canvases ?? 0} ${
                  canvases === 1 ? "canvas" : "canvases"
                } and ${videos ?? 0} ${videos === 1 ? "video" : "videos"}. Permanent.`
          }
          onConfirm={async () => {
            const result = await onDelete();
            const videoCount = result.videos_deleted ?? 0;
            notify({
              message: `Deleted “${workspace.name}” — ${result.canvases_deleted} ${
                result.canvases_deleted === 1 ? "canvas" : "canvases"
              }, ${videoCount} ${videoCount === 1 ? "video" : "videos"}, ${formatBytes(result.bytes_reclaimed)} freed.`,
            });
          }}
        />
      )}
    </li>
  );
}
