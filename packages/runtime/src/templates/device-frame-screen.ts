/** Content-only web page for CanvasDoc frame.kind="device". */
import type { Template } from "../types.js";

const exampleCode = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      @import "tailwindcss";
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; }
      body { font: 14px/1.5 Manrope, Arial, sans-serif; color: #0b1b2f; background: #fff; }
      header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #e6ecf3; }
      header b { font-size: 15px; letter-spacing: -.02em; }
      header nav { display: flex; gap: 14px; color: #5d7086; }
      .hero { padding: 28px 18px 22px; }
      .hero p { margin: 0 0 8px; color: #6b7d91; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      .hero h1 { margin: 0 0 12px; font-size: 26px; line-height: 1.1; letter-spacing: -.035em; }
      .hero a { display: inline-block; border-radius: 12px; padding: 12px 18px; color: #fff; background: #1172ee; font-weight: 800; text-decoration: none; }
      .cards { display: grid; gap: 12px; padding: 0 18px 28px; }
      .card { padding: 15px; border: 1px solid #dbe5ef; border-radius: 15px; background: #fff; box-shadow: 0 10px 24px rgba(6,27,54,.07); }
      .card strong { display: block; margin-bottom: 4px; }
      .card span { color: #62758a; font-size: 13px; }
      @media (min-width: 900px) { .cards { grid-template-columns: repeat(3, 1fr); } .hero h1 { font-size: 44px; max-width: 620px; } }
    </style>
  </head>
  <body>
    <header><b>Acme</b><nav>Product · Pricing · Docs</nav></header>
    <section class="hero">
      <p>Claims, settled today</p>
      <h1>File a claim from the road in four minutes.</h1>
      <a href="#start">Start a claim</a>
    </section>
    <section class="cards">
      <article class="card"><strong>Photo intake</strong><span>Guided capture with instant quality checks.</span></article>
      <article class="card"><strong>Instant estimate</strong><span>Repair costs before you leave the scene.</span></article>
      <article class="card"><strong>Direct payout</strong><span>Money lands the same working day.</span></article>
    </section>
  </body>
</html>`;

export const deviceFrameScreenTemplate: Template = {
  id: "device-frame-screen",
  name: "Canvas Device Screen",
  kind: "mockup",
  description:
    "Content-only web page for CanvasDoc frame.kind='device'. The canvas draws the device " +
    "itself: preset 'iphone-safari' gives an iPhone body with the iOS status bar and Safari " +
    "controls, preset 'desktop-safari' gives a Safari window. Never draw a bezel, status bar " +
    "or browser toolbar inside this HTML — it would render inside the real one.",
  expectedInputs: {
    canvasNode:
      "iframe node with frame { kind: 'device', preset: 'iphone-safari' | 'desktop-safari', " +
      "display?: 'clip' | 'full-height', url?: 'acme.example' }. Omit viewport: the preset " +
      "supplies 284x590 (mobile) or 1280x800 (desktop). Only display:'full-height' may set a " +
      "taller viewport, which renders the whole page inside the shell without cropping.",
    pageContent: "ordinary interactive HTML — the screen is a live iframe, not a screenshot",
    breakpoints: "one document that works at both preset widths; example uses a 900px query",
  },
  exampleCode,
};
