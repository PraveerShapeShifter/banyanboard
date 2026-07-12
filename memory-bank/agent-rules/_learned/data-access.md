---
name: "Learned: Data Access"
globs: ["src/**/*repository*.ts", "src/**/*.repository.ts"]
topics: ["data-access", "sql", "security"]
priority: low
evidence_count: 1
last_updated: 2026-07-12
auto_generated: true
---

# Data Access

- Always parameterize queries (`$1, $2, …`), including dynamic partial UPDATEs built from a params array plus `updated_at = now()`; never interpolate values, and assert in tests that literals are absent from the SQL text.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `PostgresBoardsRepository` uses parameterized INSERT/UPDATE/DELETE with `RETURNING`; dynamic partial update assembles `$n` params, never interpolates | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
