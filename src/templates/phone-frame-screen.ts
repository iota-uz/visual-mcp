/**
 * phone-frame-screen template.
 *
 * Mobile app screen mockup with a *visible device bezel*: rounded black
 * frame, dynamic-island notch, side buttons and a home indicator — unlike
 * mobile-app-screen (bare white rectangle, no chrome). Status bar icons
 * (signal/wifi/battery) and content icons are inline SVG, no icon font.
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
    <main class="relative mx-auto" style="width: 393px;">
      <!-- Side buttons (outside the bezel edge) -->
      <div class="absolute -left-[2px] top-[124px] h-[28px] w-[3px] rounded-l bg-slate-900"></div>
      <div class="absolute -left-[2px] top-[172px] h-[56px] w-[3px] rounded-l bg-slate-900"></div>
      <div class="absolute -left-[2px] top-[236px] h-[56px] w-[3px] rounded-l bg-slate-900"></div>
      <div class="absolute -right-[2px] top-[200px] h-[88px] w-[3px] rounded-r bg-slate-900"></div>

      <!-- Bezel -->
      <div class="relative rounded-[52px] bg-slate-950 p-[12px] shadow-2xl">
        <!-- Screen -->
        <div class="relative h-[798px] w-[369px] overflow-hidden rounded-[40px] bg-white">
          <!-- Dynamic island / notch -->
          <div class="absolute left-1/2 top-[10px] z-30 h-[26px] w-[100px] -translate-x-1/2 rounded-full bg-slate-950"></div>

          <!-- Status bar -->
          <div class="relative z-10 flex items-center justify-between px-7 pt-4 pb-2 text-[13px] font-semibold text-slate-900">
            <span>9:43</span>
            <span class="flex items-center gap-1.5">
              <svg class="h-3 w-4" viewBox="0 0 20 12" fill="currentColor">
                <rect x="0" y="7" width="3" height="5" rx="0.5" />
                <rect x="5" y="5" width="3" height="7" rx="0.5" />
                <rect x="10" y="3" width="3" height="9" rx="0.5" />
                <rect x="15" y="0" width="3" height="12" rx="0.5" />
              </svg>
              <svg class="h-3 w-4" viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M1 5c5-4.5 13-4.5 18 0" stroke-linecap="round" />
                <path d="M4.2 8.2c3.4-3 8.2-3 11.6 0" stroke-linecap="round" />
                <circle cx="10" cy="12" r="1.2" fill="currentColor" stroke="none" />
              </svg>
              <svg class="h-3 w-6" viewBox="0 0 25 12" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="0.5" y="0.5" width="20" height="11" rx="2.5" />
                <rect x="2" y="2" width="15" height="8" rx="1.2" fill="currentColor" stroke="none" />
                <path d="M22 4v4a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 22 4Z" fill="currentColor" stroke="none" />
              </svg>
            </span>
          </div>

          <!-- Nav header -->
          <header class="flex items-center gap-2 px-5 pt-1 pb-3">
            <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M15 5 8 12l7 7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <h1 class="flex-1 text-[17px] font-bold leading-tight text-slate-950">Второй участник</h1>
            <span class="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-brand">
              Европротокол &middot; 1/5
            </span>
          </header>

          <!-- Scrollable content -->
          <section class="space-y-4 overflow-y-auto px-5 pb-6" style="height: 606px;">
            <p class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Гос. номер второго ТС
            </p>

            <div class="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
              <div>
                <p class="text-2xl leading-none font-bold text-slate-950">01 B</p>
                <p class="mt-1 text-2xl leading-none font-bold text-slate-950">740 KA</p>
                <p class="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="m5 13 4 4L19 7" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  Найден в НАПП
                </p>
              </div>
              <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M4 8a2 2 0 0 1 2-2h1l1.2-2h7.6L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke-linejoin="round" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </div>
            </div>

            <div class="divide-y divide-slate-100 rounded-2xl border border-slate-100">
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm text-slate-500">Марка / модель</span>
                <span class="text-sm font-semibold text-slate-900">Chevrolet Spark</span>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm text-slate-500">Страховщик</span>
                <span class="text-sm font-semibold text-slate-900">NEO INSURANCE</span>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm text-slate-500">Полис ОСАГО</span>
                <span class="text-sm font-semibold text-slate-900">№ 6610288</span>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm text-slate-500">Действует до</span>
                <span class="text-sm font-semibold text-slate-900">31.01.2027</span>
              </div>
              <div class="flex items-center justify-between px-4 py-3">
                <span class="text-sm text-slate-500">Полис действителен</span>
                <span class="text-sm font-semibold text-emerald-600">Да</span>
              </div>
            </div>

            <p class="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Данные водителя (скан прав)
            </p>
            <div class="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5 20c1.4-3.6 4.2-5.4 7-5.4s5.6 1.8 7 5.4" stroke-linecap="round" />
                </svg>
              </div>
              <div class="flex-1">
                <p class="text-sm font-semibold text-slate-900">Р. Сабиров</p>
                <p class="text-xs text-slate-500">В/у AC 1974957 &middot; категория B</p>
              </div>
              <span class="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">OCR</span>
            </div>
          </section>

          <!-- CTA -->
          <div class="absolute right-0 bottom-0 left-0 bg-white px-5 pt-3 pb-6">
            <button class="flex w-full items-center justify-between rounded-2xl bg-slate-950 px-5 py-4 text-sm font-semibold text-white">
              Далее &rarr; Обстоятельства ДТП
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
          </div>

          <!-- Home indicator -->
          <div class="absolute bottom-2 left-1/2 h-1 w-32 -translate-x-1/2 rounded-full bg-slate-900/20"></div>
        </div>
      </div>
    </main>
  </body>
</html>
`;

export const phoneFrameScreenTemplate: Template = {
  id: "phone-frame-screen",
  name: "Phone Frame Screen",
  kind: "mockup",
  description:
    "Mobile app screen mockup with a visible device bezel: rounded black " +
    "frame, dynamic-island notch, side buttons and home indicator, plus " +
    "status bar icons. Good when the mockup needs to visually read as a " +
    "real phone photo, not just an app screen crop.",
  expectedInputs: {
    screenTitle: "string — nav bar title, e.g. 'Второй участник'",
    badge: "string — top-right pill, e.g. 'Европротокол · 1/5'",
    plate: {
      primary: "string — first plate line, e.g. '01 B'",
      secondary: "string — second plate line, e.g. '740 KA'",
      verifiedLabel: "string — checkmark caption, e.g. 'Найден в НАПП'",
    },
    infoRows: [{ label: "string", value: "string" }],
    driver: {
      name: "string",
      docLabel: "string — e.g. 'В/у AC 1974957 · категория B'",
      badge: "string — e.g. 'OCR'",
    },
    ctaLabel: "string — bottom button label, e.g. 'Далее → Обстоятельства ДТП'",
  },
  exampleCode,
};
