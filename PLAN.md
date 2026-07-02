# Visual Runtime MCP Server — v0.1 Spec

## 1. Цель

Построить MCP-сервер, который дает LLM-агентам безопасный программируемый runtime для генерации визуальных артефактов:

* UI mockup’ы;
* architecture diagrams;
* flowcharts;
* infographics;
* charts;
* многостраничные PDF;
* PNG / SVG / HTML exports.

Главная идея:

```text
MCP = orchestration layer
Node.js sandbox = execution layer
HTML + Tailwind / D2 / ApexCharts = authoring layer
Renderer = deterministic output layer
```

Система не должна быть просто “image generator”. Это должен быть **programmable visual/document runtime for LLMs**.

---

## 2. Core principles

### 2.1 Node.js-only runtime

В v0.1 поддерживается только Node.js sandbox.

Python не входит в MVP.

Причина:

* HTML rendering;
* Tailwind;
* React/SVG;
* Playwright;
* ApexCharts;
* PDF generation;

все естественно живет в JS/TS ecosystem.

---

### 2.2 One session → many artifacts

```text
Session = isolated workspace
Artifact = конкретный output file
Primary artifact = главный результат
```

Пример:

```text
/session_123
  /src
    main.ts
    report.html
  /output
    report.pdf
    architecture.png
    architecture.svg
    chart-1.png
    manifest.json
```

Сессия может создавать несколько артефактов.

---

### 2.3 Visual IR as internal core

Все input-форматы желательно приводить к внутреннему Visual IR, когда это возможно:

```text
D2
HTML
ApexCharts
        ↓
    Visual IR / HTML document
        ↓
 PNG / SVG / PDF
```

Но для raw HTML mode можно рендерить HTML напрямую через Playwright.

---

### 2.4 Tailwind v4-only styling policy

Вся HTML/UI стилизация в runtime должна использовать Tailwind v4.

Allowed:

```text
- Tailwind v4 utilities
- @import "tailwindcss";
- @theme tokens
- CSS variables
- minimal scoped CSS when needed
```

Forbidden by policy:

```text
- Tailwind v3 config assumptions
- tailwind.config.js as primary config
- external CSS frameworks
- CDN CSS
- Bootstrap / Bulma / Material UI CSS
- large custom global CSS
```

Отдельный validator в v0.1 не нужен. Достаточно:

```text
- system instructions for LLM
- examples
- runtime docs
- Tailwind v4 build pipeline
- failed builds as feedback
```

---

## 3. Supported authoring modes

### 3.1 Raw HTML + Tailwind v4

Primary authoring mode для mockup'ов, infographics, dashboards и report pages.

Пример:

```html
<!doctype html>
<html>
  <head>
    <style>
      @import "tailwindcss";

      @theme {
        --font-sans: Inter, sans-serif;
        --color-brand: #2563eb;
      }
    </style>
  </head>
  <body class="m-0 bg-slate-100 font-sans">
    <main class="w-[1200px] h-[800px] p-16">
      <section class="rounded-3xl bg-white p-10 shadow-xl">
        <h1 class="text-5xl font-bold text-slate-950">
          Insurance CRM Platform
        </h1>
        <p class="mt-4 text-xl text-slate-600">
          Policies, claims, billing and reports in one system.
        </p>
      </section>
    </main>
  </body>
</html>
```

Use cases:

```text
- landing page mockups
- dashboard mockups
- report pages
- PDF layouts
- custom infographics
- architecture diagrams and flowcharts (via embedded D2 SVG, see 3.2)
```

---

### 3.2 D2 for diagrams

D2 is the primary markup language for engineering diagrams.

Use cases:

```text
- system architecture
- service maps
- dependency diagrams
- infrastructure diagrams
```

Example:

```d2
Web App -> API Gateway: HTTPS
API Gateway -> CRM Core: REST
CRM Core -> Postgres: SQL
CRM Core -> Redis: cache
```

D2 should be supported as:

```text
D2 source
  ↓
D2 render or parse
  ↓
SVG / Visual IR
  ↓
PNG / PDF embedding
```

Rendered D2 SVG is embedded directly into HTML documents (inline `<svg>` or `<img>`) for mockups/reports, or exported standalone.

---

### 3.3 ApexCharts

Charts are authored directly as ApexCharts config objects inside HTML mode — no separate SDK wrapper.

Example:

```html
<!doctype html>
<html>
  <head>
    <style>@import "tailwindcss";</style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="bg-white p-10">
    <div id="chart"></div>
    <script>
      new ApexCharts(document.querySelector("#chart"), {
        chart: { type: "bar", height: 400 },
        title: { text: "Monthly policies sold" },
        xaxis: { categories: ["Jan", "Feb", "Mar", "Apr"] },
        series: [{ name: "Policies", data: [1200, 1800, 2300, 3100] }],
      }).render();
    </script>
  </body>
</html>
```

