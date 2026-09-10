import { ExternalLink, Film, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { formatAbsoluteTime, formatRelativeTime } from "../lib/formatDate";
import { Badge } from "./Badge";
import { ConfirmButton } from "./ConfirmButton";
import { RenameForm } from "./RenameForm";
import { useToast } from "./Toast";
import { Menu } from "./ui/Menu";

export interface VideoProjectRow {
  projectId: Id<"videoProjects">;
  title: string;
  topic?: string;
  updatedAt: number;
  languages?: Array<"ru" | "uz">;
}

export function VideoProjectCard({
  project,
  onRename,
  onDelete,
}: {
  project: VideoProjectRow;
  onRename?: (title: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const { notify } = useToast();

  return (
    <li className="video-project-card card-hit">
      <span className="video-project-card-frame" aria-hidden="true">
        <Film size={28} />
      </span>
      <div className="canvas-card-head">
        <div className="canvas-card-headings">
          {renaming && onRename ? (
            <RenameForm
              initial={project.title}
              label="Video title"
              className="canvas-card-title"
              onSave={onRename}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <Link to={`/v/${project.projectId}`} className="canvas-card-link card-hit-link">
              <span className="canvas-card-title">{project.title}</span>
            </Link>
          )}
          <span className="canvas-card-meta">
            <time
              dateTime={new Date(project.updatedAt).toISOString()}
              title={formatAbsoluteTime(project.updatedAt)}
            >
              {formatRelativeTime(project.updatedAt)}
            </time>
            {project.languages?.map((language) => (
              <Badge key={language}>{language === "ru" ? "RU" : "UZ"}</Badge>
            ))}
          </span>
        </div>
        {(onRename || onDelete) && (
          <Menu
            triggerRef={menuRef}
            className="card-hit-actions"
            label={`Actions for ${project.title}`}
            items={[
              {
                id: "open",
                label: "Open",
                icon: ExternalLink,
                to: `/v/${project.projectId}`,
              },
              ...(onRename
                ? [
                    {
                      id: "rename",
                      label: "Rename",
                      icon: Pencil,
                      onSelect: () => setRenaming(true),
                    },
                  ]
                : []),
              ...(onDelete
                ? [
                    { id: "sep", separator: true as const },
                    {
                      id: "delete",
                      label: "Delete video…",
                      icon: Trash2,
                      danger: true,
                      onSelect: () => setConfirming(true),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
      {project.topic && <p className="canvas-card-description">{project.topic}</p>}
      {confirming && onDelete && (
        <ConfirmButton
          defaultArmed
          onDisarm={() => setConfirming(false)}
          returnFocusRef={menuRef}
          confirmLabel="Delete video"
          busyLabel="Deleting…"
          description={`Deletes “${project.title}” and its drafts, versions and jobs. Permanent.`}
          onConfirm={async () => {
            await onDelete();
            notify({ message: `Deleted “${project.title}”.` });
          }}
        />
      )}
    </li>
  );
}
