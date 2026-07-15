---
name: "Learned: Infrastructure"
globs: ["Dockerfile", "docker-compose*.yml", ".dockerignore", "db/init/*.sql"]
topics: ["infrastructure", "docker", "verification", "deployment", "migrations"]
priority: low
evidence_count: 2
last_updated: 2026-07-15
auto_generated: true
---

# Infrastructure

- When the build environment lacks the Docker daemon, validate compose via `docker compose config` and keep build/tests green, then flag the live `up` run as an explicit human follow-up instead of claiming the AC is fully verified.
- Treat every new `db/init/*.sql` file as a deployment-affecting change, not just a schema change: init scripts run only on a *fresh* volume, so an already-provisioned volume silently skips the new table — verify or document the non-fresh-volume path (migration runner or manual-apply step) and add a readiness signal so a missing table fails loudly rather than degrading to an empty result via a fail-safe swallow.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| Phase 3 Docker verified by `compose config` only; live run deferred to human | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| UAT REC-1: dev Postgres volume predated `003_card_activity.sql`; table was missing so capture silently no-opped (fail-safe swallow) until the migration was hand-applied in place | [reflection-TASK-005.md](../../reflection/reflection-TASK-005.md) | 2026-07-15 |
