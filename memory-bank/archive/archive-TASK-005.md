# Archive: Realtime Activity Feed (TASK-005 / FEAT-005)

## Metadata
- **Task ID**: TASK-005
- **Complexity**: Level 4
- **Started**: 2026-07-15
- **Completed**: 2026-07-15
- **Duration**: 1 day (plan → creative → 3 build phases → UAT → reflect → archive)
- **Roadmap Link**: FEAT-005
- **Branch**: feature/FEAT-005-realtime-activity-feed
- **Disposition**: local-merge → `main` (Archive Strategy per projectbrief.md)
- **Reflection**: `memory-bank/reflection/reflection-TASK-005.md`

## Executive Summary

TASK-005 delivered BanyanBoard's first realtime capability: a board-scoped, read-only **activity feed** that shows card movements (status changes) as they happen, without polling. The work spanned a backend spine — capture status transitions on the existing `PATCH /cards/:id` path → persist to a new `card_activity` table → fan out over the project's first server→client push transport (SSE) — and a frontend surface (a live, accessible feed panel on the board view). It was deliberately phased and gated by three creative explorations (user journey, architecture, UI/UX) before build.

All 10 original acceptance criteria (plus a UAT-added AC-NAV-1) were verified: 118/118 backend tests, 35/35 frontend tests, zero regressions across three build phases, and a UAT verdict of **PASS_WITH_RECOMMENDATIONS** (0 Required, 2 Recommended). The adversarial `build-code-reviewer-agent` step returned BLOCK in both Phase 2 and Phase 3, each time catching real bugs the initial test suites missed (an SSE close-handler-after-await leak + a NaN-cursor drop; stale cross-board state + two `aria-live` announcer edge cases) — strong evidence the review gate earns its keep.

This archive is filed as a **full Task Archive with Phase 4 (post-UAT E2E tests) explicitly deferred** as a tracked follow-up, consistent with the reflection recommendation and the TASK-004 precedent (which archived with `/banyan-uat` still open).

## System Overview

### Purpose
Make the board *feel live*: when a card moves between columns, everyone watching that board sees a human-readable feed item appear within ~2s, with no manual refresh. Directly serves the product's core value ("see status at a glance; keep cards flowing to Done" — Priya persona) and closes the loop for contributors (Marco sees his own move register) and observers (Sam glances without editing).

### Scope
- **In scope**: capture real status transitions (old ≠ new) on the `PATCH /cards/:id` path; persist them to `card_activity`; push live over SSE; backfill on connect; replay on reconnect (`Last-Event-ID`); a board-scoped, read-only, WCAG 2.1 AA accessible live feed with connecting/open/reconnecting/degraded/empty states.
- **Out of scope** (deliberately bounded): any write/edit from the feed (strictly read-only); activity for non-status card changes; **actor identity** (no auth exists → attributed generically as "Someone"); **multi-instance horizontal scaling** of the transport (single-instance `docker compose` → in-process fan-out; cross-instance pub/sub documented as a future promotion path, not built); historical analytics/retention/export.
- **Deferred**: Phase 4 post-UAT E2E test implementation (spec generated, not yet implemented).

### Key Capabilities
- Race-free status-transition capture folded into the card write path (no-op/non-status PATCH emits nothing).
- SSE push transport (`GET /api/activity/stream?board_id=`) with bounded backfill, gap-free reconnect/replay, heartbeat, and leak-free teardown.
- A persistent, accessible side-panel feed with a decoupled `aria-live` announcer that stays quiet during backfill/replay bursts and announces only genuinely-new live events.

## Architecture

