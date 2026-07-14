---
name: "Learned: Error Handling"
globs: ["src/**/*.ts", "src/**/health*", "src/app.ts", "frontend/src/pages/**/*.tsx"]
topics: ["error-handling", "observability", "async-ui"]
priority: medium
evidence_count: 3
last_updated: 2026-07-14
auto_generated: true
---

# Error Handling

- Health/liveness handlers must catch all errors and return a degraded status (503) rather than throwing, so the process never crashes on a dependency outage.
- Centralize request errors in one Express handler: malformed JSON (`err.type === 'entity.parse.failed'`) → 400, else → generic 500; guard `res.headersSent`, log the stack server-side, and never leak internals to the client.
- In async data-driven UI, branch on the specific failure status (e.g. 404 = "not found") *before* falling through to a generic error state — give it its own component/copy with no misleading Retry affordance where retrying cannot help.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `/health` returns 503 "degraded" on DB failure, never crashes (AC-ERROR-1) | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| Central error middleware: malformed JSON→400, else→500, `headersSent` guard, no stack-trace leak (AC-ERROR-3) | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
| Distinct 404 "Board not found" state (no Retry, back-link) branched before generic error+retry in BoardViewPage (AC-ERROR-2/3) | [reflection-TASK-004.md](../../reflection/reflection-TASK-004.md) | 2026-07-14 |
