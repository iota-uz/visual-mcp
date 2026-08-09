import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";

function NodeSearch() {
  const [term, setTerm] = useState("");
  const results = useQuery(api.canvases.searchNodes, { query: term });

  return (
    <div className="node-search">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search canvas nodes…"
      />
      {term.trim() && (
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
      <h1>Workspaces</h1>
      {workspaces === undefined && <p>Loading…</p>}
      {workspaces?.length === 0 && <p>No workspaces yet — create one below.</p>}
      <ul className="card-list">
        {workspaces?.map((w) => (
          <li key={w.workspace_id}>
            <Link to={`/w/${w.slug}`} className="card-list-item">
              <strong>{w.name}</strong>
              {w.description && <span className="muted"> — {w.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <form onSubmit={handleCreate} className="inline-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workspace name"
          disabled={creating}
        />
        <button type="submit" disabled={creating || !name.trim()}>
          Create
        </button>
      </form>
    </div>
  );
}
