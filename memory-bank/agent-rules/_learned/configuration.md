---
name: "Learned: Configuration"
globs: ["src/config/**", "docker-compose*.yml"]
topics: ["configuration", "12-factor"]
priority: low
evidence_count: 1
last_updated: 2026-07-10
auto_generated: true
---

# Configuration

- Keep local-dev credentials/defaults in compose (`${VAR:-default}`), never in application code; the app reads everything from env (12-factor).

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `DATABASE_URL`/`PORT`/`LOG_LEVEL` via env; defaults only in docker-compose.yml | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
