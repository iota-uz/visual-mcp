const SHIFT_Y = 500;
const ACTOR_WIDTH = 300;
const ACTOR_HEIGHT = 132;
const ACTOR_X_OFFSET = 24;
const VICTIM_Y = 82;
const CULPRIT_Y = 242;

const progressStages = {
  victim: [5, 6, 7, 8, 10, 11, 12, 13],
  culprit: [1, 2, 3, 4, 5, 7, 8, 9, 13],
};

const interactions = {
  s1: { culprit: ["culprit-scene", "подтверждает, что находится на месте ДТП"] },
  s2: { culprit: ["culprit-safety", "подтверждает совместимость и принимает оферту"] },
  s3: { culprit: ["culprit-cooperation", "выбирает совместное оформление с потерпевшим"] },
  s4: { culprit: ["culprit-invite", "выбирает QR и язык web-сессии"] },
  s5: {
    victim: ["victim-qr", "сканирует QR → принимает оферту на eai.uz"],
    culprit: ["culprit-qr", "показывает QR из EAI app"],
    pair: "показывает QR ↔ открывает web-сессию и принимает оферту",
  },
  s6: { victim: ["victim-identity", "проходит MyID как получатель выплаты"] },
  s7: {
    victim: ["victim-evidence", "снимает повреждения"],
    culprit: ["culprit-evidence", "снимает место и авто"],
    pair: "каждый снимает свою часть материалов",
  },
  s9: { culprit: ["culprit-sign", "ставит галочку признания вины"] },
  s10: { victim: ["victim-decision", "получает сумму решения и вводит PAN"] },
  s11: { victim: ["victim-paid", "получает деньги на карту"] },
  s12: {
    victim: ["victim-documents", "досылает свой пакет до D+3"],
    culprit: ["culprit-documents", "досылает свой пакет до D+3"],
    pair: "каждый досылает свой пакет до D+3",
  },
};

const anchors = [
  { id: "top", side: "top", offset: 0.5 },
  { id: "right", side: "right", offset: 0.5 },
  { id: "bottom", side: "bottom", offset: 0.5 },
  { id: "left", side: "left", offset: 0.5 },
];

export function addParticipantActors(input) {
  const doc = structuredClone(input);
  if (!doc.lanes.some((lane) => lane.id === "people")) {
    doc.world.height += SHIFT_Y;
    for (const lane of doc.lanes) lane.rect.y += SHIFT_Y;
    doc.lanes.unshift({
      id: "people",
      label: "Участники · кто действует на этом шаге",
      role: "actors",
      rect: { x: 0, y: 0, w: doc.world.width, h: 490 },
    });
    for (const stage of doc.stages) stage.rect.h += SHIFT_Y;
    for (const label of doc.labels) label.rect.y += SHIFT_Y;
    for (const node of doc.nodes) node.rect.y += SHIFT_Y;
    for (const edge of doc.edges) {
      for (const point of edge.route.waypoints ?? []) point.y += SHIFT_Y;
    }
  }

  doc.edges = doc.edges.filter((edge) => !/^s\d+-actor-/.test(edge.id));
  if (!doc.edges.some((edge) => edge.id === "qr-victim")) {
    doc.edges.push({
      id: "qr-victim",
      source: { nodeId: "culprit-qr", anchorId: "right" },
      target: { nodeId: "victim-qr", anchorId: "left" },
      kind: "actor",
      route: { type: "orthogonal" },
      label: { text: "без установки" },
    });
  }

  for (const stage of doc.stages) {
    const stageInteractions = interactions[stage.id];
    if (!stageInteractions) continue;
    const actorIds = {};
    for (const role of ["victim", "culprit"]) {
      const interaction = stageInteractions[role];
      if (!interaction) continue;
      const [targetId, action] = interaction;
      const label = role === "victim" ? "Потерпевший" : "Виновник";
      const surface = role === "victim" ? "web eai.uz" : "EAI app";
      const id = `${stage.id}-actor-${role}`;
      actorIds[role] = id;
      const displayIndex = stage.index + 1;
      const ownProgress = progressStages[role];
      const progress = {
        value: ownProgress.filter((step) => step <= displayIndex).length,
        total: ownProgress.length,
        current: ownProgress.includes(displayIndex),
      };
      const rect = {
        x: stage.rect.x + (stage.rect.w - ACTOR_WIDTH) / 2 + ACTOR_X_OFFSET,
        y: role === "victim" ? VICTIM_Y : CULPRIT_Y,
        w: ACTOR_WIDTH,
        h: ACTOR_HEIGHT,
      };
      const actorAnchors = [
        ...structuredClone(anchors),
        { id: "screen", side: "bottom", offset: role === "victim" ? 26 / ACTOR_WIDTH : 0.5 },
      ];
      const actorNode = {
        id,
        kind: "native",
        shape: "actor",
        actorRole: role === "victim" ? "subject" : "counterparty",
        laneId: "people",
        stageId: stage.id,
        rect,
        caption: { title: label, subtitle: `Этап ${displayIndex}`, tag: surface },
        maturity: "live",
        anchors: actorAnchors,
        body: { text: action, progress },
        inspector: {
          eyebrow: `ЭТАП ${displayIndex} · ${label.toUpperCase()}`,
          title: label,
          copy: `Действие участника на этом этапе: ${action}.`,
          points: [
            action,
            role === "victim"
              ? "Работает в браузере на eai.uz, приложение не устанавливает"
              : "Работает в авторизованном приложении EAI",
          ],
        },
      };
      const existingActorIndex = doc.nodes.findIndex((node) => node.id === id);
      if (existingActorIndex === -1) doc.nodes.push(actorNode);
      else doc.nodes[existingActorIndex] = actorNode;

      const target = doc.nodes.find((node) => node.id === targetId);
      if (!target) throw new Error(`OSAGO actor target not found: ${targetId}`);
      const route = { type: role === "victim" ? "orthogonal" : "bezier" };
      let targetAnchorId = "top";
      if (role === "victim") {
        const actorIn = { id: "actor-in", side: "left", offset: 70 / target.rect.h };
        const existingAnchor = target.anchors.findIndex((anchor) => anchor.id === actorIn.id);
        if (existingAnchor === -1) target.anchors.push(actorIn);
        else target.anchors[existingAnchor] = actorIn;
        targetAnchorId = "actor-in";
        const sourceX = rect.x + 26;
        const sourceY = rect.y + rect.h;
        const targetY = target.rect.y + 70;
        const gutterX = stage.rect.x + 37;
        route.waypoints = [
          { x: sourceX, y: sourceY + 22 },
          { x: gutterX, y: sourceY + 22 },
          { x: gutterX, y: targetY },
        ];
      }
      doc.edges.push({
        id: `${stage.id}-actor-${role}-screen`,
        source: { nodeId: id, anchorId: "screen" },
        target: { nodeId: targetId, anchorId: targetAnchorId },
        kind: "actor",
        route,
        label: {
          text: action,
          position: role === "victim" ? 0.36 : 0.5,
          offset: role === "victim" ? { x: 263, y: 0 } : { x: 300, y: 0 },
        },
      });
    }
    if (stageInteractions.pair && actorIds.victim && actorIds.culprit) {
      doc.edges.push({
        id: `${stage.id}-actor-pair`,
        source: { nodeId: actorIds.victim, anchorId: "bottom" },
        target: { nodeId: actorIds.culprit, anchorId: "top" },
        kind: "actor",
        route: { type: "bezier" },
        bidirectional: true,
        label: { text: stageInteractions.pair, position: 0.5, offset: { x: 220, y: 0 } },
      });
    }
  }
  return doc;
}
