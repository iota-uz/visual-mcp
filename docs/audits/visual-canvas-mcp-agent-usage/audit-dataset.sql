-- Reproducible derived dataset for the portable report.
-- Inputs were manually audited from the transcripts and current repository; see source-notes.md.

WITH channel_mix(session, channel, calls) AS (
  VALUES
    ('EAI polish', 'Native', 120),
    ('EAI polish', 'Python bridge', 50),
    ('farq gallery', 'Native', 5),
    ('farq gallery', 'Python bridge', 144),
    ('Codex OSAGO', 'Native', 131),
    ('Codex OSAGO', 'Python bridge', 0)
)
SELECT session, channel, calls
FROM channel_mix
ORDER BY session, channel;

WITH session_totals(session, calls) AS (
  VALUES
    ('EAI polish', 170),
    ('farq gallery', 149),
    ('Codex OSAGO', 131)
),
implementation(current_tools, template_resources) AS (
  VALUES (16, 10)
)
SELECT
  SUM(session_totals.calls) AS product_calls,
  COUNT(*) AS product_workflows,
  implementation.current_tools,
  implementation.template_resources
FROM session_totals
CROSS JOIN implementation;

WITH backlog(rank, priority, change_area, effort) AS (
  VALUES
    (1, 'P0', 'Atomic versioned canvas_save', 'L'),
    (2, 'P0', 'Harden or remove files URL fetch', 'S-M'),
    (3, 'P1', 'Target-scoped snapshot and diagnostics', 'L'),
    (4, 'P1', 'Discriminated doc-patch schema', 'M'),
    (5, 'P1', 'File get and doc projections', 'M'),
    (6, 'P1', 'Strict inputs, output schemas, golden workflow', 'M'),
    (7, 'P1', 'Batch and resumable asset workflow', 'L'),
    (8, 'P1', 'Route-aware render and media MIME', 'M'),
    (9, 'P2', 'Public ref resolver', 'S'),
    (10, 'P2', 'Hash-safe conflict rebase', 'M-L'),
    (11, 'P2', 'Native image or artboard node', 'L'),
    (12, 'P2', 'Pagination, budgets, integration coverage', 'M-L')
)
SELECT rank, priority, change_area, effort
FROM backlog
ORDER BY rank;

WITH evolution(sort_order, area, status) AS (
  VALUES
    (1, 'Lifecycle', 'Resolved'),
    (2, 'Templates', 'Resolved'),
    (3, 'Incremental editing', 'Capability resolved; schema remains'),
    (4, 'Visual feedback', 'Capability resolved; isolation remains'),
    (5, 'Assets', 'Foundation resolved; workflow remains split'),
    (6, 'Missing asset paths', 'Resolved'),
    (7, 'Publishing semantics', 'Current contract regression'),
    (8, 'Agent discovery', 'Current')
)
SELECT sort_order, area, status
FROM evolution
ORDER BY sort_order;
