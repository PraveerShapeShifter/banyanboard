---
name: "Learned: API Design"
globs: ["src/**/*routes*.ts", "src/**/*.routes.ts"]
topics: ["api-design", "rest"]
priority: low
evidence_count: 1
last_updated: 2026-07-12
auto_generated: true
---

# API Design

- Treat an unparseable/out-of-range resource `:id` (non-numeric, zero, negative) as `404 Not Found` rather than `400`, applied consistently across GET/PATCH/DELETE — it avoids leaking a format-vs-existence distinction and keeps not-found semantics uniform.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `parseBoardId` returns null for non-digit/zero/negative/overflow ids → routes respond 404 before any DB call | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
