---
name: "Learned: Data Access"
globs: ["src/**/*repository*.ts", "src/**/*.repository.ts"]
topics: ["data-access", "sql", "security"]
priority: low
evidence_count: 2
last_updated: 2026-07-13
auto_generated: true
---

# Data Access

- Always parameterize queries (`$1, $2, …`), including dynamic partial UPDATEs built from a params array plus `updated_at = now()`; never interpolate values, and assert in tests that literals are absent from the SQL text.
- Expose an optional filter as a single repository method (`findAll(filter?)`) that adds a parameterized `WHERE` only when the filter is present, and index the filtered/FK column.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `PostgresBoardsRepository` uses parameterized INSERT/UPDATE/DELETE with `RETURNING`; dynamic partial update assembles `$n` params, never interpolates | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
| `PostgresCardsRepository.findAll(boardId?)` adds `WHERE board_id = $1` only when filtered; `cards_board_id_idx` indexes the FK/filter column | [reflection-TASK-003.md](../../reflection/reflection-TASK-003.md) | 2026-07-13 |
