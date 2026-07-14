---
name: "Learned: Configuration"
globs: ["src/config/**", "docker-compose*.yml", "**/vite.config.*", "frontend/package.json"]
topics: ["configuration", "12-factor", "build-tooling"]
priority: low
evidence_count: 2
last_updated: 2026-07-14
auto_generated: true
---

# Configuration

- Keep local-dev credentials/defaults in compose (`${VAR:-default}`), never in application code; the app reads everything from env (12-factor).
- Keep a test runner and its host bundler on the same major version (e.g. Vitest + Vite); verify with `npm ls <bundler>` after any bump, since a mismatch can pull in a second bundler copy and reintroduce advisories the primary version already fixed.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `DATABASE_URL`/`PORT`/`LOG_LEVEL` via env; defaults only in docker-compose.yml | [reflection-TASK-001.md](../../reflection/reflection-TASK-001.md) | 2026-07-10 |
| Vitest 2→3 bump to match Vite 6 deduped a nested vite@5 copy and cleared its esbuild advisories (`npm ls vite`) | [reflection-TASK-004.md](../../reflection/reflection-TASK-004.md) | 2026-07-14 |
