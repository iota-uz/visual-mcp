import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Badge } from "../components/Badge";
import { ConnectPanel } from "../components/ConnectPanel";
import { CopyButton } from "../components/CopyButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";

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

  return (
    <div>
      <PageHeader
        title="MCP tokens"
        subtitle="Tokens let Claude Code or Codex connect to this deployment over MCP. They expire after 90 days and are shown in full exactly once, right after minting."
      />

      {justMinted && (
        <div className="token-reveal">
          <p>
            <strong>Copy this now — it won't be shown again:</strong>
          </p>
          <div className="token-reveal-row">
            <code>{justMinted.token}</code>
            <CopyButton value={justMinted.token} />
          </div>
          <p className="muted">Expires {new Date(justMinted.expiresAt).toLocaleDateString()}</p>
          <ConnectPanel token={justMinted.token} showTokenLink={false} />
          <button type="button" className="btn btn-secondary" onClick={() => setJustMinted(null)}>
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
        <button type="submit" className="btn btn-primary" disabled={minting || !name.trim()}>
          Mint token
        </button>
      </form>

      {tokens === undefined && <LoadingState label="Loading tokens…" />}
      {tokens?.length === 0 && (
        <EmptyState title="No tokens yet." hint="Mint one above to connect Claude over MCP." />
      )}
      {tokens && tokens.length > 0 && (
        <div className="token-table-wrap">
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
              {tokens.map((t) => (
                <tr key={t.tokenId}>
                  <td>{t.name}</td>
                  <td>
                    <code>{t.prefix}…</code>
                  </td>
                  <td>{new Date(t.expiresAt).toLocaleDateString()}</td>
                  <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}</td>
                  <td>
                    {t.revokedAt ? (
                      <Badge tone="danger">revoked</Badge>
                    ) : t.expiresAt <= Date.now() ? (
                      <Badge tone="warning">expired</Badge>
                    ) : (
                      <Badge tone="success">active</Badge>
                    )}
                  </td>
                  <td>
                    {!t.revokedAt && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => revoke({ tokenId: t.tokenId })}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
