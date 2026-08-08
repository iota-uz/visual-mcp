/**
 * dashboard-overview template (PLAN.md section 10, chart pattern per 3.3).
 *
 * Raw HTML + Tailwind v4 dashboard mockup: stat cards plus at least one
 * inline ApexCharts chart, loaded from the local allowlisted asset bundle
 * (never a CDN script — PLAN.md sections 3.3 / 9).
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
        <h1 class="text-3xl font-bold text-slate-950">Business Overview</h1>
        <p class="mt-1 text-slate-500">Last 30 days &middot; updated Jul 02, 2026</p>
      </header>

      <!-- Stat cards -->
      <section class="grid grid-cols-4 gap-5 mb-8">
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Policies sold</p>
          <p class="mt-2 text-3xl font-bold text-slate-950">3,412</p>
          <p class="mt-1 text-sm font-medium text-emerald-600">+12.4% vs last month</p>
        </div>
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Active customers</p>
          <p class="mt-2 text-3xl font-bold text-slate-950">18,905</p>
          <p class="mt-1 text-sm font-medium text-emerald-600">+3.1% vs last month</p>
        </div>
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Open claims</p>
          <p class="mt-2 text-3xl font-bold text-slate-950">214</p>
          <p class="mt-1 text-sm font-medium text-rose-600">+5.8% vs last month</p>
        </div>
        <div class="rounded-2xl bg-white p-5 shadow-sm">
          <p class="text-sm text-slate-500">Monthly revenue</p>
          <p class="mt-2 text-3xl font-bold text-slate-950">$482,300</p>
          <p class="mt-1 text-sm font-medium text-emerald-600">+8.9% vs last month</p>
        </div>
      </section>

      <!-- Chart + side panel -->
      <section class="grid grid-cols-3 gap-5">
        <div class="col-span-2 rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Monthly policies sold</h2>
          <div id="policies-chart"></div>
        </div>
        <div class="rounded-2xl bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Top plans</h2>
          <ul class="space-y-3 text-sm">
            <li class="flex items-center justify-between">
              <span class="text-slate-600">Comprehensive Auto</span>
              <span class="font-semibold text-slate-900">38%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-slate-600">Home Standard</span>
              <span class="font-semibold text-slate-900">27%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-slate-600">Life Basic</span>
              <span class="font-semibold text-slate-900">19%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-slate-600">Travel</span>
              <span class="font-semibold text-slate-900">16%</span>
            </li>
          </ul>
        </div>
      </section>
    </main>

    <script>
      new ApexCharts(document.querySelector("#policies-chart"), {
        chart: { type: "bar", height: 320, toolbar: { show: false } },
        xaxis: { categories: ["Feb", "Mar", "Apr", "May", "Jun", "Jul"] },
        series: [
          { name: "Policies", data: [2100, 2450, 2800, 2600, 3100, 3412] },
        ],
        colors: ["#2563eb"],
      }).render();
    </script>
  </body>
</html>
`;

export const dashboardOverviewTemplate: Template = {
  id: "dashboard-overview",
  name: "Dashboard Overview",
  kind: "mockup",
  description:
    "Analytics dashboard mockup with KPI stat cards and an inline " +
    "ApexCharts bar chart plus a ranked side panel. Loads the local " +
    "apexcharts.min.js asset bundle — no CDN script tags.",
  expectedInputs: {
    title: "string",
    stats: [
      {
        label: "string",
        value: "string",
        delta: "string — e.g. '+12.4% vs last month'",
        trend: "'up' | 'down'",
      },
    ],
    chartSeries: {
      categories: ["string — x-axis label, e.g. month name"],
      series: [{ name: "string", data: ["number"] }],
    },
    sidePanel: { title: "string", rows: [{ label: "string", value: "string" }] },
  },
  exampleCode,
};
