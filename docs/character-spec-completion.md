# Исходная спецификация: закрытие требований

Источник: `farq_agent_native_animation_engine_spec.docx`, разделы 20–24.
Рабочий статус, 2026-09-12. Реализация не равна визуальной приёмке или деплою.

| Требование | Реализация | Проверка/остаток |
| --- | --- | --- |
| 1 Farq + 2 покупателя | Общий data-driven renderer, customer и customer-energetic | Catalog/schema tests; motion review ожидается |
| 10–15 эмоций, 15–25 жестов | 14 эмоций, 22 жеста; крупные mouth/brow/eye/posture channels | Runtime tests проходят; строгая пятисторонняя facial-only blind-проверка на 320 px ещё не принята |
| Look/blink/talk/idle/enter/exit/bounce | Семантические действия и числовые tracks | Unit tests, нужен финальный motion review |
| 6–8 visemes + alignment | 6 visemes, provider alignment → speech windows → рот | Две настоящие ElevenLabs реплики с pinned audio/alignment включены в локальный рендер; perceptual sync не принят |
| 5–8 фонов, 10–15 props | 6 фонов, 13 props | Схемы и clone isolation, 3 aspect ratios |
| Камера и эффекты | Последовательности cut/frame/pan/push/pull/follow/shake/hold; 5 seeded VFX | Runtime tests; frame/video review ожидается |
| AST + TypeScript facade | at/after/with/hold, compound refs, секундная компиляция | Unit tests, assembly regression |
| Процедурное расширение | Restricted math AST → baked numeric tracks | Adversarial input и bounded evaluation tests |
| Постоянная библиотека actions | Project-local, SHA-256 revisions, explicit workspace promotion | Проверены isolation/auth, hash verification, idempotency, promotion, удаление project-local definitions |
| Диалог, слушатель, audio plan | say + gaze/listener reactions; Timeline/audio_mix/ducking | Реальный 25-секундный H264/AAC рендер, identical decoded PCM между повторами; прослушивание не заменено тестами |
| MCP authoring/inspection | Compile/validate/migrate/library tools + existing render/frame/contact sheet/patch | Resource/schema examples, strict errors, pinned alignment hash и action hash проверены тестами |
| Миграции | Явный @3 → @4, без скрытого latest/fallback | Настоящий старый AST сохранён в tracked fixture и проверен; @1/@2 не поддерживаются |
| Preview/cache/диагностика | Профили draft360/draft540/preview720/final1080, bounds/text/mouth/camera checks, bounded whole-render cache | Cache проверяет build/input hashes, corruption/TTL/limits; повторный render ещё проверяется |

## Приёмка MVP — не отмечать по наличию функций

- [x] Валидный 25-секундный пример по brief без ручного keyframing (procedural curve запекается автоматически).
- [ ] Два говорящих персонажа: реальный звук, паузы, взгляд и рот.
- [ ] Не менее пяти визуально различимых эмоций/реакций без аудио.
- [x] Reviewer обнаружил clipping в контрольном кадре; исправление только epilogue, dialogue hash сохранён. Проверка ограничена данным кадром.
- [x] Два рендера неизменённого input совпадают в принятом codec tolerance: минимум SSIM 0.999507 при пороге 0.999. Не побайтовая идентичность.
- [x] Custom action определён один раз и используется во второй сцене.
- [ ] Farq узнаваем в малом размере и вертикальном видео.

Не входят: Blender/3D, anatomical human rig, cloth/physics, marketplace,
длинные видео >5 минут, новый пользовательский timeline GUI.

## Границы утверждений

- Контактные листы и отдельные кадры не доказывают плавность, качество речи или lip sync.
- Bounds QA использует консервативные pack AABB, а не точную видимую SVG-силуэтную геометрию.
- Кэшируется полный native render с точным ключом; отдельные кэши TTS,
  viseme compilation, static SVG и unchanged sub-scenes из §19.1 не добавлены.
  Этот раздел спецификации перечисляет возможности оптимизации, не все они нужны для MVP.
- Повторяемость проверяется отдельно от кэша, реальными повторными рендерами.
  Совпадение AST или выдача уже закэшированного MP4 не являются таким тестом.
- Производственная публикация и человеческая рекламная приёмка не выполнены этим документом.

## Проверки реализации (2026-09-12)

- `packages/video`: 52 теста; worker: 119 тестов; MCP: 122 теста.
- Convex: 241 тест, включая 5 проверок immutable character library.
- Timeline preview и локальная animation lab: 24 теста.
- Typecheck video/worker проходит. Общий typecheck checkout пока не проходит
  из-за параллельно редактируемых workspace/inbox/search файлов, не относящихся
  к движку; это не считается успешной проверкой всей сборки.
- Регрессии отдельно покрывают активный интервал priority, тождественные
  scale/opacity до начала трека, weighted locomotion, соседние camera moves,
  hash tampering и ограниченную стоимость вычисления 36 последовательных moves.

## Локальные доказательства приёмки

Артефакты намеренно находятся в ignored `output/`, не являются production assets.

Для повторения: `npm run render:character-acceptance -- path/to/pinned-voices.json --render --repeat`.
Указать новую пустую папку через `ACCEPTANCE_OUTPUT_DIR`, чтобы не перезаписать
доказательства предыдущего прогона. Вход содержит локальное аудио и настоящие
provider alignment artifacts с hashes; сам runner ничего не генерирует платно.

- Финальный кандидат: `output/character-spec-acceptance/runs/20260912-final-runtime-freeze-v5/acceptance.mp4`.
  SHA-256: `4359122afcfbf6d85748a1fb4a7fb2e3e722df9f8bf883ca4aff0c95a0ec6d2d`.
  1080×1920, 30 fps, 750 кадров; контейнер с AAC 48 kHz stereo — 25.024 s.
- В той же папке `render-receipt.json`, `determinism-receipt.json`,
  `still-determinism-receipt.json`, `supplemental-validation-receipt.json`.
  Пять отдельных PNG samples идентичны, decoded audio PCM идентичен;
  decoded video не идентичен. Причина небольших расхождений не доказана
  для каждого кадра; SSIM показывает ограниченную величину различий.
- Точное исправление контрольного дефекта:
  `output/character-spec-acceptance/runs/20260912-scoped-epilogue-fix/fixed-epilogue-receipt.json`.
  Независимый critic проверил fixed PNG `6fd82f6256e54803dd38746023e03f2bd9dc0fc64b373a8d3f9feaf32d631406`
  на frame 60: clipping устранён. Пустая центральная панель осталась замечанием
  к композиции fixture, не скрыта как «полная рекламная приёмка».
- `fixed-epilogue-receipt.json` внутри **v5** не использовать как доказательство
  scoped patch исходного bad fixture: между ними менялся dialogue fixture.
  Для scoped проверки предназначена только отдельная папка `20260912-scoped-epilogue-fix`.
- Дополнительная строгая проверка пяти изолированных facial states без жестов
  сохранена в `output/character-emotion-blind-stills/20260912-distinction-v3`.
  Farq узнаваем во всех пяти 320 px кадрах, но critic всё ещё смешивает отдельные
  пары. Это не скрывается за более слабым утверждением о наличии 14 presets.
