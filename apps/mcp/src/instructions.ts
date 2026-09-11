/** Lean, always-on MCP contract. Detailed guidance is exposed as resources. */
export function buildInstructions(): string {
  return [
    "Visual Canvas is one workspace for production-grade interfaces, diagrams, reports and Video Studio. Canvas, video, assets, comments, jobs and resources share this MCP connection.",
    "",
    "ROUTING. Use canvas_* for interfaces/documents; video_* for durable video projects and language-scoped brief/script/timeline documents. Read canvas_get or video_project_get and the relevant document before editing. Discover examples and schemas through canvas://templates, canvas://themes, canvas://guides/* and resource_find/resource_get. Use shared asset_* and job_* tools for both domains. execute composes published tools with workspace guards; nested execute/canvas_run is forbidden.",
    "",
    "CANVAS. Send HTML directly with canvas_save({ref,html}) or screens:[{id,html}]; shared html plus screens:[{id,route}] avoids repeating app shells. Shorthand replaces pages/prototype. Do not stage generated HTML on local disk. Use canvas_edit for source edits, canvas_patch for atomic Page/CanvasDoc/prototype batches, or canvas_run for programmatic drawing. After meaningful visual changes, canvas_snapshot the smallest changed target, correct defects, and snapshot again.",
    "",
    "QUALITY. Deliver complete interfaces with hierarchy, realistic content, responsive layouts, accessible labels and loading, empty, error, success, disabled and overflow states. Follow workspace brand and semantic themes. Avoid internal instructions or metadata in user-facing UI, duplicate device chrome, clipping, unresolved assets and empty interactions.",
    "",
    "WRITES. Canvas uses stable refs and opaque canvas_get state tokens for canvas_patch base; other guards use returned versions/revisions/hashes. Video patches require the exact read revision and IDs; nested documents use camelCase, transport references snake_case. Reread/recompute on conflicts. canvas_save is idempotent by ref; partial means content persisted: inspect warnings. Reconcile unknown outcomes with returned receipts, never a new idempotency key.",
    "",
    "VIDEO. Checkpoints pin inputs; draft preview, rendered MP4 and human approval are distinct. Review exact rendered media. Critic passes and candidate selection never grant human approval. Paid producers require explicit allowPaid; poll job_get and reconcile receipts instead of blindly resubmitting. Respect pause and bounded iteration limits.",
    "",
    "ASSETS. Media saved under /assets automatically becomes reusable workspace media; reuse returned asset_ref. /src source and /output artifacts remain canvas-local. Upload URLs are for existing media/files. Preserve trusted SVG. Shared assets accept image, video and audio with validated MIME/size/metadata.",
    "",
    "DELIVERY. Use returned URLs, never construct them. canvas_embed returns canvas.iota.uz PNG Markdown from published content; read canvas://guides/embeds. Share publicly only when requested. For snapshots, clip=content excludes device chrome; frame is default.",
  ].join("\n");
}
