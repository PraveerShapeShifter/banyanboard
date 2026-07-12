---
name: "Learned: Testing Patterns"
globs: ["src/**/*.ts", "**/*.test.ts"]
topics: ["testing", "dependency-injection"]
priority: medium
evidence_count: 3
last_updated: 2026-07-13
auto_generated: true
---

# Testing Patterns

- Inject external I/O (DB drivers, HTTP clients) as dependencies into the app/handler factory so happy/error/throw paths are testable with stubs and no live service.
- Back route/integration tests with a *stateful* in-memory stub repository and assert persistence round-trips (create→get, patch→get, delete→get-404), not just echoed responses.
- To verify DB-enforced cascade/relationship behaviour without a live DB, back route tests with *linked* in-memory stubs that share one backing store, so a parent delete cascades to children at the orchestration layer.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `createApp({ checkDb })` DI enabled full health-endpoint testing without a live DB | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| Stateful in-memory `BoardsRepository` stub verified CRUD persistence round-trips (48/48 tests, no live DB) | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
| Linked boards+cards stubs sharing one store verified AC-HAPPY-7: `DELETE /boards/:id` cascades to the board's cards (404 + empty filter) | [reflection-TASK-003.md](../../reflection/reflection-TASK-003.md) | 2026-07-13 |