### Overview
Three architectural patterns were introduced (all documented in `systemPatterns.md` § Recent Architecture Changes):
1. **Write-path side-effect capture** — the `PATCH /cards/:id` handler orchestrates capture; `cardsRepo.update()` returns `{ card, previousStatus }` from a single atomic `RETURNING` subquery (race-free old-vs-new). On a real transition it persists one `card_activity` row (**persist-first**) then emits, fail-safe (a capture failure is logged and never fails or alters the PATCH response).
2. **In-process event fan-out seam** — `ActivityEmitter` (a purpose-built `subscribe`/`emit` interface, not raw `EventEmitter`) injected via `AppDeps`, constructed in `server.ts` as `InProcessActivityEmitter` (`Map<boardId, Set<handler>>`). Single swap-point for a future multi-instance promotion (Postgres `LISTEN/NOTIFY` / Redis) — capture hook, repository, and routes never change.
3. **SSE push transport with backfill/replay** — `GET /activity/stream?board_id=` streams `text/event-stream`; per connection: subscribe **before** the backfill DB read (buffer live events during the read, flush deduped by `id` cursor — no gap/no dup); `Last-Event-ID` → `findAfter` replay else `findRecentByBoard` backfill; heartbeat; teardown on `req` close registered **before** the async read with an idempotent `closed` flag guarding every write.

Frontend mirrors the FEAT-004 discipline: one `EventSource` seam (`api/activityStream.ts`), one status-union hook (`useActivityStream`: connecting/open/reconnecting/degraded, dedupe-by-id, arming heuristic), rendered by a feed component whose only `aria-live` element is a visually-hidden announcer keyed by an announcement `seq`.

### Data Flow
`PATCH /api/cards/:id {status}` → `cards.repository.update()` (atomic old+new) → handler detects `previousStatus !== card.status` → `activityRepo.record()` writes one `card_activity` row → `activityEmitter.emit(boardId, event)` → each subscribed SSE connection writes one `card_moved` frame → browser `EventSource` → `useActivityStream` appends (deduped) → `ActivityFeed` renders newest-first + announces via hidden `aria-live` node.

### Integration Points
- **PostgreSQL** — new `card_activity` table (`db/init/003_card_activity.sql`): identity PK (doubles as SSE cursor), `board_id` FK `ON DELETE CASCADE`, `card_id` FK `ON DELETE SET NULL`, denormalized `card_title` (history survives card deletion), CHECK-constrained `from_status`/`to_status`, `created_at`, composite `(board_id, id)` index for backfill+replay.
- **Vite dev proxy** — SSE traverses the existing `/api` proxy unchanged (a plain HTTP GET); `src/server.ts` stays on `app.listen` (no `http.Server` upgrade seam needed — a key reason SSE beat WebSocket).

## Design Decisions

