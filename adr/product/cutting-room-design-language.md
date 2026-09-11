---
id: cutting-room-design-language
title: Video Studio — язык «монтажной»: тёплая бумага, чернила, сигнальный красный, перфорация и штампы
status: reversed
date: 2026-09-11
deciders: [unknown]
area: product
applies_to:
  - apps/web/index.html
  - apps/web/src/styles/tokens.css
  - apps/web/src/styles/primitives/button.css
  - apps/web/src/styles/primitives/badge.css
  - apps/web/src/styles/primitives/section-header.css
  - apps/web/src/styles/primitives/empty-state.css
  - apps/web/src/styles/surfaces/video*.css
tags: [product, video-studio, design-language, css-only]
refs: [studio-palette-revert]
supersedes: []
superseded_by: []
---

## Контекст

После гомогенизации светлой темы студия выглядела как типовой SaaS:
голубые пилюли, мягкие пастельные заливки, скругления везде, Unbounded в
заголовках. Прямая жалоба: «ощущение AI-slop». При этом палитра
`--app-ink/paper/line/accent/success/warning` и шрифты body/mono связаны
контрактом с вьювером канваса (`tokens.test.ts`, SYNCED) — глобальную
перекраску делать нельзя.

## Решение

Студия — «монтажная» (cutting room), комната, в которую заходят: тёплая
бумага поверх общей, чернила, один сигнальный красный, киноплёночные
мотивы strictly на CSS, без единой правки TSX/DOM:

- дисплейный шрифт — Fraunces (оптическое выравнивание, редакторская
  антиква), моноширинный Plex Mono повышен до голоса подписей,
  таймкодов и номеров slate;
- primary-кнопка — чернильная печать с жёсткой тенью на hover,
  secondary — рамка вместо синего текста;
- бейджи — резиновые штампы: прозрачный фон, рамка 1.5px currentColor,
  квадратные углы; readiness-пилюли — повёрнутые зелёные штампы;
- сцены/шоты — slate-карточки: номерная плашка моно, загруженная сцена —
  чернильная рамка + жёсткая тень + красный номер;
- хлопушка (`--app-cut-clapper`) — верхняя кромка редактора сцены,
  контекста шота, screening room;
- перфорация (`--app-cut-sprocket-dot`) — binding edge навигатора сцен,
  киноплёночная рамка программного монитора;
- таймкоды, степпер, длина сиквенса — табличные моно-цифры;
- углы ужаты глобально (13/8/7/4 → 10/6/5/3), синхронные токены не тронуты.

Синий акцент сужен до своей контрактной роли: ссылки, фокус-кольца,
кодировка kind/ролей. `--app-danger` подогрет до сигнального
`#bf2a1c` (не sync-bound) — плейхед стал красным проводом записи.

## Последствия

CSS-only дифф: классы и DOM не менялись, тесты структуры зелёные по
определению. Кухня (`/dev/kitchen-sink`) — живая витрина языка
примитивов; поверхности студии проверяются чтением (бэкенда в
fixture/dev нет). Новые `--app-cut-*` токены задекларированы в
tokens.css — проверка undeclared-переменных их видит.
