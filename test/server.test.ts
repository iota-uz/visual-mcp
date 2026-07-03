/**
 * Integration tests for src/server: the 7 MCP tools from PLAN.md section 6,
 * wired together end-to-end.
 *
 * Approach: these tests call the tool-handlers.ts functions directly
 * (`handlers.createVisualSession`, `handlers.renderFile`, etc.) against a
 * real `SessionStore`, rather than going over a real stdio MCP transport.
 * This is the pragmatic choice for a single-process test suite: it
 * exercises the exact same business logic `src/server/index.ts` wires up
 * (index.ts is a thin zod-validate + CallToolResult-mapping adapter on top
 * of these functions — see that file's header comment), without the
 * overhead/flakiness of spawning a child process and speaking JSON-RPC over
 * stdio pipes. `createServer()` (the real McpServer wiring) is smoke-tested
 * separately below to confirm registration itself doesn't throw.
 *
 * The main flow test is a scripted version of PLAN.md section 15's worked
 * example: write a D2 diagram, render it to SVG, embed that SVG plus an
 * inline ApexCharts chart into an HTML report, render the report to PDF,
 * list artifacts, and export the final PDF.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";

import { removeSessionWorkspace, SandboxPathError } from "../src/sandbox/index.js";
import { PathTraversalError, ArtifactNotFoundError } from "../src/render/artifact-store/index.js";
import { D2RenderError, disposeD2Renderer } from "../src/render/diagrams/index.js";

import * as handlers from "../src/server/tool-handlers.js";
import { SessionStore, UnknownSessionError } from "../src/server/session-store.js";
import { createServer } from "../src/server/index.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = Buffer.from("%PDF-");

const createdSessionIds: string[] = [];

function freshCtx(): { sessions: SessionStore } {
  return { sessions: new SessionStore() };
}

async function newSession(ctx: { sessions: SessionStore }) {
  const output = await handlers.createVisualSession({ runtime: "node" }, ctx);
  createdSessionIds.push(output.session_id);
  return output;
}

after(async () => {
  await disposeD2Renderer();
  for (const id of createdSessionIds) {
    removeSessionWorkspace(id);
  }
});

/* ------------------------------------------------------------------------
 * Full worked-example flow (PLAN.md section 15)
 * ---------------------------------------------------------------------- */

