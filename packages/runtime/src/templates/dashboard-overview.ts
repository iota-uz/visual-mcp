/**
 * dashboard-overview template (PLAN.md section 10, chart pattern per 3.3).
 *
 * Raw HTML + Tailwind v4 dashboard mockup: stat cards plus at least one
 * inline ApexCharts chart, loaded from the local allowlisted asset bundle
 * (never a CDN script — PLAN.md sections 3.3 / 9).
 */

import type { Template } from "../types.js";
import { templateMetadata } from "./metadata.js";

const exampleCode = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @import "tailwindcss";
    </style>
    <script src="/assets/js/apexcharts.min.js"></script>
  </head>
  <body class="m-0 bg-surface font-sans">
    <main class="w-[1280px] p-10">
      <header class="mb-8">
        <h1 class="text-3xl font-bold text-foreground">Business Overview</h1>
        <p class="mt-1 text-muted-foreground">Last 30 days &middot; updated Jul 02, 2026</p>
      </header>

      <!-- Stat cards -->
      <section class="grid grid-cols-4 gap-5 mb-8">
        <div class="rounded-2xl bg-background p-5 shadow-sm">
          <p class="text-sm text-muted-foreground">Policies sold</p>
          <p class="mt-2 text-3xl font-bold text-foreground">3,412</p>
          <p class="mt-1 text-sm font-medium text-success">+12.4% vs last month</p>
        </div>
        <div class="rounded-2xl bg-background p-5 shadow-sm">
          <p class="text-sm text-muted-foreground">Active customers</p>
          <p class="mt-2 text-3xl font-bold text-foreground">18,905</p>
          <p class="mt-1 text-sm font-medium text-success">+3.1% vs last month</p>
        </div>
        <div class="rounded-2xl bg-background p-5 shadow-sm">
          <p class="text-sm text-muted-foreground">Open claims</p>
          <p class="mt-2 text-3xl font-bold text-foreground">214</p>
          <p class="mt-1 text-sm font-medium text-danger">+5.8% vs last month</p>
        </div>
        <div class="rounded-2xl bg-background p-5 shadow-sm">
          <p class="text-sm text-muted-foreground">Monthly revenue</p>
          <p class="mt-2 text-3xl font-bold text-foreground">$482,300</p>
          <p class="mt-1 text-sm font-medium text-success">+8.9% vs last month</p>
        </div>
      </section>

      <!-- Chart + side panel -->
      <section class="grid grid-cols-3 gap-5">
        <div class="col-span-2 rounded-2xl bg-background p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-foreground mb-4">Monthly policies sold</h2>
          <div id="policies-chart"></div>
        </div>
        <div class="rounded-2xl bg-background p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-foreground mb-4">Top plans</h2>
          <ul class="space-y-3 text-sm">
            <li class="flex items-center justify-between">
              <span class="text-muted-foreground">Comprehensive Auto</span>
              <span class="font-semibold text-foreground">38%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-muted-foreground">Home Standard</span>
              <span class="font-semibold text-foreground">27%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-muted-foreground">Life Basic</span>
              <span class="font-semibold text-foreground">19%</span>
            </li>
            <li class="flex items-center justify-between">
              <span class="text-muted-foreground">Travel</span>
              <span class="font-semibold text-foreground">16%</span>
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
        colors: ["var(--color-chart-1)"],
      }).render();
    </script>
  </body>
</html>
`;

export const dashboardOverviewTemplate: Template = {
  ...templateMetadata("dashboard-overview"),
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
