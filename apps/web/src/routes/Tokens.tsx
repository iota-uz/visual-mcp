import { useMutation, useQuery } from "convex/react";
import { Ban } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Badge } from "../components/Badge";
import { ConfirmButton } from "../components/ConfirmButton";
import { ConnectPanel } from "../components/ConnectPanel";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { toastError, useToast } from "../components/Toast";
import { Button } from "../components/ui/Button";
import { CopyableValue } from "../components/ui/CopyableValue";
import { DataTable } from "../components/ui/DataTable";
import { Panel } from "../components/ui/Panel";
import { Checkbox, TextInput } from "../components/ui/TextInput";

export function TokensPage() {
  const tokens = useQuery(api.tokens.listMine, {});
  const mint = useMutation(api.tokens.mintMine);
  const revoke = useMutation(api.tokens.revokeMine);
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState<{ token: string; expiresAt: number } | null>(null);
  const [showDead, setShowDead] = useState(false);

  const isDead = (t: { revokedAt?: number | null; expiresAt: number }) =>
    Boolean(t.revokedAt) || t.expiresAt <= Date.now();
  const deadCount = tokens?.filter(isDead).length ?? 0;
  const visible = (tokens ?? []).filter((t) => showDead || !isDead(t));

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setMinting(true);
    try {
      const result = await mint({ name: name.trim() });
      setJustMinted({ token: result.token, expiresAt: result.expiresAt });
      setName("");
    } catch (err: unknown) {
      notify(toastError(err, "Couldn't mint the token"));
    } finally {
      setMinting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="MCP tokens"
        back={{ to: "/", label: "Workspaces" }}
        subtitle="Tokens let Claude Code or Codex connect to this deployment over MCP. They expire after 90 days and are shown in full exactly once, right after minting."
      />

      {justMinted && (
        <Panel tone="warning" className="token-reveal">
          <p>
            <strong>Copy this now — it won't be shown again:</strong>
          </p>
          <CopyableValue className="token-reveal-row" as="block" value={justMinted.token} />
          <p className="muted">Expires {new Date(justMinted.expiresAt).toLocaleDateString()}</p>
          <ConnectPanel token={justMinted.token} showTokenLink={false} />
          <Button variant="secondary" onClick={() => setJustMinted(null)}>
            Done
          </Button>
        </Panel>
      )}

      <form onSubmit={handleMint} className="inline-form">
        <TextInput
          id="token-name"
          label="Token name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Token name (e.g. laptop)"
          disabled={minting}
        />
        <Button type="submit" variant="primary" busy={minting} disabled={!name.trim()}>
          {minting ? "Minting…" : "Mint token"}
        </Button>
      </form>

      {tokens === undefined && <LoadingState label="Loading tokens…" />}
      {tokens?.length === 0 && (
        <EmptyState title="No tokens yet." hint="Mint one above to connect Claude over MCP." />
      )}
      {/* Dead tokens only accumulate — `listMine` never filters them — and a
          table of six revoked rows buries the one that still works. Hidden
          by default, one click away, count shown so nothing is a surprise.
          (The real fix is filtering server-side; this is the UI half.) */}
      {tokens && tokens.length > 0 && deadCount > 0 && (
        <Checkbox
          className="token-filter"
          checked={showDead}
          onChange={(e) => setShowDead(e.target.checked)}
          label={`Show ${deadCount} revoked or expired ${deadCount === 1 ? "token" : "tokens"}`}
        />
      )}
      {tokens && visible.length === 0 && tokens.length > 0 && (
        <EmptyState
          title="No active tokens."
          hint="Every token here is revoked or expired — mint a new one above."
        />
      )}
      {visible.length > 0 && (
        <DataTable
          className="token-table-wrap"
          caption="MCP tokens"
          head={
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Expires</th>
              <th>Last used</th>
              <th>Status</th>
              {/* The revoke cell. Named, because a screen reader reading
                  across the row announces the column it is in. */}
              <th>Actions</th>
            </tr>
          }
        >
          {visible.map((t) => (
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
                  // Was a one-click bare button with no confirmation and
                  // a floating promise — one stray click silently killed
                  // a live agent connection. Every other destructive
                  // action in the app arms first; this one now does too.
                  <ConfirmButton
                    label="Revoke"
                    confirmLabel="Really revoke?"
                    busyLabel="Revoking…"
                    icon={Ban}
                    description={`Any agent still using "${t.name}" stops working immediately.`}
                    onConfirm={async () => {
                      await revoke({ tokenId: t.tokenId });
                      notify({ message: `Revoked "${t.name}".` });
                    }}
                  />
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
