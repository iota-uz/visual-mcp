---
id: local-character-animation-storybook
title: Локальный Storybook исполняет production character renderer покадрово
status: accepted
date: 2026-09-12
deciders: [unknown]
area: process
applies_to:
  - package.json
  - apps/web/package.json
  - apps/web/.storybook/**
  - apps/web/src/dev/character-animation-lab/**
tags: [video, animation, characters, storybook, development]
refs:
  - запрос пользователя
supersedes: []
superseded_by: []
---

## Контекст

Semantic character animation проверялась через Timeline и полный video render.
Этого достаточно для интеграции, но слишком медленно для покадровой настройки
таймингов, blend windows и плавности переходов между действиями.

## Решение

Добавить локальный Storybook со специализированным Character Animation Lab.
Стенд импортирует тот же browser-safe `CharacterScene`, character packs и frame
evaluator, которые используются Timeline preview и production worker. Каждое
semantic action и важные сочетания действий представлены отдельными stories с
playback, покадровым перемещением, scrubber и параметрами тайминга.

Storybook остаётся dev-only поверхностью приложения и не входит в production
bundle или пользовательский Video Studio. Для запуска и статической проверки
предоставляются root scripts `storybook` и `build:storybook`.

## Обоснование

Один renderer исключает расхождение между лабораторией и итоговым видео, а
изолированные stories сокращают цикл «увидеть артефакт — изменить параметры —
проверить границы перехода». Покадровый seek делает результат детерминированным
и пригодным для регрессионной проверки.

## Отклонённые альтернативы

Отдельный упрощённый mascot preview отклонён, потому что его геометрия и mixer
неизбежно разойдутся с production. Запуск полного MP4 render для каждого
изменения отклонён как слишком медленный цикл настройки.

## Последствия

Character renderer и runtime должны оставаться browser-safe. Новое semantic
action или preset считается полностью представленным в локальном контуре после
добавления story. Публикация Storybook и user-level animation controls этим
решением не вводятся.

## Как проверить

Запустить `npm run storybook`, открыть `http://localhost:6006`, проверить
одиночные действия и переходы через play, frame step и scrubber. Затем выполнить
`npm run build:storybook`, web typecheck и тесты animation lab.
