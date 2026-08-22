import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTailwindCss } from "../../packages/runtime/dist/render/playwright-renderer/tailwind.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const screensDir = path.join(here, "src", "screens");
const referencePath =
  process.env.OSAGO_REFERENCE_INDEX ||
  "/Users/diyorkhaydarov/Library/Mobile Documents/com~apple~CloudDocs/Granite/billing/quotes/osago-fast-settlement/netlify-drop/index.html";
const source = await readFile(referencePath, "utf8");

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Reference marker missing: ${startMarker}`);
  return source.slice(start, end);
}

const style = between("  <style>\n", "  </style>")
  .replace(/^ {2}<style>\n/, "")
  .replaceAll('url("../assets/', 'url("../../assets/')
  .replaceAll("url('../assets/", "url('../../assets/")
  .replaceAll('url("./', 'url("../../assets/')
  .replaceAll("url('./", "url('../../assets/");
const core = between("    const commonSteps =", "    let activeIndex = 0;").replaceAll(
  'src="./',
  'src="../../assets/',
);
const supportRenderer = between(
  "      function renderSupportConsole",
  "      /* Обзорный слой",
).replaceAll('src="./', 'src="../../assets/');

const templates = `${core}\nlet activeIndex = 0;\nlet activeFlowKey = "culprit";\nlet activeFlow = flows.culprit;\n${supportRenderer}

const routeAliases = {
  culprit: { scene:"scene", safety:"safety", cooperation:"cooperation", invite:"invite", qr:"qr", evidence:"evidence", protocol:"protocol", sign:"sign", documents:"documents" },
  victim: { qr:"qr", evidence:"evidence", protocol:"protocol", decision:"decision", paid:"paid", documents:"documents" },
};
const exceptionPolicy = {
  qr:{ kind:"auto", owner:"victim", title:"Авто-повтор", retry:"3 токена · 10 мин, затем выход", detail:"Старый токен инвалидируется, QR обновляется", userDetail:"Ссылка обновляется, попросите второго водителя показать новый QR" },
  evidence:{ kind:"user", owner:"both", title:"Действие водителя", retry:"без лимита · окно 20 мин", detail:"Переснять кадр камерой своей сессии", userDetail:"Переснимите кадр — снимок получился нечитаемым" },
  paid:{ kind:"auto", owner:"victim", title:"Авто-повтор платежа", retry:"3 попытки · 15 мин, затем оператор", detail:"Реквизиты уточняются, платёж повторяется", userDetail:"Банк не принял перевод с первого раза, пробуем снова" },
};
const supportStages = {
  qr:{ reason:"Потерпевший не открыл сессию", code:"WEB_SESSION_TIMEOUT", last:"04 · Способ приглашения", confirmed:"Оферта виновника v1.4 · 09:41:18", other:"Потерпевший: не подключён", next:"Показать QR заново или отправить ссылку по SMS" },
  evidence:{ reason:"Кадр не прошёл проверку качества", code:"MEDIA_QUALITY_LOW", last:"06 · Личность потерпевшего", confirmed:"MyID потерпевшего · 09:46:02", other:"Виновник: 4 из 4 кадров приняты", next:"Переснять общий план камерой сессии" },
  paid:{ reason:"Банк отклонил перевод", code:"PAYOUT_DECLINED_57", last:"10 · Сумма и карта", confirmed:"Решение 8 640 000 сум · 10:18:44", other:"Виновник: действий не требуется", next:"Указать другую карту на имя потерпевшего" },
};
function extractScreen(html, selector) {
  const host = document.createElement("div");
  host.innerHTML = html;
  const screen = host.querySelector(selector);
  if (!screen) throw new Error("Reference screen did not render: " + selector);
  return screen.outerHTML;
}
export function renderReferenceScreen(owner, id) {
  if (owner === "culprit") {
    const key = routeAliases.culprit[id];
    return key && polishedTemplates[key] ? { mode:"phone", html:'<div class="phone">' + polishedTemplates[key]() + '</div>' } : null;
  }
  if (owner === "victim") {
    if (id === "identity") return { mode:"phone", html:'<div class="phone">' + myidLoginScreen() + '</div>' };
    if (id === "identity-face") return { mode:"phone", html:'<div class="phone">' + myidFaceScreen() + '</div>' };
    const key = routeAliases.victim[id];
    return key && victimTemplates[key] ? { mode:"phone", html:'<div class="phone">' + victimTemplates[key]() + '</div>' } : null;
  }
  if (owner === "granite") {
    const index = Number(id.replace("stage-", "")) - 1;
    const item = flows.culprit.steps[index];
    if (!item) return null;
    return { mode:"granite", html:extractScreen(renderGraniteWorkspace(item, stageOps[item.screen]), ".granite-window") };
  }
  if (owner === "support") {
    const screen = id === "payout" ? "paid" : id;
    const index = flows.culprit.steps.findIndex((item) => item.screen === screen);
    const item = flows.culprit.steps[index];
    const support = supportStages[screen];
    const policy = exceptionPolicy[screen];
    if (!item || !support || !policy) return null;
    return { mode:"support", html:extractScreen(renderSupportConsole(item, stageOps[screen], support, policy, index + 1), ".granite-window") };
  }
  return null;
}
`;

await writeFile(path.join(screensDir, "reference-templates.js"), templates);
const tailwind = await buildTailwindCss('@import "tailwindcss";', screensDir);
const fonts = `
@font-face { font-family:"Manrope"; src:url("../../assets/fonts/Manrope-wght.ttf") format("truetype"); font-style:normal; font-weight:200 800; font-display:block; }
@font-face { font-family:"Unbounded"; src:url("../../assets/fonts/Unbounded-wght.ttf") format("truetype"); font-style:normal; font-weight:200 900; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../../assets/fonts/IBMPlexMono-Regular.ttf") format("truetype"); font-style:normal; font-weight:400; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../../assets/fonts/IBMPlexMono-Medium.ttf") format("truetype"); font-style:normal; font-weight:500; font-display:block; }
@font-face { font-family:"IBM Plex Mono"; src:url("../../assets/fonts/IBMPlexMono-SemiBold.ttf") format("truetype"); font-style:normal; font-weight:600 700; font-display:block; }
`;
const embed = `
html,body { width:100%; height:100%; min-height:0; margin:0; overflow:hidden; background:transparent; }
body.osago-screen-embed { display:block; background:transparent; }
#app { width:100%; height:100%; overflow:hidden; }
body.embed-phone #app > .phone { width:310px; max-width:none; margin:0; }
body.embed-phone .phone-screen { height:720px; }
body.embed-phone .phone-content { animation:none; transform:none; }
body.embed-granite .granite-window { width:1040px; max-width:none; border:0; border-radius:0; }
body.embed-granite .granite-shell { min-width:0; min-height:560px; }
body.embed-support .granite-window { width:1000px; max-width:none; border:0; border-radius:0; }
body.embed-support .granite-shell { min-width:0; min-height:543px; }
.mobile-action,.myid-continue,.g-btn { cursor:pointer; }
`;
const runtimeCss = `${fonts}\n${tailwind}\n${style}\n${embed}`;
await writeFile(path.join(screensDir, "runtime.css"), runtimeCss);
console.log(
  JSON.stringify({
    reference: referencePath,
    cssBytes: Buffer.byteLength(runtimeCss),
    templateBytes: Buffer.byteLength(templates),
  }),
);
