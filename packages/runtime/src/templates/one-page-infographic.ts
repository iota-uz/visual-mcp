/**
 * one-page-infographic template (PLAN.md section 10, styling per 3.1/2.4).
 *
 * Raw HTML + Tailwind v4, single dense page combining stats, inline-SVG
 * icons and short sections. No external icon font/CDN — icons are plain
 * inline SVG paths (PLAN.md section 9's asset restrictions).
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
        --color-ink: #0f172a;
      }
    </style>
  </head>
  <body class="m-0 bg-white font-sans">
    <main class="w-[1000px] p-14 text-ink">
      <!-- Header -->
      <header class="mb-10">
        <p class="text-sm font-semibold uppercase tracking-widest text-brand">2026 Industry Snapshot</p>
        <h1 class="mt-2 text-5xl font-bold text-slate-950">The State of Digital Insurance</h1>
        <p class="mt-3 max-w-2xl text-lg text-slate-600">
          How policyholders discover, buy and manage coverage &mdash; based on
          40,000 customer interactions across web and mobile.
        </p>
      </header>

      <!-- Big stats row -->
      <section class="grid grid-cols-4 gap-6 mb-12">
        <div class="rounded-2xl bg-brand-soft p-6">
          <p class="text-4xl font-bold text-brand">78%</p>
          <p class="mt-2 text-sm text-slate-600">buy their first policy entirely online</p>
        </div>
        <div class="rounded-2xl bg-brand-soft p-6">
          <p class="text-4xl font-bold text-brand">3.2x</p>
          <p class="mt-2 text-sm text-slate-600">faster claims with mobile photo intake</p>
        </div>
        <div class="rounded-2xl bg-brand-soft p-6">
          <p class="text-4xl font-bold text-brand">94%</p>
          <p class="mt-2 text-sm text-slate-600">customer satisfaction with self-service billing</p>
        </div>
        <div class="rounded-2xl bg-brand-soft p-6">
          <p class="text-4xl font-bold text-brand">41%</p>
          <p class="mt-2 text-sm text-slate-600">lower support volume after chatbot rollout</p>
        </div>
      </section>

      <!-- Icon feature grid -->
      <section class="grid grid-cols-3 gap-8 mb-12">
        <div class="flex gap-4">
          <svg class="h-10 w-10 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6l-9-4Z" stroke-linejoin="round" />
            <path d="m9 12 2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div>
            <h3 class="font-semibold text-slate-900">Instant coverage</h3>
            <p class="mt-1 text-sm text-slate-600">Quote to bound policy in under 4 minutes.</p>
          </div>
        </div>
        <div class="flex gap-4">
          <svg class="h-10 w-10 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 3v3M16 3v3" stroke-linecap="round" />
          </svg>
          <div>
            <h3 class="font-semibold text-slate-900">Automated renewals</h3>
            <p class="mt-1 text-sm text-slate-600">Zero-touch renewal for 9 in 10 policyholders.</p>
          </div>
        </div>
        <div class="flex gap-4">
          <svg class="h-10 w-10 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M12 21c4.97-3.5 8-7.13 8-11a8 8 0 1 0-16 0c0 3.87 3.03 7.5 8 11Z" stroke-linejoin="round" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <div>
            <h3 class="font-semibold text-slate-900">Nationwide coverage</h3>
            <p class="mt-1 text-sm text-slate-600">Licensed in all 50 states, 24/7 claims support.</p>
          </div>
        </div>
      </section>

      <!-- Timeline / process section -->
      <section>
        <h2 class="text-2xl font-bold text-slate-950 mb-6">Customer journey, simplified</h2>
        <ol class="grid grid-cols-4 gap-6">
          <li class="rounded-xl border border-slate-200 p-5">
            <span class="text-xs font-bold text-brand">STEP 1</span>
            <p class="mt-1 font-semibold text-slate-900">Get a quote</p>
            <p class="mt-1 text-sm text-slate-600">Answer 6 questions, no phone call needed.</p>
          </li>
          <li class="rounded-xl border border-slate-200 p-5">
            <span class="text-xs font-bold text-brand">STEP 2</span>
            <p class="mt-1 font-semibold text-slate-900">Choose a plan</p>
            <p class="mt-1 text-sm text-slate-600">Compare coverage tiers side by side.</p>
          </li>
          <li class="rounded-xl border border-slate-200 p-5">
            <span class="text-xs font-bold text-brand">STEP 3</span>
            <p class="mt-1 font-semibold text-slate-900">Activate policy</p>
            <p class="mt-1 text-sm text-slate-600">Digital ID card issued instantly.</p>
          </li>
          <li class="rounded-xl border border-slate-200 p-5">
            <span class="text-xs font-bold text-brand">STEP 4</span>
            <p class="mt-1 font-semibold text-slate-900">Manage &amp; claim</p>
            <p class="mt-1 text-sm text-slate-600">File and track claims from the app.</p>
          </li>
        </ol>
      </section>
    </main>
  </body>
</html>
`;

export const onePageInfographicTemplate: Template = {
  id: "one-page-infographic",
  name: "One-Page Infographic",
  kind: "infographic",
  description:
    "Single dense infographic page combining a headline stat row, an " +
    "icon feature grid (inline SVG icons, no icon font) and a 4-step " +
    "process timeline. Good for social/report share images.",
  expectedInputs: {
    eyebrow: "string — small label above the title",
    title: "string",
    subtitle: "string",
    stats: [{ value: "string", caption: "string" }],
    features: [{ title: "string", description: "string" }],
    steps: [{ label: "string — e.g. 'STEP 1'", title: "string", description: "string" }],
  },
  exampleCode,
};
