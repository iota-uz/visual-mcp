/** Lean, always-on MCP contract. Detailed guidance is exposed as resources. */
export function buildInstructions(): string {
  return [
    "Visual Canvas turns product intent into production-grade, shareable interfaces, diagrams, dashboards, reports, and mockups.",
    "",
    "WORKFLOW. Read relevant context first: canvas_get for an existing canvas, canvas://templates for canonical examples, canvas://themes for semantic token sets, and canvas://guides/* for detailed contracts. Author with canvas_save, canvas_edit, canvas_apply_patch, or canvas_doc_patch. After every meaningful visual change, follow the returned targeted canvas_snapshot recommendation, inspect the saved draft_revision, correct defects, and snapshot again. Never stop at an unchecked first draft.",
    "",
    "PRODUCT UI CONTRACT. Produce complete, credible interfaces with clear hierarchy, realistic content, responsive layouts, accessible labels/alt text, familiar controls, and required loading, empty, error, success, disabled, and overflow states. Use the selected semantic theme and workspace brand. Avoid internal instructions or metadata in user-facing UI, generic AI-copy, decorative blobs, gratuitous pills, cards nested inside cards, hardcoded palette drift, duplicate device chrome, clipped content, unresolved assets, and empty interactions.",
    "",
    "ADDRESSING AND WRITES. Pass one stable ref (prefer workspace/canvas), or an unchanged canvas:// element ref. canvas_save is idempotent by ref; other writes describe their retry and conflict semantics. Read before editing and pass returned expected_version, expected_draft_revision, and hashes. A partial save means content persisted but an operational step failed; inspect warnings. Recommendations are non-blocking quality feedback and ready-to-call next actions. Do not invent quality_status and do not expect automatic snapshots.",
    "",
    "CANVAS AUTHORING. kind=canvas uses CanvasFile v3: ordered Pages containing CanvasDoc v2 worlds plus a canvas-level prototype. Iframe entrypoints are local HTML under /src/screens; images use /assets or /src and require alt text. The canvas owns phone/device/browser chrome, so iframe HTML contains screen content only. Use canvas_page_* and canvas_prototype_* for their respective structures, and typed node/group operations for semantic edits.",
    "",
    "FILES AND ASSETS. Writable roots are /src, /assets, and /output. Use root-relative asset paths. Keep large bytes out of JSON: request upload URLs and pass upload_id. The Asset Library is separate reusable media; attach immutable asset refs into /assets. SVG is trusted workspace content and is preserved as authored. Audio is unsupported.",
    "",
    "DELIVERY. Use returned canvas_url/present_url/share_url; never construct them. Publishing checkpoints the complete draft. Hand the user share_url only when public sharing was requested. Read canvas://guides/authoring, production-ui, device-frames, or assets when that topic becomes relevant.",
  ].join("\n");
}
