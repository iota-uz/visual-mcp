/** Content-only screen for CanvasDoc frame.kind=\"phone\". */
import type { Template } from "../types.js";

const exampleCode = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=284,initial-scale=1" />
    <style>
      @import "tailwindcss";
      * { box-sizing: border-box; }
      html, body { width: 284px; height: 642px; margin: 0; overflow: hidden; }
      body { font: 12px/1.45 Manrope, Arial, sans-serif; color: #07111f; background: #f5f8fc; }
      main { height: 100%; display: flex; flex-direction: column; padding: 18px 16px 14px; }
      .eyebrow { margin: 0 0 7px; color: #6b7d91; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 0; max-width: 230px; font-size: 22px; line-height: 1.05; letter-spacing: -.035em; }
      .card { margin-top: 18px; padding: 15px; border: 1px solid #dbe5ef; border-radius: 15px; background: white; box-shadow: 0 10px 24px rgba(6,27,54,.08); }
      .card strong { display: block; margin-bottom: 5px; font-size: 14px; }
      .card p { margin: 0; color: #62758a; }
      button { margin-top: auto; width: 100%; border: 0; border-radius: 13px; padding: 14px; color: white; background: #1172ee; font: 800 12px Manrope, Arial, sans-serif; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Европротокол · шаг 1 из 5</p>
      <h1>Вы сейчас на месте ДТП?</h1>
      <section class="card">
        <strong>Да, я на месте</strong>
        <p>Продолжим оформление и соберём данные участников.</p>
      </section>
      <button type="button" onclick="this.textContent='Готово'">Продолжить</button>
    </main>
  </body>
</html>`;

export const phoneFrameScreenTemplate: Template = {
  id: "phone-frame-screen",
  name: "Canvas Phone Screen",
  kind: "mockup",
  description:
    "Content-only 284×642 iframe screen for CanvasDoc frame.kind='phone'. " +
    "The canvas supplies the canonical dark OSAGO bezel, notch and status bar; " +
    "never add phone shell or status chrome inside this HTML.",
  expectedInputs: {
    canvasNode:
      "iframe node with viewport { width: 284, height: 642 } and frame { kind: 'phone', time: '09:42' }",
    screenTitle: "string — app-screen heading",
    body: "structured screen content only; no device bezel, notch or status bar",
    ctaLabel: "string — primary action label",
  },
  exampleCode,
};
