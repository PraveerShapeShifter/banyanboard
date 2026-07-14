# Learning Metrics

## Configuration

| Setting | Value | Description |
|---------|-------|-------------|
| Max learned rule files | 10 | Hard cap on files in `agent-rules/_learned/` |
| Expiry period (days) | 90 | Remove unreinforced bullets after this period |
| Promotion threshold | 3 | Promote to `medium` priority at this evidence count |
| Max bullets per file | 15 | Prune to 10 most-evidenced when exceeded |

## Task History

| Task ID | Date | Learnings Extracted | Rules Amended | Rules Created |
|---------|------|--------------------:|-------------:|-------------:|
| TASK-001 | 2026-07-10 | 4 | 0 | 4 |
| TASK-002 | 2026-07-12 | 4 | 2 | 2 |
| TASK-003 | 2026-07-13 | 3 | 3 | 0 |
| TASK-004 | 2026-07-14 | 4 | 3 | 1 |

## Rule Effectiveness

| File | Topics | Evidence Count | Priority | Last Updated |
|------|--------|---------------:|:--------:|:------------:|
| testing-patterns.md | testing, dependency-injection | 4 | medium | 2026-07-14 |
| error-handling.md | error-handling, observability, async-ui | 3 | medium | 2026-07-14 |
| infrastructure.md | infrastructure, docker, verification | 1 | low | 2026-07-10 |
| configuration.md | configuration, 12-factor, build-tooling | 2 | low | 2026-07-14 |
| data-access.md | data-access, sql, security | 2 | low | 2026-07-13 |
| api-design.md | api-design, rest | 2 | low | 2026-07-13 |
| frontend-patterns.md | frontend, react, async-ui | 1 | low | 2026-07-14 |

## Consolidation History

| Date | Rules Before | Rules After | Merged | Expired | Promoted |
|------|------------:|------------:|-------:|--------:|---------:|
| 2026-07-10 (TASK-001 archive) | 4 | 4 | 0 | 0 | 0 |
| 2026-07-13 (TASK-003 archive) | 6 | 6 | 0 | 0 | 1 |
| 2026-07-14 (TASK-004 archive) | 7 | 7 | 0 | 0 | 0 |
