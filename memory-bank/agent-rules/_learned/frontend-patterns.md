---
name: "Learned: Frontend Patterns"
globs: ["frontend/src/**/*.ts", "frontend/src/**/*.tsx"]
topics: ["frontend", "react", "async-ui"]
priority: low
evidence_count: 1
last_updated: 2026-07-14
auto_generated: true
---

# Frontend Patterns

- Confine all `fetch` calls to one client module returning a discriminated result (`ok | http | network`), and model each consuming page's async state as a single status union (loading/success/error) rather than boolean flags — so "never render stale/blank content while pending" is enforced by the type/render structure, not by convention.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| Single `api/client.ts` fetch seam returning discriminated `ApiResult`; pages use `useApiResource` status-union state machine (20/20 tests, all async ACs) | [reflection-TASK-004.md](../../reflection/reflection-TASK-004.md) | 2026-07-14 |
