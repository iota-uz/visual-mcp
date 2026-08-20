/**
 * Shared domain types + zod schemas for the Visual Runtime MCP Server.
 *
 * This is the single shared types module for the whole project (see PLAN.md
 * section 13). All other modules under /src (server, sandbox, render/*,
 * templates) import from here — do not fork a second types file.
 *
 * Import convention (NodeNext ESM resolution): always import with the
 * explicit `.js` extension even though this source file is `.ts`, e.g.:
 *
 *   import type { Artifact, ArtifactManifest } from "../types.js";
 *   import { RenderFileInputSchema } from "../types.js";
 *
 * Zod schemas (`*Schema`) are the runtime-validated source of truth for MCP
 * tool inputs; the corresponding TS types are inferred from them via
 * `z.infer<...>` so the two never drift. Domain types that are not MCP tool
 * I/O (Session, Artifact, ArtifactManifest, Theme, Template) are plain
 * `interface` declarations — construct/validate them in the owning module
 * (sandbox, artifact-store, themes, templates respectively).
 */

import { z } from "zod";

/* ------------------------------------------------------------------------
 * Session (PLAN.md section 2.2, 7)
 * ---------------------------------------------------------------------- */

/**
 * A single isolated sandbox workspace. One session may produce many
 * artifacts (see Artifact / ArtifactManifest below).
 */
export interface Session {
  /** Unique session identifier, e.g. "sess_123". */
  session_id: string;
  /** Absolute path to the session's isolated workspace directory on disk. */
  workspace: string;
  /** ISO-8601 timestamp of session creation. */
  created_at: string;
}

/* ------------------------------------------------------------------------
 * Artifact + manifest (PLAN.md section 12)
 * ---------------------------------------------------------------------- */

export type ArtifactType = "pdf" | "image" | "svg" | "source";

export type ArtifactRole = "primary" | "supporting";

export interface Artifact {
  /** Path relative to the session workspace, e.g. "/output/report.pdf". */
  path: string;
  type: ArtifactType;
  role: ArtifactRole;
}

export interface ArtifactManifest {
  session_id: string;
  /** Path of the primary artifact (matches an entry in `artifacts`). */
  primary: string | null;
  artifacts: Artifact[];
  /** ISO-8601 timestamp of manifest generation/update. */
  created_at: string;
}

/* ------------------------------------------------------------------------
 * Theme contract (PLAN.md section 11)
 * ---------------------------------------------------------------------- */

export interface ThemeColors {
  background: string;
  foreground: string;
  muted: string;
  primary: string;
  secondary: string;
  border: string;
}

export interface ThemeTypography {
  fontSans: string;
  fontMono: string;
}

