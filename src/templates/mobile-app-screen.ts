/**
 * mobile-app-screen template (PLAN.md section 10, styling per 3.1/2.4).
 *
 * Raw HTML + Tailwind v4 mockup of a single mobile app screen: a narrow
 * device-width frame with a status/nav bar, scrollable content and a
 * bottom tab bar. Rendered via Playwright screenshot (PLAN.md 8.1).
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
        --color-brand-soft: #eff6ff;
      }
    </style>
  </head>
  <body class="m-0 bg-slate-200 font-sans">
    <!-- Device frame: narrow fixed-width viewport for a phone mockup -->
    <main class="mx-auto w-[375px] h-[812px] bg-white overflow-hidden relative shadow-2xl">
      <!-- Status bar -->
      <div class="flex items-center justify-between px-6 pt-3 pb-1 text-xs font-semibold text-slate-900">
        <span>9:41</span>
        <span class="flex items-center gap-1">
          <span>&#9679;&#9679;&#9679;</span>
          <span>&#128267;</span>
        </span>
      </div>

      <!-- Top nav -->
      <header class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <button class="text-slate-500 text-xl leading-none">&#8592;</button>
        <h1 class="text-base font-bold text-slate-950">My Policies</h1>
        <button class="text-brand text-xl leading-none">&#9998;</button>
      </header>

      <!-- Scrollable content -->
      <section class="px-5 py-4 space-y-4 overflow-y-auto h-[640px]">
        <div class="rounded-2xl bg-brand text-white p-5">
          <p class="text-xs uppercase tracking-wide opacity-80">Active plan</p>
          <p class="mt-1 text-2xl font-bold">Comprehensive Auto</p>
          <p class="mt-3 text-sm opacity-90">Next payment: Aug 14 &middot; \$84.00</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-xl bg-brand-soft p-4">
            <p class="text-xs text-slate-500">Coverage</p>
            <p class="mt-1 text-lg font-bold text-slate-950">\$50,000</p>
          </div>
          <div class="rounded-xl bg-brand-soft p-4">
            <p class="text-xs text-slate-500">Claims filed</p>
            <p class="mt-1 text-lg font-bold text-slate-950">2</p>
          </div>
        </div>

        <div>
          <h2 class="text-sm font-semibold text-slate-900 mb-2">Recent activity</h2>
          <ul class="divide-y divide-slate-100 rounded-xl border border-slate-100">
            <li class="flex items-center justify-between px-4 py-3">
              <div>
                <p class="text-sm font-medium text-slate-900">Payment received</p>
                <p class="text-xs text-slate-500">Jul 14, 2026</p>
              </div>
              <span class="text-sm font-semibold text-emerald-600">+\$84.00</span>
            </li>
            <li class="flex items-center justify-between px-4 py-3">
              <div>
                <p class="text-sm font-medium text-slate-900">Claim #A-1042 updated</p>
                <p class="text-xs text-slate-500">Jul 09, 2026</p>
              </div>
              <span class="text-xs font-semibold text-amber-600">In review</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Bottom tab bar -->
      <nav class="absolute bottom-0 left-0 right-0 h-20 bg-white border-t border-slate-100 flex items-center justify-around pb-4">
        <button class="flex flex-col items-center gap-1 text-brand">
          <span class="text-lg">&#127968;</span>
          <span class="text-[10px] font-medium">Home</span>
        </button>
        <button class="flex flex-col items-center gap-1 text-slate-400">
          <span class="text-lg">&#128196;</span>
          <span class="text-[10px] font-medium">Policies</span>
        </button>
        <button class="flex flex-col items-center gap-1 text-slate-400">
          <span class="text-lg">&#128179;</span>
          <span class="text-[10px] font-medium">Billing</span>
        </button>
        <button class="flex flex-col items-center gap-1 text-slate-400">
          <span class="text-lg">&#128100;</span>
          <span class="text-[10px] font-medium">Profile</span>
        </button>
      </nav>
    </main>
  </body>
</html>
`;

export const mobileAppScreenTemplate: Template = {
  id: "mobile-app-screen",
  name: "Mobile App Screen",
  kind: "mockup",
  description:
    "Single mobile app screen mockup in a fixed-width phone frame " +
    "(375x812) with a status/nav bar, scrollable content and a bottom " +
    "tab bar. Good for feature previews and app-store style screenshots.",
  expectedInputs: {
    screenTitle: "string — nav bar title, e.g. 'My Policies'",
    heroCard: {
      label: "string",
      title: "string",
      subtitle: "string",
    },
    stats: [{ label: "string", value: "string" }],
    activity: [{ title: "string", meta: "string", badge: "string" }],
    tabs: ["string — bottom tab label, e.g. 'Home' | 'Billing'"],
  },
  exampleCode,
};
