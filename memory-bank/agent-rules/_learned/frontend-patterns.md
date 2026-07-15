---
name: "Learned: Frontend Patterns"
globs: ["frontend/src/**/*.ts", "frontend/src/**/*.tsx"]
topics: ["frontend", "react", "async-ui", "streaming", "accessibility"]
priority: low
evidence_count: 2
last_updated: 2026-07-15
auto_generated: true
---

# Frontend Patterns

- Confine all `fetch` calls to one client module returning a discriminated result (`ok | http | network`), and model each consuming page's async state as a single status union (loading/success/error) rather than boolean flags — so "never render stale/blank content while pending" is enforced by the type/render structure, not by convention. The same single-seam + status-union discipline extends to a long-lived streaming connection: put the `EventSource`/socket in one module and drive the hook through a connecting/open/reconnecting/degraded union, resetting all per-connection state when the subscription key (e.g. boardId) changes.
- For a live-updating list, put the `aria-live` announcer in its own visually-hidden element (never on the visibly-updating list), key its inner node so identical repeated text re-announces, and gate announcements on a genuinely-new-vs-catch-up distinction so backfill/replay bursts stay silent — announce only truly-new live events.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| Single `api/client.ts` fetch seam returning discriminated `ApiResult`; pages use `useApiResource` status-union state machine (20/20 tests, all async ACs) | [reflection-TASK-004.md](../../reflection/reflection-TASK-004.md) | 2026-07-14 |
| `api/activityStream.ts` EventSource seam + `useActivityStream` connecting/open/reconnecting/degraded union; decoupled visually-hidden `aria-live` announcer keyed by `seq` with an arming heuristic (code review caught stale cross-board state + two announcer edge cases, +2 regression tests) | [reflection-TASK-005.md](../../reflection/reflection-TASK-005.md) | 2026-07-15 |