Internally:

```text
ApexCharts options (inline JS)
  ↓
Playwright render (JS-enabled)
  ↓
PDF / PNG / SVG
```

The `apexcharts.min.js` bundle is a local allowlisted asset — no CDN script tags.

---

## 4. Output formats

Supported v0.1 outputs:

```text
- PNG
- SVG
- PDF
- HTML
```

Output types:

```text
Visual asset:
- PNG
- SVG

Document asset:
- multipage PDF
- HTML source
```

---

## 5. PDF rendering

PDF generation should use HTML/CSS + Playwright.

Pipeline:

```text
HTML document
  ↓
Tailwind v4 build
  ↓
Playwright page.pdf()
  ↓
/output/report.pdf
```

Multi-page documents are plain HTML using print CSS for pagination — no Document builder API:

```html
<section class="page" style="break-after: page;">
  <h1>Overview</h1>
  <p>A modular system for policies, claims and billing.</p>
</section>

<section class="page" style="break-after: page;">
  <h1>Architecture</h1>
  <!-- D2-rendered SVG embedded here -->
</section>

<section class="page">
  <h1>Charts</h1>
  <!-- ApexCharts <div> + inline <script> here -->
</section>
```

`render_file` is then called once against this HTML with `format: "pdf"` (see 6.4); Playwright/Chromium's print pagination handles page breaks, headers/footers via `pdf` options.

PDF should support:

```text
- multiple pages
- page numbers
- headers/footers
- charts
- diagrams
- tables
- mockup screenshots
- print background
- A4 / A3 / Letter
- portrait / landscape
```

---

## 6. MCP tool surface

Keep MCP tools coarse-grained.

### 6.1 create_visual_session

```ts
create_visual_session({
  runtime: "node",
  template?: "blank" | "mockup" | "diagram" | "infographic" | "report"
})
```

Returns:

```json
{
  "session_id": "sess_123",
  "workspace": "/session_123"
}
```

---

### 6.2 run_code

```ts
run_code({
  session_id: "sess_123",
  code: "..."
})
```

Executes JS/TS code inside the sandbox.

---

### 6.3 write_file

```ts
write_file({
  session_id: "sess_123",
  path: "/src/report.html",
  content: "..."
})
```

Useful for raw HTML, D2, or longer source files.

---

### 6.4 render_file

```ts
render_file({
  session_id: "sess_123",
  entrypoint: "/src/report.html",
  output_path: "/output/report.pdf",
  format: "pdf",
  viewport?: {
    width: 1200,
    height: 800,
    deviceScaleFactor: 2
  },
  pdf?: {
    format: "A4",
    orientation: "portrait",
    printBackground: true
  }
})
```

---

### 6.5 list_artifacts

```ts
list_artifacts({
  session_id: "sess_123"
})
```

Returns:

```json
{
  "primary": "/output/report.pdf",
  "artifacts": [
    "/output/report.pdf",
    "/output/architecture.png",
    "/output/chart.svg"
  ]
}
```

---

### 6.6 export_artifact

```ts
export_artifact({
  session_id: "sess_123",
  path: "/output/report.pdf"
})
```

Returns the final artifact to the MCP client.

---

### 6.7 list_templates

```ts
list_templates({
  kind?: "mockup" | "diagram" | "report" | "infographic" | "chart"
})
```

---

## 7. Filesystem model

Each session has isolated workspace:

```text
/session
  /src
  /output
  /assets
  /templates
  /cache
```

Rules:

```text
- LLM can write to /src and /output
- read-only templates in /templates
- uploaded assets in /assets
- final files must be in /output
```

---

## 8. Rendering pipeline

### 8.1 HTML to image

```text
HTML + Tailwind v4
  ↓
build CSS
  ↓
Playwright Chromium
  ↓
screenshot
  ↓
Sharp optimization
  ↓
PNG
```

---

### 8.2 HTML to PDF

```text
HTML + print CSS
  ↓
Playwright page.pdf()
  ↓
PDF
```

---

### 8.3 D2 to image

```text
D2 source
  ↓
SVG render
  ↓
optional HTML wrapper
  ↓
PNG / PDF embedding
```

---

## 9. Sandbox policy

v0.1 sandbox should be restrictive.

Default:

```text
- no external network
- no shell access
- no arbitrary npm install
- allowlisted packages only
- CPU limit
- memory limit
- timeout per run
- read/write only inside session workspace
- local assets only
```

Allowed packages:

```text
- apexcharts
- d2 renderer
- tailwindcss v4
```

Raw HTML mode:

```text
Allowed:
- HTML
- Tailwind v4
- inline SVG
- local assets
- local fonts
- allowlisted local JS bundles

Blocked:
- CDN scripts
- CDN CSS
- external images
- remote fonts
- arbitrary browser navigation
```

