export interface McpGuide {
  id: "authoring" | "production-ui" | "device-frames" | "assets";
  title: string;
  description: string;
  text: string;
}

export const MCP_GUIDES: readonly McpGuide[] = [
  {
    id: "authoring",
    title: "Canvas authoring workflow",
    description: "Addressing, reads, atomic writes, conflict recovery, pages, prototypes, and delivery.",
    text: `# Canvas authoring

Use the loop: understand intent → read relevant canvas/template/theme context → author → inspect deterministic save diagnostics → snapshot the smallest changed target → refine.

## Addressing and reads

Use one stable ref, preferably \`workspace-slug/canvas-slug\`. A canvas id, returned URL, public slug, canvas:// URI, or complete element ref is also accepted. Keep file paths in \`path\`, never in the ref. Start existing work with \`canvas_get\`; use projections and pagination for large canvases, and \`canvas_file_get\` for exact file content.

## Writes

\`canvas_save\` upserts atomically by ref. A CanvasFile v3 owns ordered Pages of CanvasDoc v2 plus one prototype. Files, assets, checkpoints, visibility, and sharing remain canvas-level. Use \`canvas_edit\` for one exact replacement, \`canvas_apply_patch\` for atomic multi-file edits, and \`canvas_doc_patch\` for typed graph operations. Use page/prototype tools for those structures and batch node tools for multi-selection moves/deletes. Read first and pass expected version, draft revision, and file hashes. On conflict, reread; hash-backed file edits may safely rebase when their targets are unchanged.

Micro-edits advance \`draft_revision\`; checkpoint at meaningful milestones. Publishing checkpoints the complete draft. A metadata-only save should not trigger visual QA. For visual edits, follow returned snapshot arguments and confirm the same draft revision before refining.

## Delivery

Use the returned URLs. \`canvas_url\` is the signed-in viewer, \`present_url\` is immersive canvas playback, and \`share_url\` exists only for public canvases. Never construct URLs.`,
  },
  {
    id: "production-ui",
    title: "Production UI quality contract",
    description: "Required UI quality, state coverage, deterministic diagnostics, and visual QA.",
    text: `# Production UI quality

Build the full requested workflow, not a hero-frame sketch. Establish one primary hierarchy, realistic domain content, familiar controls, responsive behavior at declared viewports, accessible names and alt text, keyboard-visible focus, and deliberate loading, empty, error, success, disabled, validation, and overflow states where relevant.

Use resolved semantic tokens for surfaces, text hierarchy, borders, primary/accent, status colors, typography, radii, spacing, shadows, charts, and diagram styling. Do not copy a competing palette into a template. Avoid decorative blobs, gratuitous gradients and pills, cards nested inside cards, repeated identical tiles, vague marketing copy, unlabeled icon controls, internal prompts/tool names/schema notes, placeholder TODOs, duplicate phone/browser chrome, and interactions with no meaningful content.

\`warnings\` identify integrity or potentially broken output; \`recommendations\` are non-blocking improvements and next actions. Neither quality feedback nor overlap alone changes save status to partial. Inspect every diagnostic location, resolving unexplained issues.

## Visual QA after a meaningful edit

1. Snapshot the smallest changed screen/node/region using the returned arguments.
2. Confirm the snapshot reports the saved \`draft_revision\`.
3. Check hierarchy, alignment, spacing, clipping/overflow, type scale, contrast, states, content, assets, theme consistency, and device chrome.
4. Correct issues and snapshot again. Expand to overview or another viewport only when the local target is sound.`,
  },
  {
    id: "device-frames",
    title: "Device and browser frames",
    description: "Canonical phone and Safari shells, viewports, activation, and snapshot behavior.",
    text: `# Device frames

Iframe nodes load only local \`/src/screens/*.html\` entrypoints. External URLs, traversal, and \`allow-same-origin\` are rejected. The screen file contains product content only.

For \`frame.kind=phone\`, use viewport 284×642 and let Canvas draw the bezel, notch, and status bar. For web mockups, prefer \`frame.kind=device\` with \`iphone-safari\` or \`desktop-safari\`; omit viewport to accept the preset. \`frame.url\` is cosmetic. \`display=clip\` represents a real fixed screen; \`full-height\` may grow a page beyond the preset height. Never draw a second handset, status bar, browser toolbar, or window shell inside HTML.

Screens select on one click and activate on double-click or Enter; Escape exits interaction. Public shares remain interactive. Snapshot a changed screen node rather than the whole canvas when possible so only relevant iframe runtimes load and text remains readable.`,
  },
  {
    id: "assets",
    title: "Files and reusable assets",
    description: "Canvas files, uploads, Asset Library reuse, security, and unresolved references.",
    text: `# Files and assets

Canvas-private writable roots are \`/src\`, \`/assets\`, and \`/output\`; \`/cache\` is temporary and read-only. Reference local media with root-relative paths. Save small text inline. For binary or large content, request upload URLs (up to 50), follow each returned method and Content-Type, then pass each \`upload_id\` in one atomic save.

The Asset Library is for cross-canvas reuse and is separate from private canvas files. Search with \`asset_list\`, inspect with \`asset_get(include_preview=true)\`, upload/finalize in batches, import HTTPS sources, and attach immutable revisions under \`/assets\`. Moving an asset changes library scope without rewriting existing pinned bindings; deleting archives it. SVG is trusted internal workspace content and must be preserved byte-for-byte. Audio is not supported.

Treat unresolved references as broken output: fix or attach every missing image, font, stylesheet, script, or data file before delivery.`,
  },
];
