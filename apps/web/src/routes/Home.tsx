import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";

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
