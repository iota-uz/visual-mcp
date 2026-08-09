import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";

export function TokensPage() {
  const tokens = useQuery(api.tokens.listMine, {});
  const mint = useMutation(api.tokens.mintMine);
  const revoke = useMutation(api.tokens.revokeMine);
  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState<{ token: string; expiresAt: number } | null>(null);

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setMinting(true);
    try {
      const result = await mint({ name: name.trim() });
      setJustMinted({ token: result.token, expiresAt: result.expiresAt });
      setName("");
    } finally {
      setMinting(false);
    }
  }

  const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "<your-deployment>";
  const mcpUrl = convexUrl.replace(/\.convex\.cloud$/, ".convex.site").replace(/\/+$/, "");

  return (
    <div>
      <h1>MCP tokens</h1>
      <p className="muted">
        Tokens let Claude connect to this workspace over MCP. They expire after 90 days and are
        shown in full exactly once, right after minting.
      </p>

      {justMinted && (
        <div className="token-reveal">
          <p>
            <strong>Copy this now — it won't be shown again:</strong>
          </p>
          <code>{justMinted.token}</code>
          <p className="muted">Expires {new Date(justMinted.expiresAt).toLocaleDateString()}</p>
          <p className="muted">Configure with:</p>
          <pre>
            {`claude mcp add --transport http visual-canvas ${mcpUrl}/mcp \\\n  --header "Authorization: Bearer ${justMinted.token}"`}
          </pre>
          <button type="button" onClick={() => setJustMinted(null)}>
            Done
          </button>
        </div>
      )}

      <form onSubmit={handleMint} className="inline-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. laptop)"
          disabled={minting}
        />
        <button type="submit" disabled={minting || !name.trim()}>
          Mint token
        </button>
      </form>

      <table className="token-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Expires</th>
            <th>Last used</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens?.map((t) => (
            <tr key={t.tokenId}>
              <td>{t.name}</td>
              <td>
                <code>{t.prefix}…</code>
              </td>
              <td>{new Date(t.expiresAt).toLocaleDateString()}</td>
              <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}</td>
              <td>{t.revokedAt ? "revoked" : t.expiresAt <= Date.now() ? "expired" : "active"}</td>
              <td>
                {!t.revokedAt && (
                  <button type="button" onClick={() => revoke({ tokenId: t.tokenId })}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
