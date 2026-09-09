# ADR — Architecture & Product Decision Records

<!--
Git records what changed. This append-only ledger records why durable product
and architecture choices exist, so later optimization does not silently undo
them. Records live in adr/<area>/<slug>.md and are newest first per area.

Add a record in the same change as a lasting decision. Supersede; never rewrite
or delete history. Full rules: .claude/rules/adr.md
-->

## mcp

- **Структурные правки используют атомарный batch, компактное чтение и единый state token** — [запись](adr/mcp/token-efficient-structural-patches.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **HTML авторится напрямую через MCP, краткая форма разворачивается в canvas на сервере** — [запись](adr/mcp/direct-html-authoring.md) · accepted · 2026-09-06 (запрос сопровождающего)
- **Файловые MCP-операции пакетируются внутри одной задачи, а поиск остаётся отдельным инструментом** — [запись](adr/mcp/bounded-batch-file-operations.md) · accepted · 2026-09-01 (агентский аудит и запрос сопровождающего)
- **Общий контракт маршрутизации повторяется в каждом описании инструмента ради свежести контекста** — [запись](adr/mcp/repeated-routing-contract-for-context-freshness.md) · accepted · 2026-08-23 (`12e0d20`, подтверждено сопровождающим 2026-09-01)
- **MCP сохраняет task-shaped инструменты и progressive disclosure** — [запись](adr/mcp/task-shaped-tools-and-progressive-disclosure.md) · accepted · 2026-08-23 (`12e0d20`)
- **Стабильный ref, идемпотентное сохранение и явные guards образуют контракт записи** — [запись](adr/mcp/stable-refs-idempotency-and-concurrency-guards.md) · accepted · 2026-08-14 (`335551a`, `bb844dc`)

## canvas

- **Обложка канваса — схематичный постер из геометрии, денормализованный в строку** — [запись](adr/canvas/canvas-poster-from-geometry.md) · accepted · 2026-09-08 (`7068dcf`)
- **Sticky notes — коллекция notes[] в CanvasDoc без высоты и с проставляемым автором** — [запись](adr/canvas/sticky-notes-collection.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **Стрелки используют общую геометрию, автоматические порты и явные ограничения** — [запись](adr/canvas/controllable-obstacle-aware-arrows.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **CanvasFile v3 разделяет долговечный draft, именованные checkpoints и опубликованную ревизию** — [запись](adr/canvas/drafts-checkpoints-and-published-revisions.md) · accepted · 2026-08-21 (`b0fa76a`, `3cce739`)

## assets

- **Медиа из `/assets` становится переиспользуемым, SVG доверяется, audio не поддерживается** — [запись](adr/assets/unified-assets-and-media-boundaries.md) · accepted · 2026-08-29 (`4b2b09a`, `bbf7703`)

## sharing

- **Публичное встраивание — статическая PNG-карточка со ссылкой, а не iframe-viewer** — [запись](adr/sharing/static-preview-cards-not-embedded-viewers.md) · accepted · 2026-08-25 (`d67a728`)

## auth

- **Доступ ограничен организацией, права общие внутри неё, MCP tokens живут 90 дней** — [запись](adr/auth/org-wide-access-and-expiring-mcp-tokens.md) · accepted · 2026-08-14 (`55dd64a`, `9a73635`)

## platform

- **Экспорт из браузера рендерит snapshot worker через Convex action, кэш по draft revision** — [запись](adr/platform/browser-export-via-snapshot-worker.md) · accepted · 2026-09-07 (план, утверждённый пользователем)
- **Convex хранит данные и обслуживает BFF, а stateless MCP работает в Railway** — [запись](adr/platform/convex-bff-railway-mcp-boundary.md) · accepted · 2026-08-23 (`688d884`)
- **`run_code` сохраняет `node:vm` и network egress как принятый риск** — [запись](adr/platform/run-code-network-risk-is-accepted.md) · accepted · 2026-08-09 (`9a73635`)
- **Продукт использует hosted remote MCP; локальный stdio runtime удалён** — [запись](adr/platform/hosted-remote-mcp-only.md) · accepted · 2026-08-09 (`0bf0e03`, `9a73635`)

## product

- **Карта канваса — прицел, затем commit; hover не двигает камеру** — [запись](adr/product/canvas-minimap-aim-then-commit.md) · accepted · 2026-09-09 (запрос сопровождающего)
- **Комментарий якорится к элементу по data-vc-id, а не к процентам кадра** — [запись](adr/product/element-id-comment-anchors.md) · accepted · 2026-09-09 (запрос сопровождающего)
- **Комментарий якорится к точке внутри ноды и перетаскивается** — [запись](adr/product/in-node-comment-anchors.md) · superseded · 2026-09-09 (запрос сопровождающего)
- **Списковые экраны — карточка-ссылка целиком, действия в меню ⋯, удаление жёсткое** — [запись](adr/product/workspace-and-canvas-lists.md) · accepted · 2026-09-08 (`aea8d2c`…`81a12c3`)
- **Человек авторит на канвасе два вида контента — sticky notes и заголовок ноды** — [запись](adr/product/human-authored-canvas-content.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **Play, Download и Rename живут в caption ноды, в контекстном меню и в inspector** — [запись](adr/product/canvas-node-actions.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **Inspector и Exit якорятся к выбранной ноде в screen space** — [запись](adr/product/canvas-node-anchored-inspector.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **Правый клик открывает короткое меню существующих операций focused-editor** — [запись](adr/product/canvas-context-menu.md) · accepted · 2026-09-07 (запрос сопровождающего)
- **Агент авторит CanvasDoc и артефакты двух форматов, человек получает сфокусированный редактор** — [запись](adr/product/agent-authored-dual-format-canvas.md) · accepted · 2026-08-09 (`9a73635`)

## process

- **Решения ведутся в append-only ADR ledger, отдельном от истории реализации** — [запись](adr/process/architecture-decisions-ledger.md) · accepted · 2026-09-01 (запрос сопровождающего)
- **Convex публикуется только после сборки workspace-пакетов** — [запись](adr/process/build-packages-before-convex-push.md) · accepted · 2026-08-23 (`ad825c6`)
- **Агенты проверяют продукт на изолированном локальном стеке, не на live deployment** — [запись](adr/process/isolated-local-agent-stack.md) · accepted · 2026-08-19 (`ab375fd`)
- **Green-field изменения заменяют старую модель целиком, если совместимость не запрошена** — [запись](adr/process/greenfield-no-compatibility-by-default.md) · accepted · 2026-08-19 (`96f6f6f`, `aa89089`)
