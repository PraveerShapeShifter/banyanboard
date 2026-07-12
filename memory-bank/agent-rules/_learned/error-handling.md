---
name: "Learned: Error Handling"
globs: ["src/**/*.ts", "src/**/health*", "src/app.ts"]
topics: ["error-handling", "observability"]
priority: low
evidence_count: 2
last_updated: 2026-07-12
auto_generated: true
---

# Error Handling

- Health/liveness handlers must catch all errors and return a degraded status (503) rather than throwing, so the process never crashes on a dependency outage.
- Centralize request errors in one Express handler: malformed JSON (`err.type === 'entity.parse.failed'`) → 400, else → generic 500; guard `res.headersSent`, log the stack server-side, and never leak internals to the client.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `/health` returns 503 "degraded" on DB failure, never crashes (AC-ERROR-1) | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| Central error middleware: malformed JSON→400, else→500, `headersSent` guard, no stack-trace leak (AC-ERROR-3) | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
