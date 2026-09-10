import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PageHeader } from "./PageHeader";

export interface WorkspaceChromeWorkspace {
  workspace_id: Id<"workspaces">;
  name: string;
  description?: string;
}

export function WorkspaceChrome({
  slug,
  workspace,
  subtitle,
  actions,
  onRename,
}: {
  slug: string;
  workspace?: WorkspaceChromeWorkspace | null;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onRename?: (name: string) => Promise<unknown>;
}) {
  return (
    <>
      <PageHeader
        title={workspace?.name ?? slug}
        crumbs={[{ to: "/", label: "Workspaces" }]}
        onRename={workspace && onRename ? onRename : undefined}
        renameLabel="Workspace name"
        subtitle={subtitle}
        actions={actions}
      />
      <nav className="workspace-collections" aria-label="Workspace collections">
        <NavLink to={`/w/${slug}`} end className={collectionClass}>
          Canvases
        </NavLink>
        <NavLink to={`/w/${slug}/videos`} className={collectionClass}>
          Videos
        </NavLink>
        <NavLink to={`/w/${slug}/assets`} className={collectionClass}>
          Assets
        </NavLink>
      </nav>
    </>
  );
}

function collectionClass({ isActive }: { isActive: boolean }) {
  return isActive ? "workspace-collections-link active" : "workspace-collections-link";
}
