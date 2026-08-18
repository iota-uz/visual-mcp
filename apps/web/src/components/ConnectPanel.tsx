import { Plug } from "lucide-react";
import { Link } from "react-router-dom";
import {
  CODEX_TOKEN_ENV_VAR,
  claudeMcpCommand,
  codexMcpCommand,
  currentMcpEndpointUrl,
} from "../lib/mcpUrl";
import { CopyableValue } from "./ui/CopyableValue";
import { Panel } from "./ui/Panel";

interface ConnectPanelProps {
  /** Real token right after minting; omitted on the home empty state. */
  token?: string;
  /** Hide the "mint a token" link where the user is already on that page. */
  showTokenLink?: boolean;
}

/*
 * The whole product is "agents author, humans curate", so a signed-in user
 * with zero workspaces has nothing to do in this UI until an agent is
 * connected. This panel is that first step: the endpoint, where to get a
 * token, and a copy-paste line for each supported client.
 */
export function ConnectPanel({ token, showTokenLink = true }: ConnectPanelProps) {
  const endpoint = currentMcpEndpointUrl();
  const displayToken = token ?? "<your-token>";
  const claude = claudeMcpCommand(endpoint, displayToken);
  const codex = codexMcpCommand(endpoint, displayToken);

  return (
    <Panel as="section" className="connect-panel">
      <h2 className="connect-panel-title">
        <Plug size={16} aria-hidden="true" /> Connect your agent
      </h2>
      <p className="connect-panel-lead">
        Canvases are authored over MCP — point Claude Code or Codex at this endpoint and ask it to
        create one.
      </p>

      <CopyableValue
        className="connect-panel-block"
        as="block"
        label="MCP endpoint"
        value={endpoint}
        copyLabel="Copy URL"
      />

      {showTokenLink && (
        <p className="connect-panel-lead">
          Then <Link to="/settings/tokens">mint an MCP token</Link> and drop it into one of these
          commands.
        </p>
      )}

      <CopyableValue
        className="connect-panel-block"
        as="block"
        label="Claude Code"
        value={claude}
        copyLabel="Copy command"
      />

      <div className="connect-panel-block">
        <CopyableValue as="block" label="Codex" value={codex} copyLabel="Copy commands" />
        <p className="connect-panel-hint">
          Codex reads the bearer token from an env var, so keep the{" "}
          <code>{CODEX_TOKEN_ENV_VAR}</code> export in your shell profile (~/.zshrc) — otherwise the
          server stops authenticating in new shells.
        </p>
      </div>
    </Panel>
  );
}
