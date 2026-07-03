# Visual Runtime MCP Server

Sandboxed MCP server that lets an LLM agent generate visual artifacts —
dashboards, diagrams, reports, mobile/browser mockups — as PNG, SVG, PDF, or
HTML, using HTML+Tailwind v4, [D2](https://d2lang.com) diagrams, and
ApexCharts. See [PLAN.md](./PLAN.md) for the full spec.

## Install

### Claude Code plugin (recommended)

```
/plugin marketplace add iota-uz/visual-mcp
/plugin install visual-runtime@visual-mcp
```

### Claude Code (MCP server only, no plugin)

```
claude mcp add visual-runtime -- npx -y github:iota-uz/visual-mcp
```

### Claude Desktop / other MCP clients

Add to your MCP client's config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "visual-runtime": {
      "command": "npx",
      "args": ["-y", "github:iota-uz/visual-mcp"]
    }
  }
}
```

The first run installs dependencies, builds the TypeScript sources, and
downloads a headless Chromium build for Playwright — this can take a minute
or two. Subsequent runs reuse npm's cache and start immediately. Requires
Node.js >= 20.

### Working on this repo directly

If you've cloned this repo and want the MCP server to auto-load in Claude
Code sessions started from it, a `.mcp.json` pointing at the local build is
already checked in. It's named `visual-runtime-dev` (not `visual-runtime`) so
it doesn't collide with a globally installed `visual-runtime` plugin/server:

```json
{
  "mcpServers": {
    "visual-runtime-dev": {
      "command": "node",
      "args": ["dist/server/index.js"]
    }
  }
}
```

Run `npm install` once (this also builds `dist/` and installs the Chromium
browser via `prepare`/`postinstall`), then reload/start Claude Code from the
repo root.

## Development

```
npm install     # installs deps, builds dist/, installs Chromium
npm run build   # rebuild after changes
npm test        # run the test suite
npm run typecheck
```

## Tools

| Tool | Purpose |
| --- | --- |
| `create_visual_session` | Create an isolated session workspace (`/src`, `/output`, `/assets`, `/templates`, `/cache`) |
| `list_templates` | List the built-in starter templates (dashboard, architecture diagram, chart report, mobile/browser mockups, multipage report, etc.) |
| `write_file` | Write source files (HTML, D2, CSS, JS) into a session's `/src` or `/output` |
| `run_code` | Execute JS/TS in a resource-limited sandbox (worker-thread isolated; no shell access) |
| `render_file` | Render an HTML or `.d2` entrypoint to PNG/SVG/PDF/HTML |
| `list_artifacts` | List a session's rendered artifacts with their manifest (primary/supporting/debug roles) |
| `export_artifact` | Fetch a rendered artifact's bytes/text |
