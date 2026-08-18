import { useMutation, useQuery } from "convex/react";
import { Ban, KeyRound } from "lucide-react";
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
import { Panel } from "../components/ui/Panel";
import { Checkbox, TextInput } from "../components/ui/TextInput";
import { formatAbsoluteTime, formatRelativeTime, formatTimeUntil } from "../lib/formatDate";

interface TokenRow {
  tokenId: string;
  name: string;
  prefix: string;
  expiresAt: number;
  lastUsedAt?: number | null;
  revokedAt?: number | null;
}

/** Long enough to notice, short enough that it isn't always on. */
const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 86_400_000;

function TokenStatus({ token, now }: { token: TokenRow; now: number }) {
  if (token.revokedAt) {
    return (
      <>
        <Badge tone="danger">revoked</Badge>
        <span className="muted">{formatRelativeTime(token.revokedAt, now)}</span>
      </>
    );
  }
  if (token.expiresAt <= now) {
    return (
      <>
        <Badge tone="warning">expired</Badge>
        <span className="muted">{formatRelativeTime(token.expiresAt, now)}</span>
      </>
    );
  }
  const expiringSoon = token.expiresAt - now < EXPIRY_WARNING_DAYS * DAY_MS;
  return (
    <>
      <Badge tone={expiringSoon ? "warning" : "success"}>active</Badge>
      <span className="muted" title={formatAbsoluteTime(token.expiresAt)}>
        expires {formatTimeUntil(token.expiresAt, now)}
      </span>
    </>
  );
}

function TokenItem({
  token,
  now,
  onRevoke,
}: {
  token: TokenRow;
  now: number;
  onRevoke: () => Promise<unknown>;
}) {
  return (
    <li className="card-list-item row-item token-row">
      <div className="row-item-main">
        <strong>{token.name}</strong>
        <code className="token-row-prefix">{token.prefix}…</code>
        {/* The question people actually arrive with is "did my `claude mcp
            add` line work?". The answer was already in the payload and was
            never rendered as anything but a date. */}
        <span className="muted token-row-used">
          {token.lastUsedAt ? (
            <>
              used{" "}
              <time dateTime={new Date(token.lastUsedAt).toISOString()}>
                {formatRelativeTime(token.lastUsedAt, now)}
              </time>
            </>
          ) : (
            "never used"
          )}
        </span>
      </div>
      <div className="row-item-actions">
        <TokenStatus token={token} now={now} />
        {!token.revokedAt && (
          // Was a one-click bare button with no confirmation and a floating
          // promise — one stray click silently killed a live agent
          // connection. Every other destructive action in the app arms
          // first; this one now does too.
          <ConfirmButton
            label="Revoke"
            confirmLabel="Really revoke?"
            busyLabel="Revoking…"
            icon={Ban}
            description={`Any agent still using "${token.name}" stops working immediately.`}
            onConfirm={onRevoke}
          />
        )}
      </div>
    </li>
  );
}

export function TokensPage() {
  const tokens = useQuery(api.tokens.listMine, {});
  const mint = useMutation(api.tokens.mintMine);
  const revoke = useMutation(api.tokens.revokeMine);
  const { notify } = useToast();
  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [justMinted, setJustMinted] = useState<{ token: string; expiresAt: number } | null>(null);
  const [showDead, setShowDead] = useState(false);

  // One clock for the whole render, so two rows can't disagree about which
  // side of an expiry boundary they are on.
  const now = Date.now();
  const isDead = (t: TokenRow) => Boolean(t.revokedAt) || t.expiresAt <= now;
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
    <div className="page-stack">
      <PageHeader
        title="MCP tokens"
        back={{ to: "/", label: "Workspaces" }}
        subtitle="A token is how Claude Code or Codex reaches this deployment. They last 90 days, and the full value is shown once — right after minting."
      />

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

      {/* Below the form that produced it, not above it — and accent rather
          than warning, because minting succeeded. The urgency belongs in the
          words, not in a hazard-coloured box around a working token. */}
      {justMinted && (
        <Panel tone="accent" className="token-reveal" role="status">
          <p className="token-reveal-lead">
            <strong>Copy this now.</strong> It is stored hashed, so this is the only time it can be
            shown.
          </p>
          <CopyableValue className="token-reveal-row" as="block" value={justMinted.token} />
          <p className="muted">
            Expires {formatAbsoluteTime(justMinted.expiresAt)} (
            {formatTimeUntil(justMinted.expiresAt, now)})
          </p>
          <ConnectPanel token={justMinted.token} showTokenLink={false} />
          <Button variant="secondary" onClick={() => setJustMinted(null)}>
            Done
          </Button>
        </Panel>
      )}

      {tokens === undefined && <LoadingState label="Loading tokens…" />}
      {tokens?.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title="No tokens yet."
          hint="Mint one above to connect an agent over MCP."
        />
      )}
      {/* Dead tokens only accumulate — `listMine` never filters them — and a
          list of six revoked rows buries the one that still works. Hidden
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
        <ul className="card-list">
          {visible.map((t) => (
            <TokenItem
              key={t.tokenId}
              token={t}
              now={now}
              onRevoke={async () => {
                await revoke({ tokenId: t.tokenId });
                notify({ message: `Revoked "${t.name}".` });
              }}
            />
          ))}
        </ul>
      )}

      {/* The panel used to exist only inside the post-mint reveal and inside
          Home's disclosure, so someone who minted a token last week on
          another machine had no route to the `claude mcp add` line from the
          page the sidebar sends them to. */}
      <ConnectPanel showTokenLink={false} />
    </div>
  );
}
