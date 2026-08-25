export interface McpGuide {
  id:
    | "authoring"
    | "production-ui"
    | "device-frames"
    | "assets"
    | "embeds"
    | "programmable-drawing";
  title: string;
  description: string;
  text: string;
}

export const MCP_GUIDES: readonly McpGuide[] = [
  {
    id: "authoring",
    title: "Canvas authoring workflow",
    description:
      "Addressing, reads, atomic writes, conflict recovery, pages, prototypes, and delivery.",
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
    id: "programmable-drawing",
    title: "Programmable drawing and issue visuals",
    description:
      "Async canvas_run, drawing primitives, layouts, compositions, and tracker-ready visual evidence.",
    text: `# Programmable drawing

Use \`canvas_run\` when a visual edit is easier to express as JavaScript than as individual MCP calls. The supplied JS/TS is an async body: top-level \`await\` works directly. The injected \`canvas\` SDK records operations in memory; call \`canvas.commit()\` once after the complete composition is ready. A failed script commits nothing, and a concurrent draft edit returns \`revision_conflict\` instead of overwriting it.

## Primitives and geometry

Create content with \`canvas.node.native\`, \`note\`, \`image\`, \`text\`, and \`frame\`. Add non-destructive annotations with \`canvas.drawing.rect\`, \`ellipse\`, \`line\`, \`arrow\`, \`path\`, \`highlight\`, \`badge\`, and \`callout\`. Points may be absolute world coordinates, normalized coordinates inside a node, or semantic node anchors. Prefer node-relative geometry for screenshot annotations so annotations follow the screenshot when it moves or resizes.

Arrange generated nodes with \`canvas.layout.stack\`, \`row\`, \`grid\`, \`columns\`, \`overlay\`, and \`inset\`. Use the built-in homogeneous compositions \`annotatedScreenshot\`, \`beforeAfter\`/\`comparison\`, \`numberedCallouts\`, \`issueSection\`, \`specTable\`, \`acceptanceChecklist\`, and \`stepFlow\` before inventing a new visual grammar.

## Golden issue-evidence example

\`\`\`js
canvas.composition.issueSection({
  id: "checkout-validation-issue",
  title: "Validation message overlaps the payment controls",
  rect: { x: 80, y: 100, w: 1420, h: 720 },
  screenshot: {
    id: "checkout-error",
    src: "/assets/checkout-error.png",
    alt: "Checkout form showing a validation defect",
    title: "Checkout · current behavior",
  },
  annotations: [
    { kind: "highlight", bounds: canvas.bounds("checkout-error", 0.46, 0.61, 0.48, 0.18) },
    { kind: "arrow", from: canvas.worldPoint(1120, 430), to: canvas.anchor("checkout-error", "right", 0.7) },
    { kind: "callout", at: canvas.worldPoint(1190, 380), text: "Error covers the card fields", number: 1 },
  ],
  acceptance: ["Message remains below the field", "Submit stays visible at 1280 px"],
});

canvas.composition.beforeAfter({
  id: "checkout-comparison",
  title: "Expected correction",
  rect: { x: 80, y: 880, w: 1420, h: 620 },
  before: { src: "/assets/checkout-before.png", alt: "Checkout before correction", title: "Before" },
  after: { id: "checkout-after", src: "/assets/checkout-after.png", alt: "Checkout after correction", title: "After" },
});
canvas.composition.numberedCallouts({
  target: "checkout-after",
  items: [
    { x: 0.54, y: 0.64, text: "Message has its own row" },
    { x: 0.82, y: 0.88, text: "Submit remains visible" },
  ],
});
canvas.composition.specTable({
  id: "checkout-spec",
  title: "Responsive behavior",
  rect: { x: 80, y: 1560, w: 680, h: 300 },
  columns: ["Viewport", "Expected"],
  rows: [["1280 px", "No overlap"], ["768 px", "Controls stack"]],
});
canvas.composition.acceptanceChecklist({
  id: "checkout-acceptance",
  rect: { x: 800, y: 1560, w: 700, h: 300 },
  items: ["Validation stays below its field", "Keyboard focus remains visible"],
});

await Promise.resolve(); // ordinary top-level await
canvas.commit();
\`\`\`

After committing, snapshot the smallest group, stage, node, or region that tells the story. Enable public sharing once, then run \`canvas_checkpoint\` after meaningful changes before calling \`canvas_embed\`; paste its linked Markdown into GitHub, Linear, Notion, or Slack. Canvas owns the visual evidence, while the tracker integration owns issue creation.`,
  },
  {
    id: "embeds",
    title: "Public PNG embeds",
    description: "Published-only node, region, and canvas images for trackers and documents.",
    text: `# Public PNG embeds

Use \`canvas_embed\` when another system needs an image URL or ready-to-paste Markdown without PNG bytes in the MCP conversation. It supports a complete native/HTML canvas and native canvas nodes, groups, stages, or regions. Every returned image and target URL uses \`canvas.iota.uz\`.

For an iframe or image node, use \`clip: "content"\` to capture only its inner viewport. Device/browser chrome, the canvas caption, and default outer padding are excluded while the authored content aspect ratio is preserved. The default \`clip: "frame"\` keeps the complete node presentation. Content clipping is intentionally node-only; canvas, group, stage, region, and native-content targets reject it.

Embeds expose only immutable published checkpoints. An unpublished draft never changes public image bytes; the tool reports \`unpublished_changes\` until the next \`canvas_checkpoint\`. On an already-public canvas, checkpointing advances the published share/embed revision. By default \`pin_version=false\`, so the stable URL resolves the newest published checkpoint and re-renders after a later checkpoint. Set \`pin_version=true\` only when the external record must preserve the exact historical image.

Public sharing is mandatory. \`canvas_not_shared\` means sharing must be enabled before a usable URL can be returned. Revoking or replacing the share slug makes every old endpoint request return 404 even when its PNG remains in the embed cache. Public PNGs are capped at 4 MiB and may be downscaled automatically.`,
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
