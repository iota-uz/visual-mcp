---
id: token-efficient-structural-patches
title: Структурные правки используют атомарный batch, компактное чтение и единый state token
status: accepted
date: 2026-09-07
deciders: [diyorkhaydarov]
area: mcp
applies_to:
  - apps/mcp/src/tools.ts
  - apps/mcp/src/instructions.ts
  - apps/mcp/src/guides.ts
  - apps/mcp/test/**
  - packages/canvas/src/file-patch.ts
  - packages/canvas/test/file-patch.test.ts
tags: [mcp, token-budget, patches, concurrency]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

В Workbench-сессии `b00d6f3f-e19a-45e4-b7fd-5f6d20d2a2b0` изменение одного
подзаголовка потребовало полного чтения CanvasFile и всё равно не было выполнено.
Перестройка flow потребовала временно перенести prototype start, а перестановка
страниц — серии отдельных записей с полным списком страниц в каждом ответе.
Стоимость простого изменения росла вместе с размером canvas.

## Решение

Добавить `canvas_patch`: один типизированный batch атомарно меняет метаданные и
порядок Pages, CanvasDoc entities и prototype. Валидируется итоговый CanvasFile,
а не промежуточные состояния операций. Guard передаётся как непрозрачный `base`,
полученный из `canvas.state`; успешная запись возвращает следующий state.

`canvas_get` по умолчанию возвращает компактные метаданные. Полные theme/author/
embed поля требуют `response_mode:"full"`. `page_id + include:["doc"]` возвращает
выбранную Page и краткий индекс файла вместо полного содержимого всех Pages.
Mutation-инструменты для Pages возвращают state, числовые guards для старого
контракта и изменённый page id, а полный порядок остаётся в отдельном
`canvas_page_list`.

Текстовый дубль structuredContent сериализуется компактным JSON без
форматирующих пробелов. Структура и имена полей сохраняются для машинного чтения.

## Обоснование

Вход и выход микроправки должны зависеть от самой правки, а не от количества
страниц. Итоговая валидация сохраняет ссылочную целостность без фиктивных
промежуточных записей. Один state token уменьшает ошибки при переносе пары
version/draft_revision и остаётся строгим optimistic concurrency guard.

## Отклонённые альтернативы

- Полный generic execute tool: скрыл бы разные контракты файлов, assets, QA и
  публикации и противоречил бы task-shaped surface.
- Полный CanvasFile для любой правки: атомарен, но повторяет несвязанный контент.
- Автоматическое разрешение конфликтов: может незаметно перезаписать чужую работу.

## Последствия

Старые узкие операции сохраняются для одиночных жестов, но смешанные структурные
изменения должны идти через canvas_patch. State формат считается opaque для
клиентов. Полный canvas_get остаётся доступен явным запросом.

## Как проверить

Unit tests должны покрывать замену prototype start и его node в одном batch,
метаданные и полный порядок Pages. Transport tests проверяют схему, компактный
ответ и отсутствие полного массива Pages в mutation-ответах.
