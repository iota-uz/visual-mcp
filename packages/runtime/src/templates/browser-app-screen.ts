/**
 * browser-app-screen template (PLAN.md section 10, styling per 3.1/2.4).
 *
 * Raw HTML + Tailwind v4 mockup of a desktop web app screen: fixed wide
 * viewport, left sidebar navigation + main content area, in the spirit of
 * PLAN.md section 3.1's example but laid out like a real SaaS app shell.
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
  </head>
  <body class="m-0 bg-surface font-sans">
    <main class="w-[1440px] h-[900px] flex overflow-hidden">
      <!-- Sidebar -->
      <aside class="w-64 shrink-0 bg-foreground text-background flex flex-col">
        <div class="px-6 py-5 flex items-center gap-2">
          <div class="h-8 w-8 rounded-lg bg-primary"></div>
          <span class="text-background font-bold text-lg">Insurly</span>
        </div>
        <nav class="mt-4 flex-1 space-y-1 px-3">
          <a class="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-background">
            <span>&#128202;</span> Dashboard
          </a>
          <a class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-background">
            <span>&#128196;</span> Policies
          </a>
          <a class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-background">
            <span>&#9878;</span> Claims
          </a>
          <a class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-background">
            <span>&#128100;</span> Customers
          </a>
          <a class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-background">
            <span>&#9881;</span> Settings
          </a>
        </nav>
        <div class="px-6 py-5 border-t border-border text-xs text-background">
          v0.1 &middot; Insurance CRM
        </div>
      </aside>

      <!-- Main content -->
      <section class="flex-1 flex flex-col">
        <header class="flex items-center justify-between border-b border-border bg-background px-10 py-5">
          <div>
            <h1 class="text-2xl font-bold text-foreground">Claims</h1>
            <p class="text-sm text-muted-foreground">All open and recently closed claims</p>
          </div>
          <div class="flex items-center gap-3">
            <input
              class="w-64 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground"
              placeholder="Search claims..."
            />
            <button class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-background">
              New claim
            </button>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto px-10 py-6">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                <th class="py-3 font-medium">Claim ID</th>
                <th class="py-3 font-medium">Customer</th>
                <th class="py-3 font-medium">Type</th>
                <th class="py-3 font-medium">Filed</th>
                <th class="py-3 font-medium">Status</th>
                <th class="py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr>
                <td class="py-4 font-medium text-foreground">#A-1042</td>
                <td class="py-4 text-muted-foreground">Maria Chen</td>
                <td class="py-4 text-muted-foreground">Auto collision</td>
                <td class="py-4 text-muted-foreground">Jul 09, 2026</td>
                <td class="py-4">
                  <span class="rounded-full bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">In review</span>
                </td>
                <td class="py-4 text-right font-semibold text-foreground">$3,200</td>
              </tr>
              <tr>
                <td class="py-4 font-medium text-foreground">#A-1038</td>
                <td class="py-4 text-muted-foreground">Daniel Osei</td>
                <td class="py-4 text-muted-foreground">Home water damage</td>
                <td class="py-4 text-muted-foreground">Jun 30, 2026</td>
                <td class="py-4">
                  <span class="rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">Approved</span>
                </td>
                <td class="py-4 text-right font-semibold text-foreground">$12,450</td>
              </tr>
              <tr>
                <td class="py-4 font-medium text-foreground">#A-1031</td>
                <td class="py-4 text-muted-foreground">Priya Nair</td>
                <td class="py-4 text-muted-foreground">Auto liability</td>
                <td class="py-4 text-muted-foreground">Jun 21, 2026</td>
                <td class="py-4">
                  <span class="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-muted-foreground">Closed</span>
                </td>
                <td class="py-4 text-right font-semibold text-foreground">$780</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </body>
</html>
`;

export const browserAppScreenTemplate: Template = {
  ...templateMetadata("browser-app-screen"),
  id: "browser-app-screen",
  name: "Browser App Screen",
  kind: "mockup",
  description:
    "Desktop web app screen mockup (1440x900) with a dark sidebar " +
    "navigation and a main content area showing a data table. Good for " +
    "SaaS product screenshots and app-shell previews.",
  expectedInputs: {
    appName: "string — sidebar brand name, e.g. 'Insurly'",
    navItems: ["string — sidebar nav label, e.g. 'Dashboard' | 'Claims'"],
    pageTitle: "string",
    pageSubtitle: "string",
    tableColumns: ["string — column header"],
    tableRows: [
      {
        cells: ["string — cell value per column"],
        statusBadge: { label: "string", tone: "'success' | 'warning' | 'neutral'" },
      },
    ],
  },
  exampleCode,
};
