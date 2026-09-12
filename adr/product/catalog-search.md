---
id: catalog-search
title: Поиск на Home ищет названия, ноды — вторая группа
status: accepted
date: 2026-09-12
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/routes/Home.tsx
  - convex/search.ts
tags: [product, web-ui, search]
refs: []
supersedes: []
superseded_by: []
---

## Контекст

Поле на Home искало только текст нод канваса и прямо говорило, что названий канвасов нет. Видео и воркспейсы были невидимы.

## Решение

`search.searchMine` возвращает воркспейсы, канвасы, видео по названию, затем ноды. Пустой запрос не ищет. Результаты группируются, сетка воркспейсов возвращается при пустом поле.

## Обоснование

Человек ищет «osago» или «farq», а не внутренний заголовок ноды.

## Отклонённые альтернативы

Оставить node grep и добавить подсказку — это признание сломанной модели.

## Последствия

`canvases.searchNodes` остаётся для точечных вызовов; Home его больше не использует.

## Как проверить

`Home.test.tsx` и `convex/search.test.ts`.
