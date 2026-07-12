---
name: "Learned: Error Handling"
globs: ["src/**/*.ts", "src/**/health*"]
topics: ["error-handling", "observability"]
priority: low
evidence_count: 1
last_updated: 2026-07-10
auto_generated: true
---

# Error Handling

- Health/liveness handlers must catch all errors and return a degraded status (503) rather than throwing, so the process never crashes on a dependency outage.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `/health` returns 503 "degraded" on DB failure, never crashes (AC-ERROR-1) | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