---

## 10. Template system

v0.1 should include a small number of strong templates.

Templates:

```text
- architecture-overview
- sequence-flow
- mobile-app-screen
- browser-app-screen
- dashboard-overview
- one-page-infographic
- multipage-report
- chart-report
```

Each template should expose:

```ts
{
  id: string;
  name: string;
  kind: "diagram" | "mockup" | "report" | "chart" | "infographic";
  description: string;
  expectedInputs: Record<string, unknown>;
  exampleCode: string;
}
```

---

## 11. Theme system

Themes should be token-based.

Theme contract:

```ts
{
  name: string;
  colors: {
    background: string;
    foreground: string;
    muted: string;
    primary: string;
    secondary: string;
    border: string;
  };
  typography: {
    fontSans: string;
    fontMono: string;
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  chartPalette: string[];
  diagramStyle: {
    nodeRadius: string;
    edgeStyle: string;
  };
}
```

Initial themes:

```text
- clean-saas
- minimal-docs
- dark-terminal
- startup-pitch
```

Themes should compile to Tailwind v4 `@theme` tokens.

---

## 12. Artifact manifest

Every session should produce manifest metadata.

Example:

```json
{
  "session_id": "sess_123",
  "primary": "/output/report.pdf",
  "artifacts": [
    {
      "path": "/output/report.pdf",
      "type": "pdf",
      "role": "primary"
    },
    {
      "path": "/output/architecture.png",
      "type": "image",
      "role": "supporting"
    },
    {
      "path": "/output/source.zip",
      "type": "source",
      "role": "debug"
    }
  ],
  "created_at": "2026-07-02T00:00:00Z"
}
```

---

## 13. Package structure

Single-package repo (no monorepo/workspaces):

```text
visual-runtime
  /src
    /server            # MCP server entrypoint & tool handlers
    /sandbox            # Node.js sandbox runner
    /render
      /diagrams          # D2 wrapper
      /charts            # ApexCharts asset + options passthrough
      /themes            # theme token compiler -> Tailwind @theme
      /playwright-renderer
      /artifact-store
    /templates          # template registry
  /test
  package.json
  tsconfig.json
```

Все модули — internal namespaces под `src/`, не отдельные publishable packages. Никакой кастомной SDK-абстракции (Document/Diagram/Chart классов) — LLM пишет HTML/D2/ApexCharts-код напрямую, `render` слой только оборачивает существующие рендереры (D2, Playwright, Sharp).

---

## 14. v0.1 MVP scope

Must-have:

```text
- MCP server
- Node.js sandbox
- session workspace
- run_code
- write_file
- render_file
- export_artifact
- list_artifacts
- PNG export
- SVG export
- multipage PDF export (via print CSS, no Document builder API)
- raw HTML + Tailwind v4 mode
- D2 support
- ApexCharts integration (inline JS in HTML mode)
- artifact manifest
```

Nice-to-have but not required:

```text
- visual regression tests
- advanced theme editor
- Figma export
- animation
- Python runtime
- collaborative editing
- browser preview UI
```

Explicitly out of scope for v0.1:

```text
- Python sandbox
- arbitrary npm install
- internet access from sandbox
- external CSS frameworks
- Figma-level editor
- full custom canvas drawing API
- complex validator layer
- custom VisualKit SDK (Document/Diagram/Chart builder classes)
- Mermaid support
- WebP export
```

---

## 15. Recommended initial API example

Flow: LLM writes a D2 file for the diagram, writes one HTML file (report body + inline ApexCharts), then calls `render_file` once for PDF.

```ts
// 1. write_file("/src/architecture.d2", ...)
```

```d2
Web App -> API Gateway: HTTPS
API Gateway -> CRM Core: REST
CRM Core -> Postgres: SQL
```

```ts
// 2. render_file({ entrypoint: "/src/architecture.d2", output_path: "/cache/architecture.svg", format: "svg" })
// 3. write_file("/src/report.html", ...) — embeds the rendered SVG inline
```

```html
<!doctype html>
<html>
  <head>
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
      <!-- inlined content of /cache/architecture.svg -->
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
</html>
```

```ts
// 4. render_file({
//      entrypoint: "/src/report.html",
//      output_path: "/output/insurance-crm-overview.pdf",
//      format: "pdf",
//      pdf: { format: "A4", printBackground: true }
//    })
```

---

## 16. Product positioning

Final positioning:

```text
A programmable visual and document runtime for LLM agents.

LLMs can generate:
- diagrams
- mockups
- charts
- infographics
- reports
- multipage PDFs

using:
- Node.js code
- Tailwind v4 HTML
- D2
- ApexCharts
```

The system should feel less like a drawing API and more like a **visual compiler for AI agents**.

