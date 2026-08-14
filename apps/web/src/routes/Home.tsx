import { useMutation, useQuery } from "convex/react";
import { Pencil, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ConfirmButton } from "../components/ConfirmButton";
import { ConnectPanel } from "../components/ConnectPanel";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RenameForm } from "../components/RenameForm";
import { useDebouncedValue } from "../lib/useDebouncedValue";

function NodeSearch() {
  const [term, setTerm] = useState("");
  // Debounced: every keystroke used to open a fresh Convex subscription,
  // so typing "europrotocol" cost twelve full-text queries and rendered
  // twelve throwaway result sets.
  const query = useDebouncedValue(term.trim(), 250);
  const results = useQuery(api.canvases.searchNodes, query ? { query } : "skip");

  return (
    <div className="node-search">
      <Search className="node-search-icon" size={14} />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search canvas nodes…"
      />
      {query && (
        <ul className="card-list">
          {results === undefined && <li className="muted">Searching…</li>}
          {results?.length === 0 && <li className="muted">No matches.</li>}
          {results?.map((r) => (
            <li key={`${r.canvasId}:${r.nodeId}`}>
              <Link to={`/c/${r.canvasId}?node=${encodeURIComponent(r.nodeId)}`}>
                <strong>{r.nodeTitle}</strong>
                {r.nodeEyebrow && <span className="muted"> — {r.nodeEyebrow}</span>}
                <span className="muted"> ({r.canvasTitle})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface WorkspaceSummary {
  workspace_id: Id<"workspaces">;
  slug: string;
  name: string;
  description?: string;
}

function WorkspaceRow({ workspace }: { workspace: WorkspaceSummary }) {
  // `listMine` returns no canvas count, and convex/ is off-limits here, so
  // the count is derived client-side from the same query the workspace page
  // uses. Accurate (it already filters archived rows) at the cost of one
  // extra subscription per row; the alternative — printing nothing — would
  // also leave the delete confirmation unable to say what is being lost.
  const canvases = useQuery(api.canvases.listForWorkspace, {
    workspaceId: workspace.workspace_id,
  });
  const rename = useMutation(api.workspaces.renameMine);
  const remove = useMutation(api.workspaces.deleteMine);
  const [editing, setEditing] = useState(false);

  const count = canvases?.length;

  if (editing) {
    return (
      <li className="card-list-item">
        <RenameForm
          initial={workspace.name}
          label="Workspace name"
          onSave={(name) => rename({ workspaceId: workspace.workspace_id, name })}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="card-list-item row-item">
      <Link to={`/w/${workspace.slug}`} className="row-item-main">
        <strong>{workspace.name}</strong>
        {workspace.description && <span className="muted"> — {workspace.description}</span>}
      </Link>
      <div className="row-item-actions">
        {count !== undefined && (
          <span className="muted row-item-meta">
            {count} {count === 1 ? "canvas" : "canvases"}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Rename
        </button>
        <ConfirmButton
          description={
            count === undefined
              ? "Deletes this workspace and every canvas in it. Permanent."
              : `Deletes this workspace and ${count} ${count === 1 ? "canvas" : "canvases"}. Permanent.`
          }
          onConfirm={() => remove({ workspaceId: workspace.workspace_id })}
        />
      </div>
    </li>
  );
}

export function HomePage() {
  const workspaces = useQuery(api.workspaces.listMine, {});
  const createWorkspace = useMutation(api.workspaces.createMine);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createWorkspace({ name: name.trim() });
      setName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <NodeSearch />
      <PageHeader title="Workspaces" />
      {workspaces === undefined && <LoadingState />}
      {workspaces?.length === 0 && <EmptyState title="No workspaces yet — create one below." />}
      <ul className="card-list">
        {workspaces?.map((w) => (
          <WorkspaceRow key={w.workspace_id} workspace={w} />
        ))}
      </ul>
      <form onSubmit={handleCreate} className="inline-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workspace name"
          disabled={creating}
        />
        <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
          Create
        </button>
      </form>
      {workspaces?.length === 0 && <ConnectPanel />}
    </div>
  );
}
