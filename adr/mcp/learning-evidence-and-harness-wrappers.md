---
date: 2026-09-10
status: accepted
---

# Evidence, offline evaluation и разные harness wrappers

## Решение

Принятый пользователем план выполняется как context/loop engineering: reasoning
остаётся в Codex/Claude Code, а сервер хранит типизированные состояния, CAS,
неизменяемые версии, атрибуцию и ограниченные циклы. Сервер не изображает
нативный агентный harness через вызов отдельной model API.

`workflow-contract-v1` исполняет реальные переходы Convex в изолированных
транзакциях и откатывает fixture-записи через проверенный внутренний sentinel.
Отчёт содержит фактические assertions и ограничения. Это проверка контрактов,
не оценка визуального качества. `evidence-consistency-v1` отдельно проверяет
зарегистрированные отчёты, development/heldout разделение и регрессии; он не
подменяет end-to-end performance evaluation. Неизвестный code revision остаётся
null, пока release runner не прикрепит доказанную provenance.

Memory proposals не становятся правилами по одному ролику: нужны независимые
проекты, media/report hashes, сопоставимая rubric policy и evidence из обоих
split. Неустранённое противоречие блокирует promotion. Текущие указания человека
всегда выше памяти. Публикация записывается как attributed metadata с историей
исправлений; analytics сохраняют null, определения метрик и окна, не заявляя
неподтверждённую причинность или миллионы просмотров.

Общая логика навыков — `.agents/skills/<name>/workflow.md`. Codex получает свою
обёртку в `.agents/skills`, Claude — отдельную в `.claude/skills` с относительным
симлинком к shared workflow. Отдельный image skill создаётся только для Claude.
Codex использует встроенную image generation и verified upload при подходящей
задаче. Файлы critic profiles имеют разные форматы: Codex TOML и Claude Markdown
frontmatter. Sandbox/read-only файлов не считается автоматическим запретом MCP
writes; effective tools/permissions проверяются в реальном harness.

## Основания и проверка

Официальные контракты проверены 2026-09-10:
[Codex subagent schema](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agent-file-schema),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Claude subagents](https://code.claude.com/docs/en/sub-agents),
[Claude skills](https://code.claude.com/docs/en/skills).
Пять skill wrappers проходят штатный skill validator, три shared symlinks
разрешаются. Проверка формата не доказывает поведение агента: native harness
steering trials, реальная provider/media проверка и human preview остаются
отдельными release evidence.

## Совместимость

Старые Canvas upload signatures сохраняются. Новый проверяемый lifecycle имеет
отдельные имена `asset_upload_reserve/status/finalize`; обе MCP поверхности
переиспользуют одни domain handlers. Старые ADR и полный архив плана не
переписываются; этот ADR уточняет исполняемые границы текущей реализации.
