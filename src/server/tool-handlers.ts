/**
 * Pure(ish) implementations of the 7 MCP tools from PLAN.md section 6.
 *
 * Kept separate from index.ts (the `@modelcontextprotocol/sdk` wiring) so:
 *   - the routing/business logic can be unit/integration tested by calling
 *     these functions directly (see test/server.test.ts), without spinning
 *     up a real stdio MCP transport;
 *   - index.ts stays a thin adapter: zod-validate -> call handler -> map
 *     result/error to a CallToolResult.
 *
 * Handlers throw on failure (UnknownSessionError, SandboxPathError,
 * PathTraversalError, ArtifactNotFoundError, D2RenderError, or a plain
 * Error from the Playwright renderer / D2 compiler) — index.ts is
 * responsible for catching and mapping via errors.ts. Tests that want to
 * assert on a specific failure mode can also just `await assert.rejects(...)`
 * directly against these functions.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  Artifact,
  ArtifactType,
  CreateVisualSessionInput,
  CreateVisualSessionOutput,
  ExportArtifactInput,
  ExportArtifactOutput,
  ListArtifactsInput,
  ListArtifactsOutput,
  ListTemplatesInput,
  ListTemplatesOutput,
  RenderFileInput,
  RenderFileOutput,
  RenderFormat,
  RunCodeInput,
  RunCodeOutput,
  SessionTemplateName,
  TemplateKind,
  WriteFileInput,
  WriteFileOutput,
} from "../types.js";

import {
  createSessionWorkspace,
  generateSessionId,
  resolveWorkspacePath,
  runCode as sandboxRunCode,
  toWorkspaceDisplayPath,
  writeFile as sandboxWriteFile,
} from "../sandbox/index.js";

import { renderD2ToSvg } from "../render/diagrams/index.js";
import { ensureApexChartsAsset } from "../render/charts/index.js";
import { renderFile as renderFileWithPlaywright } from "../render/playwright-renderer/index.js";
import {
  exportArtifact as artifactStoreExport,
  getManifest,
  listArtifacts as artifactStoreList,
  registerArtifact,
} from "../render/artifact-store/index.js";
import { getTemplate, listTemplates as templateRegistryList } from "../templates/index.js";

import { SessionStore } from "./session-store.js";
import { resolveRenderOutputPath } from "./render-output-path.js";

export interface ToolContext {
  sessions: SessionStore;
}

/* ------------------------------------------------------------------------
 * 6.1 create_visual_session
 * ---------------------------------------------------------------------- */

/**
 * Session-template-name -> template-registry-kind mapping. "blank" seeds
 * nothing; the other four names line up 1:1 with `TemplateKind` values
 * (the registry additionally has a "chart" kind, which is not reachable
 * from `create_visual_session`'s `template` param — PLAN.md 6.1 only lists
 * blank/mockup/diagram/infographic/report).
 */
function templateKindFor(name: SessionTemplateName): TemplateKind | null {
  if (name === "blank") return null;
  return name;
}

/**
 * Seeds a freshly-created session's `/src` with the first registered
 * template matching `template`'s kind (design choice documented in the
 * hand-off: "pick the first template of that kind"). No-op for "blank" or
 * if the registry has no template of that kind. Diagram templates are D2
 * source (written as `<id>.d2`); everything else is HTML+Tailwind
 * (written as `<id>.html`).
 */
function seedSessionFromTemplate(
  session: ReturnType<typeof createSessionWorkspace>,
  templateName: SessionTemplateName,
): void {
  const kind = templateKindFor(templateName);
  if (!kind) return;

  const template = templateRegistryList(kind)[0];
  if (!template) return;

  const filename = kind === "diagram" ? `${template.id}.d2` : `${template.id}.html`;
  sandboxWriteFile(session, `/src/${filename}`, template.exampleCode);
}

export async function createVisualSession(
  input: CreateVisualSessionInput,
  ctx: ToolContext,
): Promise<CreateVisualSessionOutput> {
  const sessionId = generateSessionId();
  const session = createSessionWorkspace(sessionId, input.template);

  // Vendor the ApexCharts bundle up front so authored HTML can load
  // `/assets/js/apexcharts.min.js` immediately, without a lazy first-render
  // penalty (PLAN.md section 3.3).
  await ensureApexChartsAsset(session.workspace);

  if (input.template) {
    seedSessionFromTemplate(session, input.template);
  }

  ctx.sessions.add(session);

  return { session_id: session.session_id, workspace: session.workspace };
}

/* ------------------------------------------------------------------------
 * 6.2 run_code
 * ---------------------------------------------------------------------- */

export async function runCode(input: RunCodeInput, ctx: ToolContext): Promise<RunCodeOutput> {
  const session = ctx.sessions.get(input.session_id);
  return sandboxRunCode(session, input.code);
}

