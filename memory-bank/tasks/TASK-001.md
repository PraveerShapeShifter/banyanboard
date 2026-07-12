# TASK-001: Project Foundation

**Complexity**: Level 2 (inherited from FEAT-001)
**Status**: COMPLETE
**Reflection**: memory-bank/reflection/reflection-TASK-001.md
**Archived**: memory-bank/archive/archive-TASK-001.md
**Completed**: 2026-07-10
**Roadmap**: FEAT-001
**Branch**: feature/FEAT-001-project-foundation
**Worktree**: N/A
**Latest Commit**: 6d49e21 (Phase 3 — final)

## Task Description

Establish the project foundation for BanyanBoard: a TypeScript/Express REST API
skeleton, Docker Compose orchestration for a PostgreSQL database, a `/health` check
endpoint with automated tests, and a basic clean-architecture project structure that
favors simplicity over clever abstractions. This foundation is the prerequisite for
all subsequent board/column/card features.

## Specification

**Feature Type**: NFR/Infrastructure
**Primary Persona**: Devon (self-hosting Admin / DevOps); enables Marco/Priya feature work downstream
**Creative Exploration Needed**: No — conventional scaffolding, all fields HIGH confidence

### NFR Verification (Infrastructure Feature)

- **Test method**:
  - `npm run build` — TypeScript compiles with zero errors
  - `npm test` — health endpoint test suite passes
  - `docker compose up` — API and PostgreSQL containers start and become healthy
  - `curl http://localhost:3000/health` — returns HTTP 200 with JSON status
- **Success metrics**:
  - `GET /health` → HTTP 200 `{ "status": "ok", "db": "connected" }` when DB reachable
  - `GET /health` → HTTP 503 `{ "status": "degraded", "db": "disconnected" }` when DB unreachable (process does not crash)
  - Test suite: 100% pass, health behaviors covered
- **Observable at**: terminal (build/test output), `http://localhost:3000/health`

### Acceptance Criteria

- **AC-ENTRY-1**: From the repo root, `docker compose up` starts the API container and a PostgreSQL container; both reach a healthy state.
- **AC-ENTRY-2**: The project has a clean-architecture directory structure and documented scripts (`npm run dev`, `npm run build`, `npm start`, `npm test`); `npm run build` compiles TypeScript with no errors.
- **AC-HAPPY-1**: `GET /health` returns HTTP 200 with body `{ "status": "ok", "db": "connected" }` when PostgreSQL is reachable.
- **AC-HAPPY-2**: `npm test` runs the health endpoint tests and they pass.
- **AC-ERROR-1**: When PostgreSQL is unreachable, `GET /health` returns HTTP 503 with `{ "status": "degraded", "db": "disconnected" }` and the server stays up (no unhandled crash).

### Scope Boundaries

**In scope**:
- TypeScript + Express app skeleton (`src/` with shallow clean-architecture layers)
- `package.json` scripts (dev/build/start/test), `tsconfig.json`
- Environment config via env vars (12-factor): `PORT`, `DATABASE_URL` (+ `.env.example`)
- PostgreSQL connectivity (via `pg`) and a `/health` route that checks it
- Automated tests for `/health` (framework + Supertest-style HTTP assertions)
- `Dockerfile` (API) and `docker-compose.yml` (api + postgres)
- README quickstart; `.gitignore` / `.env` handling

**Out of scope**:
- Board / column / card domain models and endpoints
- Authentication / RBAC
- Database migration tooling (a connection is enough for the health check)
- React frontend
- CI/CD pipeline

**Dependencies**: npm packages only — `express`, `pg`, `dotenv`; dev: `typescript`, `tsx`/`ts-node`, a test runner (Jest or Vitest) + `supertest` + types.

**NFR implications**:
- 12-factor config: no hardcoded ports/credentials — all via env
- Observability: structured request logging on the HTTP handler (reference observability requirements during build)

## Test Strategy

### Approach
- **Emphasis**: integration (HTTP endpoint via Supertest) with minimal unit coverage
- **Target test count**: ~6 (justified: single endpoint + a boot smoke test; small by design)

### File Organization
- **New test files**:
  - `src/health/health.test.ts` (or `tests/health.test.ts`) — covers 200-healthy, 503-when-DB-down, and response-shape assertions
  - `src/app.test.ts` — app boots / responds smoke test
- **Extend existing**: none (greenfield)

### What NOT to Test
- Express framework internals — covered by the framework
- Env var parsing trivialities — low value, covered indirectly
- Docker/Compose itself — verified manually via AC-ENTRY-1, not unit-tested
- PostgreSQL driver behavior — trust the `pg` library

### Per-Phase Test Guidance
- Phase 1: 1–2 tests — app boots and returns a response (smoke)
- Phase 2: 4–5 tests — `/health` returns 200+correct shape when DB up; 503+correct shape when DB down; content-type is JSON
- Phase 3: 0 automated (Docker verified manually per AC-ENTRY-1); document the `docker compose up` + curl check in README

## Implementation Roadmap

- [x] Phase 1: Project scaffold & TS/Express skeleton — directory structure, `package.json` scripts, `tsconfig.json`, app + server bootstrap, env config (`PORT`), README + env docs (`.env.example` blocked by secrets guard; env documented in README)
- [x] Phase 2: Health endpoint + DB connectivity + tests — `pg` pool from `DATABASE_URL`, `GET /health` with DB check (200 ok / 503 degraded), health tests
- [x] Phase 3: Docker Compose orchestration — `Dockerfile` (API), `docker-compose.yml` (api + postgres), env wiring, README quickstart; verify `docker compose up` + `/health`

