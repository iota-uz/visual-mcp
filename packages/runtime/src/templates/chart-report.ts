/**
 * chart-report template (PLAN.md section 10, chart pattern per 3.3).
 *
 * Raw HTML + Tailwind v4 page focused on multiple ApexCharts charts of
 * different types (bar, line, donut) laid out on one page. Loads the
 * local allowlisted apexcharts.min.js bundle — no CDN scripts.
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
        --color-surface: #f8fafc;
      }
    </style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="m-0 bg-surface font-sans">
    <main class="w-[1280px] p-10">
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-slate-950">Sales &amp; Retention Charts</h1>
        <p class="mt-1 text-slate-500">Q2 2026</p>
      </header>

      <section class="grid grid-cols-2 gap-6 mb-6">
        <div class="rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Monthly policies sold</h2>
          <div id="bar-chart"></div>
        </div>
        <div class="rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Retention rate trend</h2>
          <div id="line-chart"></div>
        </div>
      </section>

      <section class="grid grid-cols-3 gap-6">
        <div class="col-span-1 rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Revenue by plan</h2>
          <div id="donut-chart"></div>
        </div>
        <div class="col-span-2 rounded-2xl bg-white p-6 shadow-sm flex flex-col justify-center">
          <p class="text-sm text-slate-500">Total revenue</p>
          <p class="mt-1 text-4xl font-bold text-slate-950">\$482,300</p>
          <p class="mt-2 text-sm font-medium text-emerald-600">+8.9% quarter over quarter</p>
        </div>
      </section>
    </main>

    <script>
      new ApexCharts(document.querySelector("#bar-chart"), {
        chart: { type: "bar", height: 300, toolbar: { show: false } },
        xaxis: { categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] },
        series: [
          { name: "Policies", data: [1200, 1800, 2400, 3100, 2900, 3412] },
        ],
        colors: ["#2563eb"],
      }).render();

      new ApexCharts(document.querySelector("#line-chart"), {
        chart: { type: "line", height: 300, toolbar: { show: false } },
        xaxis: { categories: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"] },
        series: [
          { name: "Retention %", data: [91, 90, 92, 93, 94, 94.5] },
        ],
        colors: ["#16a34a"],
        stroke: { curve: "smooth", width: 3 },
      }).render();

      new ApexCharts(document.querySelector("#donut-chart"), {
        chart: { type: "donut", height: 280 },
        labels: ["Comprehensive Auto", "Home Standard", "Life Basic", "Travel"],
        series: [38, 27, 19, 16],
        colors: ["#2563eb", "#38bdf8", "#a78bfa", "#f472b6"],
      }).render();
    </script>
  </body>
</html>
`;

export const chartReportTemplate: Template = {
  id: "chart-report",
  name: "Chart Report",
  kind: "chart",
  description:
    "Single-page report focused on data visualization: a bar chart, a " +
    "line chart and a donut chart via inline ApexCharts configs, plus a " +
    "headline revenue callout. Good for metrics snapshots and reviews.",
  expectedInputs: {
    title: "string",
    subtitle: "string",
    barSeries: {
      categories: ["string"],
      series: [{ name: "string", data: ["number"] }],
    },
    lineSeries: {
      categories: ["string"],
      series: [{ name: "string", data: ["number"] }],
    },
    donut: { labels: ["string"], series: ["number"] },
    headline: { label: "string", value: "string", delta: "string" },
  },
  exampleCode,
};
