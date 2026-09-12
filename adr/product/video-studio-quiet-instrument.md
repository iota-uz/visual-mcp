---
id: video-studio-quiet-instrument
title: Video Studio — тихий инструмент Visual Canvas, тёмная шахта 9:16 в Review
status: accepted
date: 2026-09-11
deciders: [diyorkhaydarov]
area: product
applies_to:
  - apps/web/src/routes/VideoStudio.tsx
  - apps/web/src/components/video/VideoDraftStudio.tsx
  - apps/web/src/components/video/VideoReview.tsx
  - apps/web/src/components/video/VideoPlayer.tsx
  - apps/web/src/components/video/review/**
  - apps/web/src/styles/tokens.css
  - apps/web/src/styles/surfaces/video.css
  - apps/web/src/styles/surfaces/video-shell.css
  - apps/web/src/styles/surfaces/video-review.css
tags: [product, video-studio, design-language, review]
refs: [cutting-room-design-language, studio-palette-revert, video-studio-workbench]
supersedes: [studio-palette-revert]
superseded_by: []
---

## Контекст

После жалобы на AI-slop студию одели в костюм «монтажной» (Fraunces,
штампы, хлопушка, перфорация, тёплая бумага). Пользователь вернул
холодную палитру: редизайн выглядел хуже. Откат оставил костюм на месте.
Review (`/v/:id?mode=review`) остался карточным документом с кикером,
серифом и полоской хлопушки вокруг плеера. Повторная костюмная тема
запрещена.

Контрактные `--app-ink/paper/line/accent/success/warning` и body/mono
синхронизированы с вьювером канваса. Глобальную перекраску делать нельзя.

## Решение

Студия — тихий инструмент того же продукта, что и `/c/:id`: Manrope,
бумага, чернила, command bar. Личность не в новом бренде, а в ремесле
и одном материале.

Review — просмотровая, не страница настроек с роликом:

- картинка 9:16 занимает комнату; вокруг неё тихий хром;
- единственный запоминающийся жест — тёмная шахта (`--app-well` = ink)
  только вокруг кадра, не dark theme всего Review;
- статус, язык, длительность живут один раз, не в кикере, бейдже,
  шапке плеера и футере одновременно;
- кандидаты — filmstrip, не ряд карточек;
- Review занимает workbench (status + шахта + заметки), а не документ
  под оболочкой черновика;
- approval остаётся двухшаговым (чекбокс, затем кнопка) и привязан к
  exact MP4.

Снять с поверхностей Review и общего хрома студии: Fraunces, ALL-CAPS
кикеры, хлопушку, `--app-stripes`, hover-lift кнопок. Глобальные
`.badge` / `.btn`, Home, Canvas и sidebar в этом решении не трогать.
Story / Shots / Timeline получают тот же язык отдельным проходом после
приёмки Review.

## Обоснование

Прошлый проход добавил декорацию на SaaS-скелет. Distinctiveness у
вертикального ролика farq.uz — сам кадр в шахте, а не сериф и штампы.
Холодная палитра уже принята пользователем; её оставляем.

## Отклонённые альтернативы

Ещё один CSS-only костюм (тёплая бумага, кислотный тёмный, бродшит).
Полностью тёмный Review. Новая display-гарнитура. Смена синхронизированных
токенов. Авто-approval и полноценный NLE.

## Последствия

`studio-palette-revert` остаётся историей цветового отката; его указание
оставить Fraunces, штампы и хлопушки заменяется этим решением.
`video-studio-workbench` не меняется: режимы, exact-MP4 approval,
annotation как отдельный режим, Production — drawer.

## Как проверить

Локальный стек, Review: play, кадр, заметка, approval после просмотра;
stale / partial / пустой render; desktop и 390 px; reduced motion без
hover-lift. Story / Shots / Timeline в этом проходе визуально те же.