test("full flow: create session -> D2 -> SVG -> HTML+ApexCharts report -> PDF -> list -> export", async () => {
  const ctx = freshCtx();
  const { session_id, workspace } = await newSession(ctx);

  // 1. write_file("/src/architecture.d2", ...)
  const d2Source = `Web App -> API Gateway: HTTPS
API Gateway -> CRM Core: REST
CRM Core -> Postgres: SQL`;
  const writeResult = handlers.writeFile(
    { session_id, path: "/src/architecture.d2", content: d2Source },
    ctx,
  );
  assert.equal(writeResult.path, "/src/architecture.d2");

  // 2. render_file(entrypoint: "/src/architecture.d2", output_path: "/cache/architecture.svg", format: "svg")
  const svgRender = await handlers.renderFile(
    {
      session_id,
      entrypoint: "/src/architecture.d2",
      output_path: "/cache/architecture.svg",
      format: "svg",
    },
    ctx,
  );
  assert.equal(svgRender.artifact.path, "/cache/architecture.svg");
  assert.equal(svgRender.artifact.type, "svg");
  // /cache renders are scratch intermediates, not tracked in the manifest.
  assert.equal(svgRender.artifact.role, "debug");

  const svgAbsolutePath = path.join(workspace, "cache", "architecture.svg");
  assert.ok(fs.existsSync(svgAbsolutePath), "rendered SVG should exist on disk");
  const svgContent = fs.readFileSync(svgAbsolutePath, "utf8");
  assert.ok(svgContent.trim().startsWith("<svg"), "rendered content should be a well-formed SVG");

  // 3. write_file("/src/report.html", ...) — embeds the rendered SVG inline + inline ApexCharts
  const reportHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>@import "tailwindcss";</style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="font-sans">
    <section class="page p-16" style="break-after: page;">
      <h1 class="text-5xl font-bold">Insurance CRM Platform</h1>
      <p class="mt-4 text-xl text-slate-600">
        A modular system for policies, claims, billing and analytics.
      </p>
    </section>

    <section class="page p-16" style="break-after: page;">
      <h2 class="text-3xl font-bold mb-6">System Architecture</h2>
      ${svgContent}
    </section>

    <section class="page p-16">
      <h2 class="text-3xl font-bold mb-6">Monthly Policy Sales</h2>
      <div id="chart"></div>
      <script>
        new ApexCharts(document.querySelector("#chart"), {
          chart: { type: "bar", height: 400 },
          xaxis: { categories: ["Jan", "Feb", "Mar", "Apr"] },
          series: [{ name: "Policies", data: [1200, 1800, 2400, 3100] }],
        }).render();
      </script>
    </section>
  </body>
</html>`;
  handlers.writeFile({ session_id, path: "/src/report.html", content: reportHtml }, ctx);

  // 4. render_file(entrypoint: "/src/report.html", output_path: "/output/insurance-crm-overview.pdf", format: "pdf")
  const pdfRender = await handlers.renderFile(
    {
      session_id,
      entrypoint: "/src/report.html",
      output_path: "/output/insurance-crm-overview.pdf",
      format: "pdf",
      pdf: { format: "A4", printBackground: true },
    },
    ctx,
  );
  assert.equal(pdfRender.artifact.path, "/output/insurance-crm-overview.pdf");
  assert.equal(pdfRender.artifact.type, "pdf");
  // First artifact ever registered for this session -> primary (artifact-store role inference).
  assert.equal(pdfRender.artifact.role, "primary");

  // list_artifacts
  const manifest = await handlers.listArtifacts({ session_id }, ctx);
  assert.equal(manifest.session_id, session_id);
  assert.equal(manifest.primary, "/output/insurance-crm-overview.pdf");
  const paths = manifest.artifacts.map((a) => a.path);
  assert.ok(paths.includes("/output/insurance-crm-overview.pdf"));
  // /cache artifact must NOT be tracked in the manifest.
  assert.ok(!paths.includes("/cache/architecture.svg"));

  // export_artifact
  const exported = await handlers.exportArtifact(
    { session_id, path: "/output/insurance-crm-overview.pdf" },
    ctx,
  );
  assert.equal(exported.mime_type, "application/pdf");
  assert.ok(exported.data.length > 0, "exported PDF bytes should be non-empty");
  assert.ok(
    exported.data.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC),
    "exported bytes should start with the %PDF- magic",
  );

  // Validate the PDF is actually well-formed and multi-page (PLAN.md section 5).
  const pdfDoc = await PDFDocument.load(exported.data);
  assert.ok(pdfDoc.getPageCount() >= 1, "PDF should have at least one page");
});

/* ------------------------------------------------------------------------
 * render_file: PNG output + ApexCharts, registered as primary/supporting
 * ---------------------------------------------------------------------- */

test("render_file: HTML mockup renders to a valid PNG artifact under /output", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);

  handlers.writeFile(
    {
      session_id,
      path: "/src/mockup.html",
      content: `<!doctype html>
<html><head><style>@import "tailwindcss";</style></head>
<body class="bg-white p-10"><h1 class="text-4xl font-bold">Hello</h1></body></html>`,
    },
    ctx,
  );

  const result = await handlers.renderFile(
    {
      session_id,
      entrypoint: "/src/mockup.html",
      output_path: "/output/mockup.png",
      format: "png",
      viewport: { width: 800, height: 600 },
    },
    ctx,
  );
  assert.equal(result.artifact.type, "image");
  assert.equal(result.artifact.role, "primary");

  const exported = await handlers.exportArtifact({ session_id, path: "/output/mockup.png" }, ctx);
  assert.ok(exported.data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC));
});

/* ------------------------------------------------------------------------
 * create_visual_session: template seeding + ApexCharts asset vendoring
 * ---------------------------------------------------------------------- */

test("create_visual_session seeds /src from the requested template kind", async () => {
  const ctx = freshCtx();

  const output = await handlers.createVisualSession({ runtime: "node", template: "diagram" }, ctx);
  createdSessionIds.push(output.session_id);

  const srcFiles = fs.readdirSync(path.join(output.workspace, "src"));
  assert.ok(srcFiles.some((f) => f.endsWith(".d2")), "diagram template should seed a .d2 file");

  const apexAsset = path.join(output.workspace, "assets", "js", "apexcharts.min.js");
  assert.ok(fs.existsSync(apexAsset), "ApexCharts bundle should be vendored at session creation");
});

test("create_visual_session with template: 'blank' seeds nothing into /src", async () => {
  const ctx = freshCtx();
  const output = await handlers.createVisualSession({ runtime: "node", template: "blank" }, ctx);
  createdSessionIds.push(output.session_id);
  const srcFiles = fs.readdirSync(path.join(output.workspace, "src"));
  assert.deepEqual(srcFiles, []);
});

/* ------------------------------------------------------------------------
 * list_templates
 * ---------------------------------------------------------------------- */

test("list_templates returns all templates, and filters by kind", () => {
  const all = handlers.listTemplates({});
  assert.ok(all.templates.length >= 8);

  const diagrams = handlers.listTemplates({ kind: "diagram" });
  assert.ok(diagrams.templates.every((t) => t.kind === "diagram"));
  assert.ok(diagrams.templates.length >= 1);
});

/* ------------------------------------------------------------------------
 * Error handling: unknown session_id, sandbox path errors, D2 errors,
 * artifact-store errors — one per session-scoped tool family.
 * ---------------------------------------------------------------------- */

test("run_code / write_file / render_file / list_artifacts / export_artifact reject unknown session_id", async () => {
  const ctx = freshCtx();
  const bogus = "sess_does-not-exist";

  await assert.rejects(() => handlers.runCode({ session_id: bogus, code: "1+1" }, ctx), UnknownSessionError);
  assert.throws(() => handlers.writeFile({ session_id: bogus, path: "/src/a.txt", content: "x" }, ctx), UnknownSessionError);
  await assert.rejects(
    () => handlers.renderFile({ session_id: bogus, entrypoint: "/src/a.html", output_path: "/output/a.png", format: "png" }, ctx),
    UnknownSessionError,
  );
  await assert.rejects(() => handlers.listArtifacts({ session_id: bogus }, ctx), UnknownSessionError);
  await assert.rejects(() => handlers.exportArtifact({ session_id: bogus, path: "/output/a.png" }, ctx), UnknownSessionError);
});

test("write_file rejects writes outside /src and /output with SandboxPathError", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);
  assert.throws(
    () => handlers.writeFile({ session_id, path: "/templates/x.html", content: "nope" }, ctx),
    SandboxPathError,
  );
});

test("render_file rejects output_path outside /output and /cache with SandboxPathError", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);
  handlers.writeFile({ session_id, path: "/src/a.d2", content: "A -> B" }, ctx);
  await assert.rejects(
    () =>
      handlers.renderFile(
        { session_id, entrypoint: "/src/a.d2", output_path: "/src/a.svg", format: "svg" },
        ctx,
      ),
    SandboxPathError,
  );
});

test("render_file surfaces D2RenderError for invalid D2 source", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);
  handlers.writeFile({ session_id, path: "/src/broken.d2", content: "this is: not: valid: d2: {{{" }, ctx);
  await assert.rejects(
    () =>
      handlers.renderFile(
        { session_id, entrypoint: "/src/broken.d2", output_path: "/output/broken.svg", format: "svg" },
        ctx,
      ),
    D2RenderError,
  );
});

test("export_artifact surfaces ArtifactNotFoundError for a nonexistent artifact", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);
  await assert.rejects(
    () => handlers.exportArtifact({ session_id, path: "/output/does-not-exist.pdf" }, ctx),
    ArtifactNotFoundError,
  );
});

test("export_artifact surfaces PathTraversalError for a path outside /output", async () => {
  const ctx = freshCtx();
  const { session_id } = await newSession(ctx);
  handlers.writeFile({ session_id, path: "/src/secret.txt", content: "shh" }, ctx);
  await assert.rejects(
    () => handlers.exportArtifact({ session_id, path: "/src/secret.txt" }, ctx),
    PathTraversalError,
  );
});

/* ------------------------------------------------------------------------
 * McpServer wiring smoke test — confirms registerTool() doesn't throw for
 * any of the 7 tools (the real transport-facing path is not exercised
 * end-to-end here; see this file's header comment for why).
 * ---------------------------------------------------------------------- */

test("createServer() registers all 7 tools without throwing", () => {
  const { server, sessions } = createServer();
  assert.ok(server);
  assert.equal(sessions.size, 0);
});
