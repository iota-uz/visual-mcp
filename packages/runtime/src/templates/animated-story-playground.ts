import type { Template } from "../types.js";
import { templateMetadata } from "./metadata.js";

/**
 * A deliberately self-contained screen. Canvas documents own the file and
 * sandbox; the first animation pilot must not depend on a CDN, a worker or a
 * video project before we know the visual language is worth productising.
 */
const exampleCode = `const html = String.raw\`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Farq animated story pilot</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; overflow: hidden; background: #150f0a; }
      svg { display: block; width: 100vw; height: 100vh; }
      .copy { font-family: Arial, sans-serif; }
      .scene-label { fill: #fff5e9; font-size: 26px; font-weight: 700; letter-spacing: .02em; }
      .caption { fill: #fff5e9; font-size: 36px; font-weight: 700; text-anchor: middle; }
      .small { fill: #2b1508; font-size: 22px; font-weight: 700; text-anchor: middle; }
      .cta-label { fill: #211108; font-size: 28px; font-weight: 700; text-anchor: middle; }
      @media (prefers-reduced-motion: reduce) { #stage { animation: none !important; } }
    </style>
  </head>
  <body>
    <svg viewBox="0 0 720 1280" role="img" aria-labelledby="title desc">
      <title id="title">Farq animated story pilot</title>
      <desc id="desc">A deterministic fourteen second 2D animation: a customer finds a price, Farq compares it, then reveals a lower price.</desc>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2f1710"/><stop offset="1" stop-color="#120d0a"/></linearGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="20"/></filter>
      </defs>
      <rect width="720" height="1280" fill="url(#sky)" />
      <circle cx="610" cy="154" r="124" fill="#ff8128" opacity=".14" filter="url(#soft)" />
      <path d="M0 835 C150 780 250 900 398 838 S622 770 720 830 V1280 H0Z" fill="#24130d" />
      <path d="M0 918 C160 850 298 973 450 897 S614 874 720 927 V1280 H0Z" fill="#1c100c" />
      <g id="stage"></g>
      <g class="copy"><text x="54" y="76" class="scene-label">Farq / animation pilot</text><text id="caption" x="360" y="1150" class="caption"></text></g>
    </svg>
    <script>
      const stage = document.getElementById('stage');
      const caption = document.getElementById('caption');
      const NS = 'http://www.w3.org/2000/svg';
      const el = (name, attrs = {}) => { const node = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; };
      const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
      const ease = value => 1 - Math.pow(1 - clamp(value), 3);
      const between = (time, from, to) => ease((time - from) / (to - from));
      const sine = (time, rate = 1) => Math.sin(time * Math.PI * 2 * rate);
      const group = (id) => { const node = el('g', { id }); stage.append(node); return node; };

      const customer = group('customer');
      customer.append(el('ellipse', { cx: 0, cy: 116, rx: 100, ry: 22, fill: '#080504', opacity: .34 }));
      customer.append(el('circle', { cx: 0, cy: 0, r: 104, fill: '#f5e9d7' }));
      const customerEyeL = el('circle', { cx: -34, cy: -10, r: 28, fill: '#fff' }); const customerEyeR = el('circle', { cx: 34, cy: -10, r: 28, fill: '#fff' }); customer.append(customerEyeL, customerEyeR);
      const customerPupilL = el('circle', { r: 11, fill: '#25160d' }); const customerPupilR = el('circle', { r: 11, fill: '#25160d' }); customer.append(customerPupilL, customerPupilR);
      const customerMouth = el('path', { fill: 'none', stroke: '#25160d', 'stroke-width': 9, 'stroke-linecap': 'round' }); customer.append(customerMouth);
      const customerArm = el('path', { fill: 'none', stroke: '#f5e9d7', 'stroke-width': 24, 'stroke-linecap': 'round' }); customer.append(customerArm);

      const mascot = group('mascot');
      mascot.append(el('ellipse', { cx: 0, cy: 130, rx: 116, ry: 24, fill: '#080504', opacity: .34 }));
      mascot.append(el('circle', { cx: -56, cy: -28, r: 50, fill: '#ff7a1a' })); mascot.append(el('circle', { cx: 56, cy: 28, r: 50, fill: '#ff7a1a' }));
      mascot.append(el('path', { d: 'M-84 84 L84 -84', stroke: '#ff7a1a', 'stroke-width': 34, 'stroke-linecap': 'round' }));
      mascot.append(el('circle', { cx: 0, cy: 0, r: 87, fill: '#fff8ee', stroke: '#1b100b', 'stroke-width': 9 }));
      const mascotEyeL = el('circle', { cx: -29, cy: -12, r: 24, fill: '#fff' }); const mascotEyeR = el('circle', { cx: 29, cy: -12, r: 24, fill: '#fff' }); mascot.append(mascotEyeL, mascotEyeR);
      const mascotPupilL = el('circle', { r: 10, fill: '#24140c' }); const mascotPupilR = el('circle', { r: 10, fill: '#24140c' }); mascot.append(mascotPupilL, mascotPupilR);
      const mascotMouth = el('path', { fill: 'none', stroke: '#24140c', 'stroke-width': 9, 'stroke-linecap': 'round' }); mascot.append(mascotMouth);
      const armL = el('path', { fill: 'none', stroke: '#ff7a1a', 'stroke-width': 23, 'stroke-linecap': 'round' }); const armR = el('path', { fill: 'none', stroke: '#ff7a1a', 'stroke-width': 23, 'stroke-linecap': 'round' }); mascot.append(armL, armR);

      const cards = group('price-cards');
      const card = (x, amount, tint) => { const g = el('g'); g.append(el('rect', { x: -126, y: -92, width: 252, height: 184, rx: 30, fill: '#fff8ee' })); g.append(el('rect', { x: -126, y: -92, width: 252, height: 52, rx: 30, fill: tint })); const label = el('text', { x: 0, y: -58, class: 'small' }); label.textContent = 'Тот же телефон'; const value = el('text', { x: 0, y: 25, class: 'small', 'font-size': 31 }); value.textContent = amount; g.append(label, value); g.setAttribute('transform', 'translate(' + x + ' 0)'); return g; };
      cards.append(card(-145, '1 249 000', '#ffd7b9')); cards.append(card(145, '999 000', '#ff7a1a'));

      function face(left, right, mouth, a, b, mood, time) {
        left.setAttribute('cx', a - 29); left.setAttribute('cy', b - 12); right.setAttribute('cx', a + 29); right.setAttribute('cy', b - 12);
        mouth.setAttribute('d', mood === 'shock' ? 'M-20 38 Q0 66 20 38 Q0 16 -20 38' : mood === 'talk' ? 'M-24 39 Q0 ' + (48 + 14 * Math.sin(time * Math.PI * 14)) + ' 24 39' : 'M-24 34 Q0 56 24 34');
      }
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const blink = (time, offset) => { const phase = (time + offset) % 3.8; return phase < .13 ? Math.max(.08, Math.abs(phase - .065) / .065) : 1; };
      const eyes = (left, right, pupilL, pupilR, x, y, openness) => { left.setAttribute('transform', 'translate(' + x + ' ' + y + ') scale(1 ' + openness + ') translate(' + -x + ' ' + -y + ')'); right.setAttribute('transform', 'translate(' + -x + ' ' + y + ') scale(1 ' + openness + ') translate(' + x + ' ' + -y + ')'); pupilL.setAttribute('opacity', openness); pupilR.setAttribute('opacity', openness); };
      const start = performance.now();
      function render(now) {
        const elapsed = (now - start) / 1000;
        const t = reducedMotion ? 12.2 : Math.min(elapsed, 13.999);
        const enter = between(t, .4, 2.1); const reveal = between(t, 4.4, 5.2); const shock = between(t, 6.1, 6.65); const explain = between(t, 8.0, 10.4); const cta = between(t, 11.0, 12.1);
        const mx = 890 - enter * 478; const my = 648 + (1 - enter) * 36 - Math.abs(sine(t, 1.3)) * 8;
        const cx = 183 - shock * 33; const cy = 744 - Math.abs(sine(t, .32)) * 5;
        mascot.setAttribute('transform', 'translate(' + mx + ' ' + my + ') rotate(' + (sine(t, .6) * 3) + ') scale(' + (1 + Math.abs(sine(t, 1.3)) * .025) + ' ' + (1 - Math.abs(sine(t, 1.3)) * .025) + ')');
        customer.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') rotate(' + (-shock * 13 + sine(t,.24)*2) + ') scale(' + (1 + shock * .1) + ' ' + (1 - shock * .09) + ')');
        face(mascotPupilL, mascotPupilR, mascotMouth, explain * 9, 0, explain ? 'talk' : 'smile', t);
        face(customerPupilL, customerPupilR, customerMouth, shock * 14, shock * -4, shock > .2 ? 'shock' : 'smile', t);
        eyes(mascotEyeL, mascotEyeR, mascotPupilL, mascotPupilR, -29, -12, blink(t, .45));
        eyes(customerEyeL, customerEyeR, customerPupilL, customerPupilR, -34, -10, blink(t, 1.7));
        armL.setAttribute('d', 'M-70 42 Q-136 ' + (66 - explain * 72) + ' -154 ' + (140 - explain * 96)); armR.setAttribute('d', 'M70 42 Q142 ' + (44 - explain * 110) + ' 165 ' + (122 - explain * 75));
        customerArm.setAttribute('d', 'M76 42 Q' + (132 + shock * 24) + ' ' + (20 - shock * 95) + ' 168 ' + (84 - shock * 130));
        cards.setAttribute('transform', 'translate(420 ' + (390 + (1 - reveal) * 70) + ') scale(' + reveal + ')'); cards.setAttribute('opacity', reveal);
        const scale = 1 + cta * .12; const old = document.getElementById('cta'); if (old) old.remove();
        if (cta) { const g = el('g', { id: 'cta', transform: 'translate(360 1018) scale(' + scale + ')' }); g.append(el('rect', { x: -222, y: -43, width: 444, height: 86, rx: 43, fill: '#ff7a1a' })); const text = el('text', { x: 0, y: 12, class: 'cta-label' }); text.textContent = 'Сравни цены до покупки'; g.append(text); stage.append(g); }
        caption.textContent = t < 3.7 ? 'Нашёл отличную цену!' : t < 7.8 ? 'Но есть цена ниже.' : t < 11 ? 'Один товар. Разные цены.' : '';
        if (!reducedMotion && elapsed < 14) requestAnimationFrame(render);
      }
      requestAnimationFrame(render);
    </script>
  </body>
</html>\`;

canvas_save({
  ref: "demo/farq-animation-pilot",
  kind: "canvas",
  title: "Farq animated story pilot",
  html,
  viewport: { width: 720, height: 1280 }
});`;

export const animatedStoryPlaygroundTemplate: Template = {
  ...templateMetadata("animated-story-playground"),
  id: "animated-story-playground",
  name: "Animated Story Playground",
  kind: "canvas",
  description:
    "A self-contained vertical Farq animation pilot: deterministic SVG acting, price reveal, camera-safe staging and a complete 14-second story inside one Canvas screen.",
  expectedInputs: {
    ref: "canvas ref for the private pilot",
    viewport: "vertical 720×1280 screen",
    output: "interactive Canvas iframe; use it to judge motion before building Video Studio controls",
  },
  exampleCode,
};
