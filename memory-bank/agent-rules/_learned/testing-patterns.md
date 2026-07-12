---
name: "Learned: Testing Patterns"
globs: ["src/**/*.ts", "**/*.test.ts"]
topics: ["testing", "dependency-injection"]
priority: low
evidence_count: 1
last_updated: 2026-07-10
auto_generated: true
---

# Testing Patterns

- Inject external I/O (DB drivers, HTTP clients) as dependencies into the app/handler factory so happy/error/throw paths are testable with stubs and no live service.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `createApp({ checkDb })` DI enabled full health-endpoint testing without a live DB | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
