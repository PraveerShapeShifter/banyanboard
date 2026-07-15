---
name: "Learned: Testing Patterns"
globs: ["src/**/*.ts", "**/*.test.ts", "**/*.test.tsx"]
topics: ["testing", "dependency-injection"]
priority: medium
evidence_count: 4
last_updated: 2026-07-14
auto_generated: true
---

# Testing Patterns

- Inject external I/O (DB drivers, HTTP clients) as dependencies into the app/handler factory so happy/error/throw paths are testable with stubs and no live service.
- Back route/integration tests with a *stateful* in-memory stub repository and assert persistence round-trips (create→get, patch→get, delete→get-404), not just echoed responses.
- To verify DB-enforced cascade/relationship behaviour without a live DB, back route tests with *linked* in-memory stubs that share one backing store, so a parent delete cascades to children at the orchestration layer.
- In React component tests, query rendered output by ARIA role and accessible name (`getByRole('region', { name: /To Do/ })`, `role="alert"`) rather than test-ids or DOM structure — it doubles as an accessibility check and survives markup refactors.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `createApp({ checkDb })` DI enabled full health-endpoint testing without a live DB | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| Stateful in-memory `BoardsRepository` stub verified CRUD persistence round-trips (48/48 tests, no live DB) | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
| Linked boards+cards stubs sharing one store verified AC-HAPPY-7: `DELETE /boards/:id` cascades to the board's cards (404 + empty filter) | [reflection-TASK-003.md](../../reflection/reflection-TASK-003.md) | 2026-07-13 |
| Component tests query by role/accessible name (`getByRole('region', { name: /To Do/ })`) — a11y-assertive and refactor-resilient (20/20 tests) | [reflection-TASK-004.md](../../reflection/reflection-TASK-004.md) | 2026-07-14 |
