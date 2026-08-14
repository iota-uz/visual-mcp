/**
 * multipage-report template (PLAN.md section 10, section 5 print-CSS
 * pagination pattern, and the full worked example in section 15).
 *
 * Plain multi-page HTML using `break-after: page` sections — no Document
 * builder API. Cover page, an architecture page with a placeholder comment
 * for an inline D2 SVG (produced by an earlier svg render of a .d2 source),
 * and a charts page with an inline ApexCharts config. Rendered once to PDF.
 */

import type { Template } from "../types.js";

const exampleCode = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @import "tailwindcss";

      @theme {
        --font-sans: Inter, sans-serif;
        --color-brand: #2563eb;
      }

      /* Print CSS: each .page section is one PDF page (PLAN.md section 5). */
      @media print {
        .page {
          break-after: page;
        }
        .page:last-child {
          break-after: auto;
        }
      }
    </style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="m-0 font-sans text-slate-900">
    <!-- Page 1: cover -->
    <section class="page p-16 h-[1123px] flex flex-col justify-between" style="break-after: page;">
      <div>
        <p class="text-sm font-semibold uppercase tracking-widest text-brand">Quarterly Report</p>
        <h1 class="mt-4 text-5xl font-bold text-slate-950">Insurance CRM Platform</h1>
        <p class="mt-4 text-xl text-slate-600">
          A modular system for policies, claims, billing and analytics.
        </p>
      </div>
      <p class="text-sm text-slate-400">Q2 2026 &middot; Prepared by Platform Engineering</p>
    </section>

    <!-- Page 2: architecture (D2 SVG embedded here) -->
    <section class="page p-16" style="break-after: page;">
      <h2 class="text-3xl font-bold mb-6">System Architecture</h2>
      <p class="text-slate-600 mb-6">
        Client apps talk to core services through a single API gateway;
        async work fans out through a message queue.
      </p>
      <!--
        Render /src/architecture.d2 to SVG first — canvas_save with
        renders: [{ entrypoint: "/src/architecture.d2",
                    output_path: "/cache/architecture.svg", format: "svg" }]
        — then inline the resulting <svg>...</svg> markup here.
      -->
      <div class="rounded-2xl border border-slate-200 p-8 text-slate-400 text-sm">
        &lt;!-- inlined content of /cache/architecture.svg --&gt;
      </div>
    </section>

    <!-- Page 3: charts -->
    <section class="page p-16">
      <h2 class="text-3xl font-bold mb-6">Monthly Policy Sales</h2>
      <div id="chart"></div>
      <script>
        new ApexCharts(document.querySelector("#chart"), {
          chart: { type: "bar", height: 400, toolbar: { show: false } },
          xaxis: { categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] },
          series: [
            { name: "Policies", data: [1200, 1800, 2400, 3100, 2900, 3412] },
          ],
          colors: ["#2563eb"],
        }).render();
      </script>
    </section>
  </body>
</html>
`;

export const multipageReportTemplate: Template = {
  id: "multipage-report",
  name: "Multipage Report",
  kind: "report",
  description:
    "Multi-page PDF report using print-CSS `break-after: page` sections: " +
    "a cover page, an architecture page with a placeholder for an inlined " +
    "D2-rendered SVG, and a charts page with an inline ApexCharts config. " +
    "Render once to PDF (PLAN.md section 15).",
  expectedInputs: {
    coverEyebrow: "string",
    coverTitle: "string",
    coverSubtitle: "string",
    coverFootnote: "string",
    architectureSvgPath:
      "string — cache path of a previously D2-rendered SVG to inline, e.g. '/cache/architecture.svg'",
    chartSeries: {
      categories: ["string"],
      series: [{ name: "string", data: ["number"] }],
    },
  },
  exampleCode,
};
