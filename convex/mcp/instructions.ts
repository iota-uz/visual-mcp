/**
 * The server's `instructions` string — MCP's channel for telling a client how
 * the server works as a whole, rather than repeating it in every tool
 * description.
 *
 * v1 registered no instructions at all, and several tool descriptions cited
 * "PLAN.md section 7" — a file the caller cannot read. Everything a caller
 * needs to use this server correctly now lives here, once.
 */

import { listTemplates } from "@visual-canvas/runtime/templates/index.js";

export function buildInstructions(): string {
  // Derived from the live registry, not the reference-only TEMPLATE_IDS
  // constant in runtime/types.ts — that one is documentation and can drift.
  const templateIds = listTemplates().map((t) => t.id);
  return [
    "Visual Canvas authors shareable visual documents — diagrams, dashboards, reports, mockups —",
    "and serves them at stable URLs for humans to view and share.",
    "",
    "ADDRESSING. Every tool takes a single `ref` in one of two forms:",
    '  "workspace-slug/canvas-slug"  — e.g. "osago/fast-settlement". Creates on first save.',
    '  "<canvas_id>"                 — the opaque id returned by a previous call.',
    "Prefer the slug form: it is stable, human-readable, and makes canvas_save idempotent, so a",
    "retried call updates the same canvas instead of creating a duplicate. File paths are never",
    "part of the ref — they go in their own `path` field.",
    "A user may paste an element locator like canvas://osago/fast-settlement?node=phone-checkout.",
    "Pass it unchanged as canvas_get({ref_id}); do not ask them to name the canvas separately.",
    "",
    "AUTHORING. One canvas_save call does the whole job: it creates the workspace and canvas if",
    "needed, writes files, renders, and publishes. You rarely need more than one call.",
    "  kind=canvas          author with CanvasDoc version=2 plus files in the same call",
    "  kind=html|image|pdf  author with `files` + `renders`",
    "CanvasDoc v2 has explicit world/rect geometry, native|iframe node unions and anchor endpoints.",
    "Iframe entrypoints must be local .html files under /src/screens/; external URLs, traversal and",
    "allow-same-origin are rejected. Upload runtime/CSS/JS/assets with doc atomically. Use render",
    "target {type:'canvas'} for PNG/PDF/thumbnail or {type:'file',entrypoint} for HTML/D2.",
    "Phone nodes use viewport {width:284,height:642} and frame {kind:'phone',time:'09:42'}.",
    "The canvas owns the canonical OSAGO bezel, notch and status bar. Phone iframe HTML must contain",
    "only screen content; never duplicate a phone shell or status bar inside the entrypoint.",
    "Screens start inactive: single-click selects, double-click or Enter activates; Escape or Exit",
    "returns pointer/keyboard control to pan/zoom. Public share views remain interactive.",
    "For incremental changes use canvas_edit (one exact old_string/new_string replacement),",
    "canvas_apply_patch (atomic Codex-style multi-file patch), or canvas_doc_patch (semantic graph",
    "entities). Always read first and pass expected_version; edits never require regenerating the",
    "whole project.",
    "",
    "FILE PATHS. Writable: /src (sources), /assets (images, fonts), /output (results).",
    "Read-only: /cache (render scratch, deleted after 24h). Reference assets from your HTML with",
    'root-relative paths like "/assets/logo.png".',
    "",
    "LARGE FILES. Do NOT inline megabytes of base64 into a tool call — it burns context and may",
    "exceed the request limit. Call canvas_upload_url, POST the bytes to the returned URL out of",
    "band, then pass the storageId you get back as `upload_id` on the file. Small text files can",
    "go inline via `text`.",
    "",
    "ASSET LIBRARY. asset_list searches personal or workspace media and returns immutable asset://",
    "refs. asset_get(include_preview=true) puts visual media directly in multimodal model context.",
    "Use asset_upload_url + asset_finalize for binary uploads, asset_import for an HTTPS source,",
    "and asset_attach (or files[].asset_ref in canvas_save) to pin a revision under /assets/.",
    "Updating a library asset never mutates old or current canvas versions automatically.",
    "",
    "URLS. canvas_save and canvas_get return real, fully-qualified URLs:",
    "  canvas_url  — the signed-in viewer, for teammates",
    "  share_url   — the public link, only present once visibility is 'public'",
    "  embed       — a static public preview image + ready GitHub/Markdown link for the canvas",
    "  artifacts[].github_markdown — the same card pattern for each requested/rendered artifact",
    "Hand the user share_url when they ask for something to share. Never construct URLs yourself.",
    "Embed cards are images, not iframe viewers: clicking one opens the existing public share view",
    "or the public artifact. Make private / Replace link revokes the matching card URLs too.",
    "",
    "RESULTS. Tools return structured content. Check `status`: 'ok' means everything worked,",
    "'partial' means the content was saved but something else (usually a render) did not — read",
    "`warnings` to find out what. Warnings also report unresolved asset references, so an image",
    "that silently 404s in the render is reported rather than shipped broken.",
    "",
    `TEMPLATES. Available as resources at canvas://templates/{id}. Ids: ${templateIds.join(", ")}.`,
    "Read one before authoring if you want a known-good starting structure.",
  ].join("\n");
}
