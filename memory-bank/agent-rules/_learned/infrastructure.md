---
name: "Learned: Infrastructure"
globs: ["Dockerfile", "docker-compose*.yml", ".dockerignore"]
topics: ["infrastructure", "docker", "verification"]
priority: low
evidence_count: 1
last_updated: 2026-07-10
auto_generated: true
---

# Infrastructure

- When the build environment lacks the Docker daemon, validate compose via `docker compose config` and keep build/tests green, then flag the live `up` run as an explicit human follow-up instead of claiming the AC is fully verified.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| Phase 3 Docker verified by `compose config` only; live run deferred to human | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
