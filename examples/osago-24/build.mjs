import { writeFile } from "node:fs/promises";

const WORLD_WIDTH = 8700;
const WORLD_HEIGHT = 3190;
const STAGE_STEP = 700;

const stageNames = [
  "ДТП",
  "Безопасность + оферта",
  "Сотрудничество",
  "Приглашение",
  "Web consent",
  "MyID",
  "Evidence",
  "AI-протокол",
  "Признание вины",
  "Решение + карта",
  "Выплата",
  "Документы D+3",
];
const lanes = [
  ["culprit", "Виновник · EAI app", "primary", 0, 700],
  ["victim", "Потерпевший · web eai.uz", "secondary", 710, 700],
  ["automation", "Автоматизация EAI", "automation", 1420, 280],
  ["support", "Поддержка / call-центр", "support", 1710, 400],
  ["granite", "Granite", "system", 2120, 440],
  ["external", "Внешние системы", "external", 2570, 280],
  ["exceptions", "Исключения / retry / регресс", "exception", 2860, 310],
].map(([id, label, role, y, h]) => ({
  id,
  label,
  role,
  rect: { x: 0, y, w: WORLD_WIDTH, h },
}));
const stages = stageNames.map((label, index) => ({
  id: `s${index + 1}`,
  index,
  label,
  rect: { x: 180 + index * STAGE_STEP, y: 0, w: 690, h: WORLD_HEIGHT },
}));
const anchors = [
  { id: "top", side: "top", offset: 0.5 },
  { id: "right", side: "right", offset: 0.5 },
  { id: "bottom", side: "bottom", offset: 0.5 },
  { id: "left", side: "left", offset: 0.5 },
];
const iframe = [];
const native = [];
const edges = [];
const maturities = [
  "live",
  "live",
  "live",
  "live",
  "live",
  "live",
  "partial",
  "partial",
  "live",
  "partial",
  "live",
  "to-be",
];
function screen(owner, id, stage, lane, title, slot = 0) {
  const geometry =
    lane === "granite"
      ? { w: 650, h: 422, y: 2135, viewport: { width: 1040, height: 602 } }
      : lane === "support"
        ? { w: 600, h: 373, y: 1725, viewport: { width: 1000, height: 543 } }
        : {
            w: 248,
            h: 645,
            y: lane === "culprit" ? 45 : 755,
            viewport: { width: 310, height: 748 },
          };
  iframe.push({
    id: `${owner}-${id}`,
    kind: "iframe",
    laneId: lane,
    stageId: `s${stage}`,
    rect: {
      x: 205 + (stage - 1) * STAGE_STEP + slot * 270,
      y: geometry.y,
      w: geometry.w,
      h: geometry.h,
    },
    caption: { title, tag: owner === "victim" ? "WEB" : owner.toUpperCase() },
    maturity: maturities[stage - 1],
    anchors,
    source: {
      entrypoint: "/src/screens/runtime.html",
      route: `#/${owner}/${id}`,
    },
    viewport: geometry.viewport,
    frame: { kind: "none", radius: 0, fit: "contain" },
    sandbox: ["allow-scripts", "allow-forms"],
    permissions: [],
    activation: "double-click",
  });
}
const culprit = [
  ["scene", 1, "Оформить ДТП"],
  ["safety", 2, "Безопасность и оферта"],
  ["cooperation", 3, "Сотрудничество"],
  ["invite", 4, "QR потерпевшему"],
  ["qr", 5, "QR и web-сессия"],
  ["evidence", 7, "Фото с места"],
  ["protocol", 8, "AI-реконструкция"],
  ["sign", 9, "Признание вины"],
  ["documents", 12, "Документы D+3"],
];
culprit.forEach(([id, s, t]) => {
  screen("culprit", id, s, "culprit", t);
});
const victim = [
  ["qr", 5, "Оферта и web-сессия"],
  ["identity", 6, "MyID · login", 0],
  ["identity-face", 6, "MyID · face", 1],
  ["evidence", 7, "Повреждения"],
  ["protocol", 8, "AI-реконструкция"],
  ["decision", 10, "Сумма и карта"],
  ["paid", 11, "Зачисление"],
  ["documents", 12, "Документы D+3"],
];
victim.forEach(([id, s, t, slot = 0]) => {
  screen("victim", id, s, "victim", t, slot);
});
stageNames.forEach((name, i) => {
  screen("granite", `stage-${i + 1}`, i + 1, "granite", `Granite · ${name}`);
});
[
  ["qr", 5, "QR support"],
  ["evidence", 7, "Evidence support"],
  ["payout", 11, "Payout support"],
].forEach(([id, s, t]) => {
  screen("support", id, s, "support", t);
});
function n(id, stage, lane, title, text, shape = "automation", maturity = maturities[stage - 1]) {
  const y = { automation: 1480, external: 2635, exceptions: 2925 }[lane];
  native.push({
    id,
    kind: "native",
    shape,
    laneId: lane,
    stageId: `s${stage}`,
    rect: { x: 215 + (stage - 1) * STAGE_STEP, y, w: 600, h: 165 },
    caption: { title },
    maturity,
    anchors,
    body: { text },
  });
}
n("policy-check", 2, "automation", "Policy engine", "Покрытие, лимиты, критерии европротокола");
n(
  "session-orchestrator",
  4,
  "automation",
  "Session orchestrator",
  "QR → браузерная сессия без установки",
);
n("identity-gate", 6, "automation", "Identity gate", "MyID применяется только к потерпевшему");
n("evidence-ai", 7, "automation", "Evidence quality", "Camera-only, GPS и контроль ракурсов");
n(
  "reconstruction-ai",
  8,
  "automation",
  "Reconstruction AI",
  "Схема ДТП и проверка согласованности",
);
n("damage-ai", 10, "automation", "Damage AI", "Оценка ущерба, antifraud и решение");
n("auto-payout", 11, "automation", "Automatic payout", "Токен карты и автоматическое перечисление");
n("ersp", 2, "external", "ERSP НАПП", "Проверка полиса и регистрация события", "registry");
n("uzum", 11, "external", "Uzum", "Токенизация и карточная выплата", "service");
n("one-c", 11, "external", "1C", "Проводки и сверка", "service");
n(
  "d3-archive",
  12,
  "external",
  "Архив документов",
  "Пакет документов формируется D+3",
  "registry",
  "to-be",
);
n(
  "qr-retry",
  4,
  "exceptions",
  "QR retry",
  "Повторная ссылка / помощь оператора",
  "note",
  "partial",
);
n(
  "photo-retry",
  7,
  "exceptions",
  "Evidence retry",
  "Пересъёмка некачественного ракурса",
  "note",
  "partial",
);
n(
  "payment-retry",
  11,
  "exceptions",
  "Payment retry",
  "Повтор выплаты и ручная сверка",
  "note",
  "partial",
);
n(
  "regress",
  12,
  "exceptions",
  "Регресс",
  "Если условия D+3 не выполнены — регрессная ветка",
  "note",
  "to-be",
);
function connect(id, a, b, label, kind = "main", waypoints) {
  edges.push({
    id,
    source: { nodeId: a, anchorId: "right" },
    target: { nodeId: b, anchorId: "left" },
    kind,
    route: { type: "orthogonal", ...(waypoints ? { waypoints } : {}) },
    ...(label ? { label: { text: label, position: 0.5 } } : {}),
  });
}
for (const owner of ["culprit", "victim", "granite"]) {
  const seq = iframe
    .filter((x) => x.id.startsWith(`${owner}-`))
    .sort((a, b) => Number(a.stageId.slice(1)) - Number(b.stageId.slice(1)));
  seq.slice(1).forEach((node, i) => {
    connect(
      `${owner}-flow-${i}`,
      seq[i].id,
      node.id,
      owner === "victim" && i === 0 ? "QR → web" : "next",
    );
  });
}
connect("qr-victim", "culprit-qr", "victim-qr", "без установки", "actor");
connect("myid-only", "victim-qr", "identity-gate", "MyID только потерпевшему", "sync");
connect("identity-result", "identity-gate", "victim-identity", "KYC", "sync");
connect("photos-ai", "culprit-evidence", "evidence-ai", "camera-only", "sync");
connect("reconstruct", "evidence-ai", "reconstruction-ai", "AI", "sync");
connect("guilt-signed", "culprit-sign", "damage-ai", "вина признана", "sync");
connect("tokenize", "victim-decision", "uzum", "token", "external");
connect("pay", "auto-payout", "victim-paid", "автовыплата", "main");
connect("accounting", "uzum", "one-c", "сверка", "external");
connect("documents", "culprit-documents", "d3-archive", "D+3", "external");
connect("regress-path", "d3-archive", "regress", "условия не выполнены", "exception", [
  { x: 8350, y: 3040 },
  { x: 7940, y: 3040 },
]);
connect("qr-exception", "culprit-qr", "qr-retry", "retry", "exception");
connect("photo-exception", "evidence-ai", "photo-retry", "пересъёмка", "exception");
connect("payment-exception", "uzum", "payment-retry", "retry", "exception");
const doc = {
  version: 2,
  title: "OSAGO Fast Settlement",
  subtitle: "OSAGO 24 · native service blueprint with interactive product screens",
  theme: "osago-24",
  world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
  lanes,
  stages,
  labels: [
    {
      id: "title",
      text: "OSAGO 24 · FAST SETTLEMENT",
      rect: { x: 20, y: 10, w: 150, h: 40 },
      tone: "info",
    },
    {
      id: "d3",
      text: "D+3 / REGRESS",
      rect: { x: 8000, y: 3115, w: 500, h: 45 },
      tone: "warning",
      align: "center",
    },
  ],
  nodes: [...iframe, ...native],
  edges,
  legend: [
    {
      title: "Maturity",
      items: [
        { label: "LIVE", maturity: "live" },
        { label: "PARTIAL", maturity: "partial" },
        { label: "TO-BE", maturity: "to-be" },
      ],
    },
  ],
};
if (iframe.length !== 32) throw new Error(`expected 32 iframe nodes, got ${iframe.length}`);
await writeFile(new URL("canvas.json", import.meta.url), `${JSON.stringify(doc, null, 2)}\n`);
console.log(
  JSON.stringify({
    lanes: lanes.length,
    stages: stages.length,
    iframes: iframe.length,
    native: native.length,
    edges: edges.length,
  }),
);