/* ------------------------------------------------------------------------
 * 6.3 write_file
 * ---------------------------------------------------------------------- */

export function writeFile(input: WriteFileInput, ctx: ToolContext): WriteFileOutput {
  const session = ctx.sessions.get(input.session_id);
  return sandboxWriteFile(session, input.path, input.content);
}

/* ------------------------------------------------------------------------
 * 6.4 render_file
 * ---------------------------------------------------------------------- */

const ARTIFACT_TYPE_BY_FORMAT: Record<RenderFormat, ArtifactType> = {
  png: "image",
  svg: "svg",
  pdf: "pdf",
  html: "source",
};

function isD2Entrypoint(entrypoint: string): boolean {
  return entrypoint.toLowerCase().endsWith(".d2");
}

export async function renderFile(
  input: RenderFileInput,
  ctx: ToolContext,
): Promise<RenderFileOutput> {
  const session = ctx.sessions.get(input.session_id);

  // Entrypoints may live anywhere in the workspace (src, cache, output —
  // e.g. re-rendering a previously-rendered HTML report), so this uses
  // "read" mode confinement (whole workspace), not write_file's /src+/output
  // restriction.
  const absEntrypoint = resolveWorkspacePath(session.workspace, input.entrypoint, "read");
  const { absolutePath: absOutput, topDir } = resolveRenderOutputPath(
    session.workspace,
    input.output_path,
  );

  let artifactType: ArtifactType;

  if (isD2Entrypoint(input.entrypoint) && input.format === "svg") {
    // D2 -> SVG is handled directly by the diagrams module: Playwright has
    // no SVG export primitive for HTML (see playwright-renderer's explicit
    // rejection of format:"svg"), and D2 source isn't HTML the browser can
    // navigate to anyway.
    const source = fs.readFileSync(absEntrypoint, "utf8");
    const svg = await renderD2ToSvg(source);
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });
    fs.writeFileSync(absOutput, svg, "utf8");
    artifactType = "svg";
  } else {
    // Every other entrypoint/format combination (html->png, html->pdf,
    // html->html — and any invalid combination, e.g. a .d2 entrypoint with
    // format png/pdf/html, or an .html entrypoint with format svg) is
    // delegated to the Playwright renderer, which validates the entrypoint
    // extension and rejects format:"svg" for HTML itself with a clear error.
    await renderFileWithPlaywright({
      entrypoint: absEntrypoint,
      outputPath: absOutput,
      format: input.format,
      viewport: input.viewport,
      pdf: input.pdf,
      workspaceRoot: session.workspace,
    });
    artifactType = ARTIFACT_TYPE_BY_FORMAT[input.format];
  }

  const displayPath = toWorkspaceDisplayPath(session.workspace, absOutput);

  if (topDir === "output") {
    // Only /output renders are tracked in the artifact manifest — /cache
    // renders are scratch intermediates (PLAN.md section 15's
    // architecture.svg-before-the-final-PDF pattern) that export_artifact
    // could never serve anyway (it's confined to /output).
    await registerArtifact(session.session_id, displayPath, artifactType);
    const manifest = await getManifest(session.session_id);
    const artifact = manifest.artifacts.find((a) => a.path === displayPath);
    if (artifact) {
      return { artifact };
    }
  }

  const artifact: Artifact = { path: displayPath, type: artifactType, role: "debug" };
  return { artifact };
}

/* ------------------------------------------------------------------------
 * 6.5 list_artifacts
 * ---------------------------------------------------------------------- */

export async function listArtifacts(
  input: ListArtifactsInput,
  ctx: ToolContext,
): Promise<ListArtifactsOutput> {
  ctx.sessions.get(input.session_id); // validates session_id is known
  return artifactStoreList(input.session_id);
}

/* ------------------------------------------------------------------------
 * 6.6 export_artifact
 * ---------------------------------------------------------------------- */

export interface ExportArtifactResult extends ExportArtifactOutput {
  /** Raw file bytes read from `absolute_path`, for the server layer to encode into a tool result. */
  data: Buffer;
}

export async function exportArtifact(
  input: ExportArtifactInput,
  ctx: ToolContext,
): Promise<ExportArtifactResult> {
  ctx.sessions.get(input.session_id); // validates session_id is known
  const result = await artifactStoreExport(input.session_id, input.path);
  const data = fs.readFileSync(result.absolute_path);
  return { ...result, data };
}

/* ------------------------------------------------------------------------
 * 6.7 list_templates
 * ---------------------------------------------------------------------- */

export function listTemplates(input: ListTemplatesInput): ListTemplatesOutput {
  return { templates: templateRegistryList(input.kind) };
}

export { getTemplate };
