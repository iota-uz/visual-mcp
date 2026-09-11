---
id: studio-palette-revert
title: Палитра студии возвращена к холодной — тёплая «монтажная» не зашла
status: accepted
date: 2026-09-11
deciders: [unknown]
area: product
applies_to:
  - apps/web/src/styles/tokens.css
  - apps/web/src/styles/primitives/button.css
  - apps/web/src/styles/primitives/empty-state.css
  - apps/web/src/styles/surfaces/video*.css
tags: [product, video-studio, design-language, css-only]
refs: [cutting-room-design-language]
supersedes: []
superseded_by: []
---

## Контекст

Запись `cutting-room-design-language` ввела тёплую палитру поверх холодной
контрактной: bench wash, slate cards, tape, сигнальный красный вместо
danger. Вердикт пользователя: редизайн выглядит хуже, часть вещей норм.
Решение — вернуть старые цвета, остальное пока оставить.

## Решение

Чисто цветовой откат, структура/типографика/мотивы живут дальше:

- `--app-danger` и `--app-grid-dot` — старые значения, `--app-cut-*`
  токены удалены (остался нейтральный `--app-stripes` для хлопушек);
- primary/secondary, пилюли, readiness, пресеты таймлайна, callout —
  старые accent/success пастели и фоны;
- остаются: Fraunces как дисплейный, моно-кикеры и табличные цифры,
  ужатые радиусы, stamp-шейпы бейджей и плашек, хлопушки (ink/white),
  перфорация монитора в цвете line, press-физика кнопок.
