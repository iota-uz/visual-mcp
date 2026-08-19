import { writeFile } from "node:fs/promises";

const WORLD_WIDTH = 8700;
const WORLD_HEIGHT = 3690;
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
  ["people", "Участники · кто действует на этом шаге", "actors", 0, 490],
  ["culprit", "Виновник · EAI app", "primary", 500, 700],
  ["victim", "Потерпевший · web eai.uz", "secondary", 1210, 700],
  ["automation", "Автоматизация EAI", "automation", 1920, 280],
  ["support", "Поддержка / call-центр", "support", 2210, 400],
  ["granite", "Granite", "system", 2620, 440],
  ["external", "Внешние системы", "external", 3070, 280],
  ["exceptions", "Исключения / retry / регресс", "exception", 3360, 310],
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
const actors = [];
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
const phoneTimes = {
  "culprit/scene": "09:40",
  "culprit/safety": "09:41",
  "culprit/cooperation": "09:42",
  "culprit/invite": "09:42",
  "culprit/qr": "09:42",
  "culprit/evidence": "09:44",
  "culprit/protocol": "09:51",
  "culprit/sign": "09:55",
  "culprit/documents": "10:22",
  "victim/qr": "09:43",
  "victim/identity": "1:01",
  "victim/identity-face": "1:01",
  "victim/evidence": "09:48",
  "victim/protocol": "09:51",
  "victim/decision": "10:18",
  "victim/paid": "10:21",
  "victim/documents": "10:24",
};
function screen(owner, id, stage, lane, title, slot = 0) {
  const geometry =
    lane === "granite"
      ? { w: 650, h: 422, y: 2635, viewport: { width: 1040, height: 602 } }
      : lane === "support"
        ? { w: 600, h: 373, y: 2225, viewport: { width: 1000, height: 543 } }
        : {
            w: 248,
            h: 614,
            y: lane === "culprit" ? 545 : 1255,
            viewport: { width: 284, height: 642 },
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
    anchors:
      owner === "victim" && ["qr", "identity", "evidence", "decision", "paid", "documents"].includes(id)
        ? [...anchors, { id: "actor-in", side: "left", offset: 0.10852713178294573 }]
        : anchors,
    source: {
      entrypoint: "/src/screens/runtime.html",
      route: `#/${owner}/${id}`,
    },
    viewport: geometry.viewport,
    frame:
      lane === "culprit" || lane === "victim"
        ? { kind: "phone", time: phoneTimes[`${owner}/${id}`] ?? "09:42" }
        : { kind: "none", radius: 0, fit: "contain" },
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
  const y = { automation: 1980, external: 3135, exceptions: 3425 }[lane];
  actors.push({
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
const actorSteps = [
  ["culprit", 1, "scene", "подтверждает, что находится на месте ДТП", 1, 9, true],
  ["culprit", 2, "safety", "подтверждает совместимость и принимает оферту", 2, 9, true],
  ["culprit", 3, "cooperation", "выбирает совместное оформление с потерпевшим", 3, 9, true],
  ["culprit", 4, "invite", "выбирает QR и язык web-сессии", 4, 9, true],
  ["victim", 5, "qr", "сканирует QR → принимает оферту на eai.uz", 1, 8, true],
  ["culprit", 5, "qr", "показывает QR из EAI app", 5, 9, true],
  ["victim", 6, "identity", "проходит MyID как получатель выплаты", 2, 8, true],
  ["victim", 7, "evidence", "снимает повреждения", 3, 8, true],
  ["culprit", 7, "evidence", "снимает место и авто", 6, 9, true],
  ["culprit", 9, "sign", "ставит галочку признания вины", 8, 9, true],
  ["victim", 10, "decision", "получает сумму решения и вводит PAN", 5, 8, true],
  ["victim", 11, "paid", "получает деньги на карту", 6, 8, true],
  ["victim", 12, "documents", "досылает свой пакет до D+3", 7, 8, true],
  ["culprit", 12, "documents", "досылает свой пакет до D+3", 8, 9, false],
];
for (const [owner, stage, _screenId, text, value, total, current] of actorSteps) {
  const victimActor = owner === "victim";
  const title = victimActor ? "Потерпевший" : "Виновник";
  const tag = victimActor ? "web eai.uz" : "EAI app";
  native.push({
    id: `s${stage}-actor-${owner}`,
    kind: "native",
    shape: "actor",
    laneId: "people",
    stageId: `s${stage}`,
    rect: { x: 399 + (stage - 1) * STAGE_STEP, y: victimActor ? 82 : 242, w: 300, h: 132 },
    caption: { title, subtitle: `Этап ${stage}`, tag },
    maturity: "live",
    anchors: [
      ...anchors,
      { id: "screen", side: "bottom", offset: victimActor ? 0.08666666666666667 : 0.5 },
    ],
    body: { text, progress: { value, total, current } },
    inspector: {
      eyebrow: `ЭТАП ${stage} · ${title.toUpperCase()}`,
      title,
      copy: `Действие участника на этом этапе: ${text}.`,
      points: [
        text,
        victimActor
          ? "Работает в браузере на eai.uz, приложение не устанавливает"
          : "Работает в авторизованном приложении EAI",
      ],
    },
  });
}
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
function actorScreenEdge(owner, stage, screenId, text) {
  const victimActor = owner === "victim";
  const actorId = `s${stage}-actor-${owner}`;
  const screenNodeId = `${owner}-${screenId}`;
  edges.push({
    id: `${actorId}-screen`,
    source: { nodeId: actorId, anchorId: "screen" },
    target: { nodeId: screenNodeId, anchorId: victimActor ? "actor-in" : "top" },
    kind: "actor",
    route: victimActor
      ? {
          type: "orthogonal",
          waypoints: [
            { x: 425 + (stage - 1) * STAGE_STEP, y: 236 },
            { x: 217 + (stage - 1) * STAGE_STEP, y: 236 },
            { x: 217 + (stage - 1) * STAGE_STEP, y: 1325 },
          ],
        }
      : { type: "bezier" },
    label: {
      text,
      position: victimActor ? 0.36 : 0.5,
      offset: { x: victimActor ? 263 : 300, y: 0 },
    },
  });
}
function actorPair(stage, text) {
  edges.push({
    id: `s${stage}-actor-pair`,
    source: { nodeId: `s${stage}-actor-victim`, anchorId: "bottom" },
    target: { nodeId: `s${stage}-actor-culprit`, anchorId: "top" },
    kind: "actor",
    route: { type: "bezier" },
    bidirectional: true,
    label: { text, position: 0.5, offset: { x: 220, y: 0 } },
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
delete edges.at(-1).label.position;
for (const [owner, stage, screenId, text] of actorSteps) {
  actorScreenEdge(owner, stage, screenId, text);
}
actorPair(5, "показывает QR ↔ открывает web-сессию и принимает оферту");
actorPair(7, "каждый снимает свою часть материалов");
actorPair(12, "каждый досылает свой пакет до D+3");
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
  { x: 8350, y: 3540 },
  { x: 7940, y: 3540 },
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
      rect: { x: 20, y: 510, w: 150, h: 40 },
      tone: "info",
    },
    {
      id: "d3",
      text: "D+3 / REGRESS",
      rect: { x: 8000, y: 3615, w: 500, h: 45 },
      tone: "warning",
      align: "center",
    },
  ],
  nodes: [...iframe, ...actors, ...native],
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
    native: native.length + actors.length,
    edges: edges.length,
  }),
);