## Creative Phases

- [ ] None required (Level 2, all specification fields HIGH confidence)

### API Requirements
- **REST API**: Yes → load `api-rest-requirements.md` during build. Endpoint: `GET /health`. OpenAPI spec: to be created (minimal, optional).

### Observability Requirements
- **Applies**: Yes (HTTP handler) → reference `observability-requirements.md` during build
- **Logging**: structured request logging + health-check outcome (level via `LOG_LEVEL`)
- **Tracing**: minimal at foundation stage; wire a request/trace id if trivial
- **Metrics**: none required at foundation

---

## Execution State

**Build Status**: IDLE
**Current Phase**: COMPLETE
**Current Step**: Archived 2026-07-10 — task closed
**Can Resume**: NO
**Phase Number**: 3 of 3
**Is Multi-Phase**: YES
**Build Started**: 2026-07-10 20:10 GMT+12
**Last Completed**: Phase 3 (Docker Compose orchestration) — build PASS, tests 7/7 PASS, compose config valid
**Can Resume**: NO

### Current Build Step
**Step**: Step 11 - Phase Git Completion
**Status**: COMPLETE
**Completed**: 2026-07-10 20:13 GMT+12

### Phase 3 Results
- Files added: `Dockerfile` (multi-stage: node:20-alpine build → slim runtime, non-root `node` user), `docker-compose.yml` (api + postgres:16-alpine, healthchecks, named volume), `.dockerignore`
- Files changed: `README.md` (Docker Compose Quick Start + env table; removed "arrives in Phase 3" note)
- Design: multi-stage build keeps the runtime image lean (prod deps only) and non-root for security. Compose wires `DATABASE_URL=postgres://…@db:5432/banyanboard`; `api.depends_on db: service_healthy` so the API only starts once Postgres passes `pg_isready`. Added an API healthcheck (busybox `wget` on `/health`) so BOTH services report healthy — satisfies AC-ENTRY-1 literally. All config via env with local-dev defaults (12-factor).
- Verification: `npm run build` PASS (0 TS errors) · `npm test` 7/7 PASS (no regression) · `docker compose config` VALID (both healthchecks, env, volume, depends_on resolve correctly)
- Note: live `docker compose up` NOT executed — Docker Desktop daemon not running in this environment. Per Test Strategy, Phase 3 has 0 automated tests and Docker is verified manually via AC-ENTRY-1; config-level validation is the available automated gate. **Human should run `docker compose up --build` + `curl http://localhost:3000/health` to confirm AC-ENTRY-1 / AC-HAPPY-1 live-DB path.**
- Security: no new dependencies added; runtime image uses `npm ci --omit=dev`; container runs as non-root. Pre-existing 5 npm-audit transitive findings still DEFERRED (see projectbrief.md).
- AC coverage: AC-ENTRY-1 ✓ (compose brings up api + postgres, both with healthchecks — pending human live confirmation), AC-ENTRY-2 ✓ (structure + scripts + `npm run build`), AC-HAPPY-1 live-DB path now runnable via compose (pending human confirmation)

### Phase 2 Results
- Files added: src/db/pool.ts (pg pool + checkConnection), src/health/health.ts (GET /health router), src/health/health.test.ts (5 tests)
- Files changed: src/app.ts (createApp now takes AppDeps{checkDb}, mounts health router), src/server.ts (wires real pg pool → checkDb), src/app.test.ts (smoke tests pass checkDb stub), package.json (+pg ^8.12.0, +@types/pg ^8.11.6), README.md (API + structure docs)
- Design: checkDb dependency injected into createApp — keeps app factory pure/testable; pg driver isolated in db/pool.ts. Health probe catches all errors → 503 degraded (never crashes; satisfies AC-ERROR-1).
- Tests (7 total): app smoke 2/2; health 5/5 (200 ok/connected, 503 degraded/disconnected, 503 when checkDb throws, JSON content-type on both paths)
- Verification: `npm run build` PASS (0 TS errors) · `npm test` 7/7 PASS · lint: none configured
- Security: no new blocking vulns (pg not flagged); pre-existing 5 npm-audit transitive findings still DEFERRED (see projectbrief.md)
- AC coverage: AC-HAPPY-1 ✓, AC-HAPPY-2 ✓, AC-ERROR-1 ✓ (200/503 shapes + no-crash verified via injected stubs; live-DB path exercised by Docker in Phase 3 / AC-ENTRY-1)

### Phase 1 Results
- Files: package.json, tsconfig.json, vitest.config.ts, src/config/{env,logger}.ts, src/app.ts, src/server.ts, src/app.test.ts, README.md
- Test runner: Vitest + Supertest (2 tests: GET / → 200 service info; unknown route → 404)
- Verification: `npm run build` PASS · `npm test` 2/2 PASS · lint: none configured
- Security: 5 npm-audit findings in transitive deps (3 moderate/1 high/1 critical) — DEFERRED (see projectbrief.md security debt)
- Note: `.env.example` blocked by `.env.*` secrets guard; env vars documented in README instead

### Active Sub-Agents
(none)

### Completed Steps
- Task auto-provisioned from FEAT-001 (Step 0.1)
- Specification drafted inline (greenfield — no codebase to analyze)
- Test strategy and 3-phase implementation roadmap drafted
- Human approved specification (Step 3.2); health-check = 503-degraded confirmed
- Plan finalized → PLANNING_COMPLETE
