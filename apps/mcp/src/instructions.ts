/** Lean, always-on MCP contract. Detailed guidance is exposed as resources. */
export function buildInstructions(): string {
  return [
    "Visual Canvas turns product intent into production-grade, shareable interfaces, diagrams, dashboards, reports, and mockups.",
    "",
    "WORKFLOW. Read relevant context first: canvas_get for an existing canvas, canvas://templates for canonical examples, canvas://themes for semantic token sets, and canvas://guides/* for detailed contracts. Author with canvas_save, canvas_edit, canvas_apply_patch, canvas_doc_patch, or canvas_patch. Use canvas_patch for one atomic batch spanning Page metadata/order, CanvasDoc entities, and prototype references. After every meaningful visual change, run canvas_snapshot on the smallest changed target, correct defects, and snapshot again. Never stop at an unchecked first draft.",
    "",
    "PRODUCT UI CONTRACT. Produce complete, credible interfaces with clear hierarchy, realistic content, responsive layouts, accessible labels/alt text, familiar controls, and required loading, empty, error, success, disabled, and overflow states. Use the selected semantic theme and workspace brand. Avoid internal instructions or metadata in user-facing UI, generic AI-copy, decorative blobs, gratuitous pills, cards nested inside cards, hardcoded palette drift, duplicate device chrome, clipped content, unresolved assets, and empty interactions.",
    "",
    "ADDRESSING AND WRITES. Pass one stable ref (prefer workspace/canvas), or an unchanged canvas:// element ref. canvas_save is idempotent by ref; other writes describe their retry and conflict semantics. canvas_get returns one opaque state token for canvas_patch; pass it unchanged as base. Other guarded writes use returned version, draft revision, and file hashes. A partial save means content persisted but an operational step failed; inspect warnings. Do not invent quality_status and do not expect automatic snapshots.",
    "",
    "CANVAS AUTHORING. Send generated HTML directly: canvas_save({ref,html}) or screens:[{id,html}]. Shared html plus screens:[{id,route}] avoids repeating an app shell. Paths and layout are automatic; shorthand replaces pages/prototype. Use canvas_edit for incremental source edits. Do not stage generated HTML on local disk or use shell/uploads to author it. For custom geometry, doc is CanvasFile v3 with Pages of CanvasDoc v2 and a prototype. Canvas owns device chrome. Use page/prototype/node tools for semantic edits; canvas_run provides programmatic drawing (canvas://guides/programmable-drawing).",
    "",
    "FILES AND ASSETS. files[].text writes source directly under /src, /assets, or /output. Media saved under /assets automatically becomes reusable workspace media; canvas_save returns asset_ref. Reuse media with asset_ref. /src source and /output artifacts remain canvas-local. Upload URLs are for existing files/media. Preserve trusted workspace SVG as authored. Audio is unsupported.",
    "",
    "DELIVERY. Use returned URLs; never construct them. canvas_embed returns canvas.iota.uz PNG Markdown from published content and updates after canvas_checkpoint on a public canvas unless pinned. For iframe/image nodes, clip=content captures the inner viewport without chrome; frame is default. Return share_url only when public sharing was requested. Read canvas://guides/embeds when relevant.",
  ].join("\n");
}