export interface ThemeRadius {
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

export interface ThemeDiagramStyle {
  nodeRadius: string;
  edgeStyle: string;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  typography: ThemeTypography;
  radius: ThemeRadius;
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  chartPalette: string[];
  diagramStyle: ThemeDiagramStyle;
}

/** Initial theme names (PLAN.md section 11) — for reference/typing only. */
export const THEME_NAMES = [
  "clean-saas",
  "minimal-docs",
  "dark-terminal",
  "startup-pitch",
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/* ------------------------------------------------------------------------
 * Template contract (PLAN.md section 10)
 * ---------------------------------------------------------------------- */

export type TemplateKind = "canvas" | "diagram" | "mockup" | "report" | "chart" | "infographic";

export interface Template {
  id: string;
  name: string;
  kind: TemplateKind;
  description: string;
  expectedInputs: Record<string, unknown>;
  exampleCode: string;
}

/** Template ids called out in PLAN.md section 10 — for reference only. */
export const TEMPLATE_IDS = [
  "architecture-overview",
  "sequence-flow",
  "mobile-app-screen",
  "phone-frame-screen",
  "browser-app-screen",
  "dashboard-overview",
  "one-page-infographic",
  "multipage-report",
  "chart-report",
  "iframe-service-flow",
  "image-reference-board",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/* ------------------------------------------------------------------------
 * MCP tool: create_visual_session (PLAN.md section 6.1)
 * ---------------------------------------------------------------------- */

export const SessionTemplateNameSchema = z.enum([
  "blank",
  "mockup",
  "diagram",
  "infographic",
  "report",
]);
export type SessionTemplateName = z.infer<typeof SessionTemplateNameSchema>;

export const CreateVisualSessionInputSchema = z.object({
  runtime: z.literal("node"),
  template: SessionTemplateNameSchema.optional(),
});
export type CreateVisualSessionInput = z.infer<typeof CreateVisualSessionInputSchema>;

export interface CreateVisualSessionOutput {
  session_id: string;
  workspace: string;
}

/* ------------------------------------------------------------------------
 * MCP tool: run_code (PLAN.md section 6.2)
 * ---------------------------------------------------------------------- */

export const RunCodeInputSchema = z.object({
  session_id: z.string(),
  code: z.string(),
});
export type RunCodeInput = z.infer<typeof RunCodeInputSchema>;

export interface RunCodeOutput {
  success: boolean;
  stdout: string;
  stderr: string;
  /** Present when `success` is false. */
  error?: string;
}

/* ------------------------------------------------------------------------
 * MCP tool: write_file (PLAN.md section 6.3)
 * ---------------------------------------------------------------------- */

export const WriteFileInputSchema = z.object({
  session_id: z.string(),
  path: z.string(),
  content: z.string(),
});
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>;

export interface WriteFileOutput {
  path: string;
  bytes_written: number;
}

/* ------------------------------------------------------------------------
 * MCP tool: render_file (PLAN.md section 6.4)
 * ---------------------------------------------------------------------- */

export const RenderFormatSchema = z.enum(["png", "svg", "pdf", "html"]);
export type RenderFormat = z.infer<typeof RenderFormatSchema>;

export const ViewportOptionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  deviceScaleFactor: z.number().positive().optional(),
});
export type ViewportOptions = z.infer<typeof ViewportOptionsSchema>;

export const PdfPageFormatSchema = z.enum(["A4", "A3", "Letter"]);
export type PdfPageFormat = z.infer<typeof PdfPageFormatSchema>;

export const PdfOrientationSchema = z.enum(["portrait", "landscape"]);
export type PdfOrientation = z.infer<typeof PdfOrientationSchema>;

/** Maps closely to Playwright's `page.pdf()` options (PLAN.md section 5, 8.2). */
export const PdfOptionsSchema = z.object({
  format: PdfPageFormatSchema.optional(),
  orientation: PdfOrientationSchema.optional(),
  printBackground: z.boolean().optional(),
  displayHeaderFooter: z.boolean().optional(),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  margin: z
    .object({
      top: z.string().optional(),
      right: z.string().optional(),
      bottom: z.string().optional(),
      left: z.string().optional(),
    })
    .optional(),
});
export type PdfOptions = z.infer<typeof PdfOptionsSchema>;

export const RenderFileInputSchema = z.object({
  session_id: z.string(),
  entrypoint: z.string(),
  output_path: z.string(),
  format: RenderFormatSchema,
  viewport: ViewportOptionsSchema.optional(),
  pdf: PdfOptionsSchema.optional(),
});
export type RenderFileInput = z.infer<typeof RenderFileInputSchema>;

export interface RenderFileOutput {
  artifact: Artifact;
}

/* ------------------------------------------------------------------------
 * MCP tool: list_artifacts (PLAN.md section 6.5, 12)
 * ---------------------------------------------------------------------- */

export const ListArtifactsInputSchema = z.object({
  session_id: z.string(),
});
export type ListArtifactsInput = z.infer<typeof ListArtifactsInputSchema>;

/**
 * NOTE: PLAN.md section 6.5's example response shows `artifacts` as bare
 * path strings, but section 12's manifest shape (path/type/role objects) is
 * strictly more useful and is what the artifact-store persists to
 * manifest.json. We standardize list_artifacts' output on the richer
 * ArtifactManifest shape so callers get type/role without a second lookup.
 */
export type ListArtifactsOutput = ArtifactManifest;

/* ------------------------------------------------------------------------
 * MCP tool: export_artifact (PLAN.md section 6.6)
 * ---------------------------------------------------------------------- */

export const ExportArtifactInputSchema = z.object({
  session_id: z.string(),
  path: z.string(),
});
export type ExportArtifactInput = z.infer<typeof ExportArtifactInputSchema>;

export interface ExportArtifactOutput {
  artifact: Artifact;
  /** Absolute filesystem path the MCP server read the bytes from. */
  absolute_path: string;
  /** MIME type inferred from `artifact.type` / file extension. */
  mime_type: string;
}

/* ------------------------------------------------------------------------
 * MCP tool: list_templates (PLAN.md section 6.7)
 * ---------------------------------------------------------------------- */

export const ListTemplatesInputSchema = z.object({
  kind: z.enum(["mockup", "diagram", "report", "infographic", "chart"]).optional(),
});
export type ListTemplatesInput = z.infer<typeof ListTemplatesInputSchema>;

export interface ListTemplatesOutput {
  templates: Template[];
}