### Q1 — Transport: SSE (not WebSocket / long-poll)
- **Decision**: Server-Sent Events (`text/event-stream`).
- **Rationale**: the feed is server→client, read-only; SSE is a plain HTTP GET (fits the existing Express/DI model and the `/api` dev proxy unchanged, keeps `app.listen`), has native reconnection + `Last-Event-ID`, and is Supertest-testable.
- **Alternatives**: WebSocket (bidirectional — overkill; needs `ws:true` proxy + an `http.Server` upgrade seam not present); long-poll (rejected).
- **Reference**: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`

### Q2 — Event capture: atomic old-vs-new via `RETURNING` CTE
- **Decision**: `cards.repository.update()` returns `{ card, previousStatus }` from one atomic statement; the handler gates emission on `previousStatus !== newStatus`; activity INSERT awaited (persist-first), in-memory emit off the response path.
- **Rationale**: race-free, one round-trip, no emit on no-op/non-status PATCH (AC-VERIFY-1/2/3).
- **Reference**: architecture creative doc.

### Q3 — Persistence: new `card_activity` table
- **Decision**: identity PK as cursor; `board_id` CASCADE; `card_id` SET NULL; denormalized `card_title`; CHECK statuses; `(board_id, id)` index; `actor` deferred (additive when auth lands).
- **Reference**: architecture creative doc.

### Q4 — Fan-out: per-board in-process `ActivityEmitter`
- **Decision**: `Map<boardId, Set<handler>>` injected via `createApp(deps)`; subscribe-before-backfill dedupe by `id`; `ACTIVITY_HEARTBEAT_MS` keepalive; `req.on('close')` cleanup; single→multi-instance boundary documented behind the emitter interface, not built.
- **Reference**: architecture creative doc.

### Q5 — Feed UX: persistent side panel
- **Decision**: desktop (>1024px) a 4th CSS Grid track right of the columns; tablet (640–1024px) full-width row below; mobile (<640px) 4th stacked section. Phrasing `{actor} moved "{card_title}" from {From} to {To}` (actor = "Someone" today). Five states; `aria-live="polite"` on a visually-hidden dedicated announcer with an arming heuristic so backfill/replay bursts stay silent.
- **Alternatives**: drawer, dedicated `/boards/:id/activity` route (the latter fails AC-ENTRY-1's "on `/boards/:id`").
- **Reference**: `memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md`

## Implementation

### Phases
| Phase | Scope | Outcome |
|-------|-------|---------|
| Phase 1 | Activity model + event capture (transport-agnostic backend) | ✅ Complete — `003_card_activity.sql`, `src/activity/` module, atomic capture hook. 105/105 tests. Code review APPROVE-WITH-FIXES. |
| Phase 2 | Realtime push transport (SSE) + backfill/replay | ✅ Complete — `activity.routes.ts` SSE handler, env knobs. 118/118 tests. Code review **BLOCK→resolved** (2 real bugs: close-after-await leak, NaN cursor). |
| Phase 3 | Frontend live feed UI | ✅ Complete — `activityStream.ts`, `useActivityStream`, `ActivityFeed`/`Item`/`Status`. 35/35 frontend tests. Code review **BLOCK→resolved** (3 real bugs: stale cross-board state, arm-timer historical announce, identical-text re-announce). |
| Phase 4 | Post-UAT E2E test implementation | ⏸️ **DEFERRED** — E2E spec generated (`memory-bank/uat/spec-TASK-005-e2e.md`, 9 cases); implementation carried forward as a tracked follow-up. |

### Key Components
- **Backend**: `src/activity/{activity.types,activity.repository,activity.emitter,activity.routes}.ts`; `src/cards/cards.repository.ts` (atomic `RETURNING` update) + `src/cards/cards.routes.ts` (capture hook); `src/app.ts` + `src/server.ts` (DI wiring); `db/init/003_card_activity.sql`; `src/config/env.ts` + `docker-compose.yml` (`ACTIVITY_BACKFILL_LIMIT`=50, `ACTIVITY_HEARTBEAT_MS`=15000).
- **Frontend**: `frontend/src/api/activityStream.ts`; `frontend/src/hooks/useActivityStream.ts`; `frontend/src/pages/BoardViewPage/{ActivityFeed,ActivityFeedItem,ActivityFeedStatus,BoardViewPage}.tsx`; shared `statusLabels.ts`; `index.css` (4th grid track, `.visually-hidden`).

### Technical Specifications
- 12-factor: transport knobs via env with compose defaults; no hardcoding.
- Observability: structured `log()` on capture (`activity.captured`) and connection lifecycle; no `console.log`. OTEL spans/metrics deferred (documented gap).

## Testing

### Strategy
Split by layer: backend integration-first (Vitest + Supertest, injected stubs, no live DB); frontend component/behavior (Vitest + RTL, query by ARIA role/accessible name, mock the transport at a single seam). Each of the 10 ACs maps to ≥1 test; the transport and capture layers each got several.

### Results
| Test Type | Count | Pass Rate |
|-----------|-------|-----------|
| Backend (unit + integration) | 118 | 100% |
| Frontend (component + hook) | 35 | 100% |
| E2E | 0 (spec written, Phase 4 deferred) | — |

Build clean (`tsc --noEmit`), `vite build` PASS (70.5 kB gzip). Regression: zero across all phases. **UAT**: PASS_WITH_RECOMMENDATIONS (0 Required, 2 Recommended), all 10 ACs + AC-NAV-1 verified live.

### Coverage Note
Real multi-instance fan-out and the exact realtime latency number are intentionally NOT unit-tested (out of scope / verified by construction + UAT observation). Transport-library internals are not tested — only our lifecycle handling around them.

## Deployment

### Procedures
Single-instance via `docker compose up` (`api` + `db`). The SSE endpoint is reachable through the Vite `/api` proxy in dev with no proxy change.

### Configuration
`ACTIVITY_BACKFILL_LIMIT` (default 50), `ACTIVITY_HEARTBEAT_MS` (default 15000) — env with `docker-compose.yml` defaults. `LOG_LEVEL` governs structured-log verbosity.

### ⚠️ Rollback / Migration Caveat (REC-1 — carried follow-up)
`db/init/*.sql` scripts run **only on a fresh Postgres volume**. During UAT the dev volume predated `003_card_activity.sql`, so the table was missing and capture silently no-opped (fail-safe swallow → empty feed). The migration was hand-applied idempotently in place (no data dropped). **There is no migration path for existing deployments**, and a missing table currently fails silently. Follow-up: add a migration runner + a readiness signal so a missing table fails loudly.

## Maintenance

### Monitoring
Watch structured logs: `activity.captured` (capture path), `activity.stream.open`/`close`/`reconnect` (connection lifecycle), `activity.capture.error` (fail-safe capture failures — should be rare; a spike indicates a DB/schema problem such as the REC-1 missing-table case).

### Common Issues
| Issue | Resolution |
|-------|------------|
| Feed is empty even after a card move | Check `card_activity` table exists (REC-1); check `activity.capture.error` logs |
| New moves don't appear live | Check the SSE connection state in the feed panel (reconnecting/degraded banner); verify the `/api` proxy is up |
| Announcer over-chatty on connect | Expected to be silent during backfill/replay via the arm heuristic; a >250ms intra-burst gap is the documented residual (server-sentinel fix is the proper fix — see below) |

### Operational Procedures
No scheduled maintenance. Long-lived SSE connections self-clean on disconnect (`req.on('close')`); heartbeat prevents idle-proxy timeouts.

## Lessons Learned
(Full detail in the reflection.) Highlights:
- **Adversarial code review pays off**: `build-code-reviewer-agent` BLOCKed in Phase 2 and Phase 3, each catching real bugs tests missed — concentrated in async connection-lifecycle ordering and `aria-live` semantics, exactly the areas hardest to cover with initial tests.
- **Backend learned rules transferred cleanly** (parameterize, fail-safe, env-driven config, inject I/O) because they're expressed abstractly enough to hold for a long-lived stream, not just request/response.
- **The one genuine gap** was connection-lifecycle-specific guidance (subscribe/backfill/cleanup ordering) — now captured as the new `connection-lifecycle` learned rule.

Reference: `memory-bank/reflection/reflection-TASK-005.md`

## References
- Reflection: `memory-bank/reflection/reflection-TASK-005.md`
- Architecture creative: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`
- UI/UX creative: `memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md`
- User journey creative: `memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md`
- UAT report: `memory-bank/uat/uat-TASK-005.md`
- E2E spec (Phase 4 input): `memory-bank/uat/spec-TASK-005-e2e.md`
- Task file: `memory-bank/tasks/TASK-005.md`
- Progress log: `memory-bank/progress.md`

## Future Considerations
1. **Phase 4 — E2E tests (High)**: implement the generated framework-agnostic E2E spec (9 cases: real capture → transport → feed render, reconnect/backfill) as runnable tests.
2. **REC-1 — migration path + readiness signal (High)**: existing deployments have no path to the `card_activity` table; a missing table fails silently to an empty feed. Add a migration runner and a startup/readiness check.
3. **REC-2 — mobile verification + announcer sentinel (Medium)**: the mobile breakpoint was unverifiable in the UAT MCP (fixed large viewport) — needs a harness with real device emulation; and replace the client-side arm-timer heuristic with a server-side "backfill-complete" sentinel frame to remove its documented residual risk.
4. **Actor identity (deferred)**: `actor` field is additive once authentication lands — the feed currently attributes moves to "Someone".
5. **Multi-instance transport (deferred)**: promote the in-process `ActivityEmitter` to Postgres `LISTEN/NOTIFY` or Redis pub/sub if the deployment ever goes multi-instance — the emitter interface is the single swap-point.
