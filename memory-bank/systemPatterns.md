# System Architecture Patterns

This file documents the architectural patterns, design patterns, and system structure used in this project. It helps developers understand the system's organization and maintain consistency when extending functionality.

## Guiding Principles

| Principle | Description |
|-----------|-------------|
| Simplicity-first clean architecture | Separate concerns into shallow layers (`config` / `db` / `health` / delivery). Add abstraction only when a concrete need appears; favor direct, readable code over indirection. |
| 12-factor configuration | All config (`PORT`, `DATABASE_URL`, `LOG_LEVEL`) comes from environment variables. No hardcoded ports, credentials, or endpoints in application code; local-dev defaults live only in `docker-compose.yml`. |
| Dependency injection at the composition root | Side-effecting resources (the `pg` pool) are constructed in `server.ts` and injected into a pure `createApp(deps)` factory. The app factory reads no env and opens no sockets. |
| Fail-safe liveness | Health/liveness handlers catch all errors and return a degraded status (503) rather than throwing, so the process never crashes on a dependency outage. |
| Testability by construction | Because I/O is injected, HTTP behavior is fully exercised with stubs via Supertest — no live database needed in tests. |

## System Architecture

### High-Level Architecture
```
                 HTTP :3000
client ───────────────────────────▶  Express app  (src/app.ts — createApp)
                                          │  GET /            -> service info
                                          │  GET /health      -> health router
                                          ▼
                                     checkDb (injected)
                                          │
                                          ▼
                                   pg Pool (src/db/pool.ts)  ──SELECT 1──▶  PostgreSQL
                                          ▲
composition root (src/server.ts): loadEnv → createPool(DATABASE_URL) → createApp({ checkDb }) → listen

Deployment: docker-compose.yml runs two containers — `api` (this app) and `db` (postgres:16),
wired via DATABASE_URL over the compose network; api starts only after db is healthy.
```

### Component Responsibilities
- **`src/config/`** — `env.ts` loads/validates env vars into a typed `Env`; `logger.ts` provides a minimal structured (JSON-per-line) `log(level, msg, meta)` to stdout.
- **`src/db/`** — `pool.ts` owns the `pg` connection pool (`createPool`) and the `checkConnection` liveness probe (`SELECT 1`). This is the only module that touches the database driver.
- **`src/health/`** — `health.ts` exposes `createHealthRouter(checkDb)` → `GET /health`, returning `200 {status:ok,db:connected}` or `503 {status:degraded,db:disconnected}`.
- **`src/app.ts`** — `createApp(deps)`: the pure Express app factory. Mounts `GET /` (service info) and the health router. No side effects.
- **`src/server.ts`** — composition root / entry point: wires real env + pool into `createApp` and starts listening.

## Design Patterns Used

- **App Factory** — `createApp(deps): Express` builds the app with no side effects (no `listen`, no env reads), so tests can construct it directly.
- **Dependency Injection** — `AppDeps { checkDb }` is passed into the factory; the concrete `pg`-backed `checkConnection` is injected only in `server.ts`. Tests inject stubs for the connected / disconnected / throwing paths.
- **Driver isolation (infrastructure boundary)** — all `pg` usage is confined to `src/db/pool.ts`; the rest of the app depends on the `DbHealthCheck` function type, not on `pg`. Keeps the door open to swap the query layer or add an ORM later.
- **Structured logging abstraction** — a tiny `log()` wrapper (JSON to stdout) keeps call sites stable; can be swapped for an OpenTelemetry-backed logger without touching callers.
- **In-process event fan-out seam (TASK-005)** — `ActivityEmitter` (a purpose-built `subscribe`/`emit` interface, not raw `EventEmitter`) is injected via `AppDeps` and constructed in `server.ts` (`InProcessActivityEmitter`, `Map<boardId, Set<handler>>`). It is the single swap-point for a future multi-instance promotion (Postgres `LISTEN/NOTIFY` / Redis pub/sub) — capture hook, repository, and routes never change, only the injected implementation. Fan-out isolates each subscriber (a throwing handler is caught + logged, never aborts delivery to the rest).
- **Side-effect capture on the write path (TASK-005)** — status transitions are captured in the `PATCH /cards/:id` handler: `cardsRepo.update()` returns `{ card, previousStatus }` from a single atomic `RETURNING` subquery (race-free old-vs-new), and only a real transition (`previousStatus !== card.status`) persists one `card_activity` row (**persist-first**) then emits. Capture is wrapped fail-safe — a capture failure is logged and never fails or alters the PATCH response.

## Recent Architecture Changes

### 2026-07-15 — Realtime activity capture + in-process fan-out (TASK-005 Phase 1)
- **Pattern**: capture card-status transitions on the existing write path into a `card_activity` table + an injected in-process `ActivityEmitter`, transport-agnostic (SSE transport is Phase 2). Persist-first, emit-second, gated on a real transition, fail-safe.
- **Source**: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`

### 2026-07-15 — SSE push transport with backfill/replay (TASK-005 Phase 2)
- **Pattern**: `GET /activity/stream?board_id=` streams `text/event-stream`. Per connection: **subscribe to the emitter BEFORE the backfill DB read** (buffer live events during the read, flush deduped by `id` cursor — no gap, no duplicate); `Last-Event-ID` header → `findAfter` replay, else `findRecentByBoard` backfill; heartbeat interval; teardown on `req` close registered **before** the async read with an idempotent `closed` flag that guards every write (a timer/live event can never write to a destroyed socket). Malformed cursor/`board_id` validated (never `NaN` into a query or dedupe comparison). The `activityStreamHandler` is exported separately from the router so its streaming lifecycle is unit-testable with mock req/res (no hung socket).
- **Source**: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`

## Testing Patterns

### Test Organization
- **Test location**: co-located with source — `src/**/*.test.ts` (e.g. `src/app.test.ts`, `src/health/health.test.ts`).
- **Naming convention**: `<unit>.test.ts` alongside the module under test.
- **Build exclusion**: `tsconfig.json` excludes `**/*.test.ts` from the compiled output.

### Test Framework & Style
- **Framework**: Vitest (runner) + Supertest (HTTP assertions).
- **Style**: integration-first — drive the Express app through real HTTP via Supertest, injecting stub dependencies (e.g. a fake `checkDb`) to exercise happy (200), degraded (503), and error/throw paths without external services. Minimal pure-unit coverage beyond that.
- **Commands**: `npm test` (`vitest run`), `npm run test:watch`.

<!-- AUTO-MANAGED: c4-architecture-start -->
## C4 Architecture

<!--
  This section is auto-managed by /banyan-c4. Run /banyan-c4 to populate or refresh.
-->

C4 architecture documentation has not been generated for this project yet.

To populate this section, run `/banyan-c4`.

<!-- AUTO-MANAGED: c4-architecture-end -->

---

## Notes

- Keep this file updated during the BUILD phase when architectural changes occur
- Document patterns and trade-offs to help future developers understand design decisions
- Keep Guiding Principles current — add new principles when foundational patterns emerge
