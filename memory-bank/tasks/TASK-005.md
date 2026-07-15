# TASK-005: Realtime Activity Feed

**Complexity**: Level 4
**Status**: COMPLETE
**Reflection**: memory-bank/reflection/reflection-TASK-005.md
**Archived**: memory-bank/archive/archive-TASK-005.md
**Completed**: 2026-07-15
**UAT**: PASS_WITH_RECOMMENDATIONS (run `20260715-uat-inline`, 2026-07-15) — Required=0, Recommended=2. Report: `memory-bank/uat/uat-TASK-005.md`; E2E spec: `memory-bank/uat/spec-TASK-005-e2e.md`
**Roadmap**: FEAT-005
**Branch**: feature/FEAT-005-realtime-activity-feed
**Worktree**: N/A

## Task Description

Track and display a realtime activity feed of card movements between columns. Captures a card-movement event whenever a card's `status` changes (To Do ↔ In Progress ↔ Done — the `PATCH /cards/:id { status }` path from FEAT-003), persists it as an activity/event record, and pushes it live to connected clients so the frontend can render a continuously-updating feed without polling. Introduces the project's first realtime push transport (WebSocket or SSE) — a new server capability with connection-lifecycle management, event fan-out to subscribers, and reconnection/backfill semantics — plus an activity persistence model and a frontend live-feed UI. Expected to be phased (event capture + store → push transport → frontend feed) with multiple creative phases (transport architecture, event/activity model, feed UX).

**Dependencies**: FEAT-003 (Card CRUD API — card `status` changes are the events being tracked); FEAT-004 (React Frontend — the surface that renders the live feed); FEAT-001 (foundation — Express app factory, `pg` pool, logger).

## Specification

**Feature Type**: End-User Feature
*Note: primarily an end-user feature (a live feed personas watch), with a substantial NFR/infrastructure spine — the project's first realtime push transport, connection lifecycle, and an activity persistence model.*

**Primary Persona**: **Priya** (Team Lead / Project Coordinator) — her core goal is "see status at a glance… keep cards flowing to Done" (productBrief.md Key Personas). A continuously-updating feed of card movements is a direct expression of that goal: she watches work move without refreshing or hunting. **Secondary observers**: **Marco** (contributor — his own moves appear in the feed, closing the "did that register?" loop) and **Sam** (stakeholder — glances at progress without editing).

**Creative Exploration Needed**: **Yes** — Level 4 with several genuinely open, HIGH-impact design questions (transport, event capture, persistence model, fan-out/lifecycle, feed UX). Enumerated in the **Creative Exploration Needed** section below.

### Invocation Method
- **Location**: The board view route `/boards/:id` (`frontend/src/pages/BoardViewPage/BoardViewPage.tsx`), most plausibly as a feed panel alongside the existing `<BoardHeader />` + `<Columns />` layout. **The exact placement is a creative-phase decision** (in-board side panel vs. collapsible drawer vs. a dedicated `/boards/:id/activity` route added to `frontend/src/routes.tsx`).
- **Element**: A live-updating list region ("Activity" panel) rendering the most recent card-movement events newest-first, each phrased for humans (e.g. "moved 'Deploy pipeline' from In Progress to Done").
- **Visibility**: Scoped to a board — the feed shows activity for the board currently open. Whether it is always visible, collapsible, or a separate route is a UX decision (see Creative Exploration).
- **Navigation**: App entry (`/`, `BoardListPage`) → open a board (`/boards/:id`) → the feed is present on that board view. No new top-level navigation is assumed.
- **Confidence**: **MEDIUM** that it lives on the board view (strongest persona + data fit); **LOW** on the precise surface (panel vs. drawer vs. dedicated route) and on ordering/item-count — these need the creative UX phase.

### Success Criteria
- **User sees**: A new feed item appear **without any manual reload** shortly after a card's status changes on that board, phrased in plain language with the card title and the from→to columns; on (re)connect the panel is pre-populated with recent history rather than starting blank.
- **Verifiable at**: The Activity panel on `/boards/:id` in the browser; the server transport endpoint (a new `/api`-reachable route — see Creative); and the new `003_*` activity table in PostgreSQL.
- **Data persisted**: A new activity/event table (`db/init/003_*.sql`, following the `001`/`002` conventions — `INTEGER GENERATED ALWAYS AS IDENTITY` PK, `TIMESTAMPTZ NOT NULL DEFAULT now()`, FK `REFERENCES boards(id)`/`cards(id)`, indexed FK). Candidate fields: `board_id`, `card_id`, `from_status`, `to_status`, `created_at`. Exact columns (denormalized `card_title`? `actor`? FK `ON DELETE` behavior?) are a creative decision.
- **Observable within**: Async, near-realtime — a small latency budget (target p95 < ~2s from PATCH acknowledgement to feed render) — while the `PATCH /cards/:id` response itself stays within the existing API NFR (p95 < 200ms; event emission must not block the request path).

### Acceptance Criteria

#### AC-ENTRY-1: Priya can find the activity feed on a board
**Priority**: MUST
**Given** Priya has opened a board at `/boards/:id` (`BoardViewPage`)
**When** she looks for recent activity on that board
**Then** she sees a clearly labeled Activity feed region on the board view, distinct from the three status columns, with an accessible name/role (WCAG 2.1 AA — matching the FEAT-004 component bar).

#### AC-HAPPY-1: A card status change appears in the feed live, without a reload
**Priority**: MUST
**Given** Priya is viewing board `B` with the Activity feed open, and Marco has that board open elsewhere
**When** Marco moves a card via `PATCH /cards/:id { status }` (e.g. `in_progress` → `done`), changing the card's status
**Then** a new item describing that movement appears at the top of Priya's feed **without her reloading the page or taking any action**, and the corresponding column counts reflect the move.

#### AC-HAPPY-2: Feed items are human-readable, ordered, and accessible
**Priority**: MUST
**Given** one or more card-movement events are present in the feed
**When** the feed renders and a new item arrives
**Then** each item reads in plain language including the card title and the from→to column labels (e.g. "moved 'Deploy pipeline' from In Progress to Done"), items are ordered newest-first, status is conveyed **not by color alone**, and new items are announced to assistive tech via an `aria-live` region (WCAG 2.1 AA).

#### AC-ASYNC-1: On connect, the feed backfills recent history rather than starting blank
**Priority**: MUST
**Given** Priya opens (or re-opens) a board whose activity already has prior movement events
**When** the feed establishes its connection to the transport
**Then** the panel is pre-populated with the most recent events (a bounded backfill) so it is never blank when history exists, and the backfill is consistent with what is persisted in the `003_*` activity table (not a client-side guess).

#### AC-ASYNC-2: A dropped connection auto-recovers and its state is observable, with no missed events
**Priority**: SHOULD
**Given** Priya has the feed open and the transport connection drops (network blip, server restart)
**When** connectivity is restored
**Then** the feed shows an observable connecting/reconnecting state, reconnects **without any user action**, and replays events that occurred during the gap (e.g. via a Last-Event-ID / cursor) so no card movement is silently lost from the feed.

#### AC-ERROR-1: A degraded or failed transport is surfaced, not silently blank
**Priority**: MUST
**Given** the realtime transport cannot be established or has failed and cannot recover
**When** Priya views the board
**Then** the feed shows an explicit degraded/offline state (not an empty panel that looks like "no activity"), and the rest of the board — columns, cards, existing FEAT-004 reads — continues to work unaffected. The failure follows the app's fail-safe posture (`src/app.ts` central error handler; `ErrorState` on the client).

#### AC-VERIFY-1: A no-op PATCH does NOT create an activity event
**Priority**: MUST
**Given** a `PATCH /cards/:id` that does not change `status` — either the same status value is sent, or only non-status fields (`title`, `description`, `due_date`) are edited
**When** the request is processed
**Then** **no** activity record is written and **no** feed event is emitted, even though the repository still bumps `updated_at` for every update (`src/cards/cards.repository.ts` always appends `updated_at = now()`); emission is gated on an actual `from_status` ≠ `to_status` transition, not merely on "an update occurred".

#### AC-VERIFY-2: Every real status change persists exactly one well-formed activity record
**Priority**: MUST
**Given** a `PATCH /cards/:id` that changes `status` from one valid `CardStatus` to a different one (`todo`/`in_progress`/`done`, per `src/cards/cards.types.ts`)
**When** the request succeeds
**Then** exactly one row is written to the `003_*` activity table with the correct `board_id`, `card_id`, `from_status`, `to_status`, and a `created_at` timestamp — no duplicate rows, no missing rows, and `from_status`/`to_status` constrained to the valid `CardStatus` set (CHECK constraint, mirroring `002_cards.sql`).

#### AC-VERIFY-3: Event delivery meets the realtime budget without regressing the write path
**Priority**: SHOULD
**Given** the transport is connected and a card status change occurs
**When** delivery latency and the `PATCH` response time are measured
**Then** the event is visible to connected clients within the target budget (p95 < ~2s from PATCH acknowledgement to feed render) **and** the `PATCH /cards/:id` response itself remains within the existing API NFR (p95 < 200ms) — i.e. event capture/fan-out does not block or measurably slow the write path.

#### AC-INTEGRATION-1: The feed reflects the real card movement, not a placeholder
**Priority**: MUST
**Given** two distinct card movements occur — card X `todo`→`in_progress` and card Y `in_progress`→`done`
**When** each event is captured, pushed, and rendered
**Then** each feed item is grounded in that specific movement: it names the actual moved card and its actual from→to statuses, the two items **differ** from each other, and neither is a hardcoded/canned string (stub-detection — proves the transport is wired end-to-end from the real `PATCH` path through persistence to the DOM, not emitting a fixed message).

### Scope Boundaries
- **In scope**:
  - Capturing a card-movement event whenever `PATCH /cards/:id` changes `status` (the FEAT-003 path), detecting an actual transition (old ≠ new).
  - Persisting movement events in a new `003_*` activity table.
  - The project's first realtime server→client push transport (SSE or WebSocket — TBD in creative), including connection lifecycle, backfill on connect, and reconnection/replay.
  - A board-scoped, read-only live feed UI on the React frontend, accessible (WCAG 2.1 AA), with loading/connecting/reconnecting/degraded/empty states.
- **Out of scope**:
  - Any write/edit/create action **from** the feed — it is strictly read-only (clicking an item to jump to a card is at most a COULD, not required).
  - Activity for non-status card changes (title/description/due-date edits, create, delete) — only status transitions are tracked, unless a movement-adjacent event is trivially free to include (defer to creative).
  - **Actor identity**: the API currently has **no authentication** (no auth middleware in `src/app.ts`; productBrief lists auth as an Open Question). The feed therefore attributes movements generically (e.g. "someone" / no actor) rather than to a named user; a real `actor` field is deferred until auth exists.
  - **Multi-instance horizontal scaling of the transport**: the product runs **single-instance** via `docker compose` (`api` + `db`). In-process fan-out is acceptable for MVP; cross-instance pub/sub (Postgres `LISTEN/NOTIFY`, Redis) is **out of scope** but the scaling boundary MUST be documented (see Creative Exploration Q4). This respects the "simplicity over cleverness" guiding principle — do not build multi-instance pub/sub for a single-instance deployment.
  - Historical analytics, retention policies, or an activity export.
- **Dependencies**: FEAT-003 (`PATCH /cards/:id` is the event source — `src/cards/cards.routes.ts`); FEAT-004 (React SPA renders the feed — `frontend/src/`); FEAT-001 (Express `createApp` factory `src/app.ts`, `pg` pool `src/db/pool.ts`, structured `log()` `src/config/logger.ts`).
- **NFR implications**:
  - **Performance**: `PATCH` stays p95 < 200ms; realtime delivery target p95 < ~2s (AC-VERIFY-3).
  - **Accessibility (WCAG 2.1 AA)**: `aria-live` announcement of new items, non-color status conveyance, accessible feed region name/role, screen-reader-friendly phrasing (AC-HAPPY-2).
  - **Observability**: emit structured logs on the event-capture and connection-lifecycle paths via the existing `log()` abstraction (per project OpenTelemetry/structured-logging standards); no `console.log`.
  - **12-factor config**: any new transport/backfill knobs (e.g. backfill size, heartbeat interval, endpoint path) via env vars with local-dev defaults in `docker-compose.yml` — no hardcoding.
  - **Dev proxy**: the transport endpoint must be reachable through the Vite `/api` proxy (`frontend/vite.config.ts`); an SSE endpoint traverses it as a normal HTTP GET, while a WebSocket needs `ws: true` on the proxy and an `http.Server` upgrade path (note: `src/server.ts` currently calls `app.listen` directly with no explicit `http.createServer`). This asymmetry is an explicit input to the transport decision (Q1), not a decision made here.

### Creative Exploration Needed
This is **Level 4** — the following HIGH-impact questions are open and must be resolved in `/banyan-creative` before build:

1. **Transport choice — SSE vs WebSocket.** The feed is server→client, read-only. SSE is a plain HTTP GET (fits the existing Express app/DI model and the `/api` dev proxy unchanged, has native reconnection + Last-Event-ID); WebSocket is bidirectional (overkill for read-only) and needs `ws: true` on the proxy plus an `http.Server` upgrade seam not present in `src/server.ts` today. Decide with the "simplicity-first" principle in mind — but this is a creative decision, not pre-decided here. **(Confidence: LOW)**
2. **Event capture mechanism.** Where is the transition detected/emitted — in the `PATCH /cards/:id` handler (`cards.routes.ts`), in the repository, or via a DB trigger? How is "status actually changed" detected? The current handler does **not** read the prior card and the repo `update()` returns only the new row and always bumps `updated_at`, so old-vs-new comparison needs a deliberate design (fetch-before-update, `RETURNING` old value, or trigger). Must avoid emitting on no-op PATCHes (AC-VERIFY-1). **(Confidence: LOW)**
3. **Activity/event persistence model.** The `003_*` table shape: which fields (`board_id`, `card_id`, `from_status`, `to_status`, `created_at`, and possibly a denormalized `card_title` so the feed still reads well after a card is deleted; `actor` deferred pending auth)? FK `ON DELETE` behavior (cascade and lose history, or preserve)? And how backfill/replay works on (re)connect (Last-Event-ID vs. a `created_at`/id cursor). **(Confidence: LOW)**
4. **Fan-out & connection lifecycle.** Per-board vs. global subscription; in-process fan-out (e.g. an `EventEmitter` injected via the `createApp(deps)` composition root, mirroring the existing DI pattern) for the single-instance `docker compose` deployment; heartbeat/keepalive and connection cleanup. **Explicitly document the single-instance→multi-instance scaling boundary** (Postgres `LISTEN/NOTIFY` / Redis as the future promotion path) without building it now. **(Confidence: LOW)**
5. **Feed UX.** Where it renders (board-view side panel vs. collapsible drawer vs. a dedicated `/boards/:id/activity` route); newest-first ordering and how many items to show/retain; the empty / connecting / reconnecting / degraded states; and accessibility specifics — `aria-live` politeness level for new items, non-color status cues, and exact screen-reader phrasing (e.g. "Marco moved 'Deploy pipeline' from In Progress to Done", degrading to "someone moved…" while there is no auth/actor). **(Confidence: LOW)**

## Test Strategy

### Approach
- **Emphasis**: Split by layer, matching each layer's established convention. **Backend = integration-first** (Vitest + Supertest, drive the Express app with injected stubs, no live DB — per `systemPatterns.md` Testing Patterns and the 95/95 boards/cards suites). **Frontend = component/behavior** (Vitest + RTL, query by ARIA role/accessible name, mock the transport at a single client seam — per FEAT-004's 20/20 suite and the `frontend-patterns`/`testing-patterns` learned rules). One end-to-end journey test proves the real path: a `PATCH /cards/:id` status change → persisted activity row → pushed over the transport → rendered in the feed (stub-detection for AC-INTEGRATION-1).
- **Target test count**: ~26 (justified >20: a multi-service realtime feature spanning a new DB table + repository, event capture wired into the existing `PATCH` path, a brand-new push-transport endpoint with connection lifecycle / backfill / reconnection-replay, and a frontend feed with five UI states + accessibility. Each of the 10 ACs maps to ≥1 test; the transport and capture layers each need several). Exact per-file counts firm up after creative fixes the transport (SSE vs WS) and event-capture mechanism.

### File Organization
- **New test files**:
  - `src/activity/activity.repository.test.ts` — activity repo over a mocked `pg` pool: insert one movement row, `findRecentByBoard(boardId, limit)` backfill query, cursor/`after`-id query for replay (mirrors `cards.repository.test.ts`).
  - `src/activity/activity.routes.test.ts` (or `activity.stream.test.ts`) — the transport endpoint via Supertest/stubbed emitter: subscribe receives a live event, backfill on connect (bounded), replay from `Last-Event-ID`/cursor after a simulated gap, per-board scoping (board A subscriber does not receive board B events), degraded/close handling.
  - `frontend/src/hooks/useActivityStream.test.ts` — client transport hook state machine (connecting → open → message-append → reconnecting → degraded), mocking `EventSource`/socket.
  - `frontend/src/pages/BoardViewPage/ActivityFeed.test.tsx` — feed region render: newest-first order, human-readable phrasing incl. card title + from→to labels, `aria-live` announce, non-color status, empty/connecting/reconnecting/degraded states.
- **Extend existing**:
  - `src/cards/cards.routes.test.ts` — assert `PATCH /cards/:id` capture behavior: a real transition emits+persists exactly one event (AC-VERIFY-1/2), a no-op/non-status PATCH emits/persists nothing, and the PATCH response is unchanged/unblocked.
  - `src/app.test.ts` — inject stub activity deps (repo + emitter) into `createApp`, mirroring the existing boards/cards stub wiring.
  - `frontend/src/pages/BoardViewPage/BoardViewPage.test.tsx` — assert the Activity feed region is present on the board view (AC-ENTRY-1) and does not break existing column rendering.
  - `src/app.test.ts` CORS/proxy: N/A (transport reached via the existing Vite `/api` proxy; SSE needs no proxy change, WS needs `ws:true` — decided in creative).

### What NOT to Test
- The transport library internals (`EventSource`, `ws`, or the browser's SSE reconnection) — framework/runtime responsibility; test our lifecycle handling around it, not it.
- React framework internals, the router, and exact CSS/pixel layout — belongs to `/banyan-uat` + visual review; component tests assert roles/labels/order, not styling.
- Existing boards/cards/health behavior — already covered (95/95); only the new capture hook in the PATCH path is added-and-tested.
- Real multi-instance fan-out (Postgres `LISTEN/NOTIFY` / Redis) — explicitly out of scope; the single-instance in-process bus is what ships and is tested.
- The exact realtime latency number in CI — AC-VERIFY-3's p95<~2s is verified by construction (non-blocking emission, measured PATCH path staying <200ms) + a manual/UAT observation, not a flaky timing assertion in unit tests.

### Per-Phase Test Guidance
- **Phase 1 (activity model + event capture)**: ~8 — repo insert/backfill/cursor queries (~3); transition detection in the PATCH path: real transition → 1 row + 1 emit (AC-VERIFY-2), same-status PATCH → 0 (AC-VERIFY-1), non-status-field PATCH → 0, `from_status`/`to_status` constrained to the `CardStatus` enum (CHECK), correct `board_id`/`card_id` (~5). PATCH response shape/latency-path unchanged.
- **Phase 2 (transport + backfill/replay)**: ~10 — subscribe receives a live event (AC-HAPPY-1 server side); bounded backfill on connect (AC-ASYNC-1); replay of gap events via `Last-Event-ID`/cursor after reconnect (AC-ASYNC-2); per-board scoping; heartbeat/keepalive + connection cleanup on disconnect (no leak); degraded/failed transport surfaced (AC-ERROR-1 server side); emission is async and does not block/slow the `PATCH` (AC-VERIFY-3 shape).
- **Phase 3 (frontend feed — completes the journey)**: ~8 — feed region present on board view (AC-ENTRY-1); a pushed event appends live without reload using a mocked stream (AC-HAPPY-1 end-to-end); newest-first ordering + human-readable phrasing + card title + from→to labels (AC-HAPPY-2); `aria-live` announce + non-color status; connecting/reconnecting/degraded/empty states (AC-ERROR-1 client, AC-ASYNC-2 client); backfill renders on connect (AC-ASYNC-1 client); the journey test: real capture → transport → DOM, two distinct moves differ (AC-INTEGRATION-1).
- **Post-UAT E2E**: after `/banyan-uat` PASS, implement the generated framework-agnostic E2E spec as runnable tests (per the Level 4 workflow's post-UAT E2E build).

## Architectural Plan (Level 4)

### Executive Summary
Add a board-scoped, read-only **realtime activity feed** that shows card movements (`status` changes) as they happen, without polling. The work has a backend spine (capture status transitions on the existing `PATCH /cards/:id` path → persist to a new `003_*` activity table → fan out over the project's first server→client push transport) and a frontend surface (a live, accessible feed on the board view). It is deliberately phased and gated by two creative explorations before build.

### Business Context
Directly serves the product's core value ("see status at a glance; keep cards flowing to Done" — productBrief Priya persona) and the FEAT-005 roadmap entry. It is the first feature to make the board *feel live*, closing the loop for contributors (Marco sees his own move register) and observers (Sam glances without refreshing). It is also a deliberate capability investment: the project's first realtime transport, which FEAT-005's own description frames as foundational.

### Vision & Goals
- **Vision**: The board updates itself — when work moves, everyone watching sees it immediately and understandably.
- **Goals** (measurable): a status change is visible to other connected clients within p95 < ~2s (AC-VERIFY-3); the `PATCH` write path stays within the existing p95 < 200ms NFR (non-blocking capture); the feed is WCAG 2.1 AA accessible (AC-HAPPY-2); no card movement is silently lost across a reconnect (AC-ASYNC-2).

### Architectural Principles (non-negotiables carried from systemPatterns.md)
- **Simplicity-first**: do not build multi-instance pub/sub for a single-instance `docker compose` deployment — in-process fan-out for MVP, scaling boundary documented not built.
- **DI at the composition root**: the event bus and activity repository are constructed in `src/server.ts` and injected into `createApp(deps)`; the app factory stays pure and testable with stubs.
- **Driver/infrastructure isolation**: all `pg` for activity confined to the activity repository; the transport endpoint depends on injected function types, not concrete infra.
- **12-factor**: transport/backfill knobs (endpoint path, backfill size, heartbeat interval) from env with local-dev defaults in `docker-compose.yml`.
- **Fail-safe**: a broken transport degrades gracefully (AC-ERROR-1) and never takes down board reads or the write path.

### Requirements
- **Functional**: capture real status transitions (not no-ops); persist them; push live; backfill on connect; replay on reconnect; render an accessible board-scoped feed. (See the 10 ACs above.)
- **Non-functional**: perf (2 budgets above), accessibility (WCAG 2.1 AA), observability (structured logs on capture + connection lifecycle), 12-factor config.

### Observability Requirements
- **Applies: YES** — this introduces a new long-lived server capability (push transport + connection lifecycle) and a new write-path side-effect (event capture). Use the existing structured `log()` abstraction (`src/config/logger.ts`, JSON-per-line) — **no `console.log`**.
  - **Logging**: structured events on capture (`activity.captured` with board_id/card_id/from→to), connection lifecycle (`activity.stream.open`/`close`/`reconnect`), and backfill/replay (count, cursor). Levels via `LOG_LEVEL`; never log PII/tokens (none exist today — no auth).
  - **Tracing/metrics**: the project currently ships only the minimal `log()` wrapper (full OpenTelemetry SDK is aspirational per CLAUDE.md, not yet wired). Plan documents structured logging now; a dedicated span/metric per event is deferred unless the transport creative surfaces a concrete need. Flag as a known gap, do not over-build.

### API Requirements
- **REST API**: **Yes — one new endpoint** (the push transport). Shape depends on the transport decision (creative Q1): for SSE, e.g. `GET /activity/stream?board_id=:id` returning `text/event-stream` with `Last-Event-ID` support; for WS, an upgrade endpoint. Plus (likely) a small `GET /activity?board_id=:id&limit=` for the initial/backfill read if not folded into the stream's connect frame. Build agents MUST load `${CLAUDE_PLUGIN_ROOT}/context/api-rest-requirements.md` and `${CLAUDE_PLUGIN_ROOT}/context/observability-requirements.md` in the relevant build phases. Reachable through the Vite `/api` proxy (SSE: no change; WS: `ws:true` + an `http.Server` upgrade seam in `src/server.ts`).
- **GraphQL API**: No.
- **Schema change**: new `db/init/003_*.sql` activity table (additive; follows `001`/`002` conventions — identity PK, `TIMESTAMPTZ` defaults, FK to `boards`/`cards`, indexed FK). No change to `boards`/`cards` schemas.

### Dependencies & Risks
- **Dep (satisfied)**: FEAT-001 (app factory, pool, logger), FEAT-002/003 (`PATCH /cards/:id` event source, `CardStatus` enum), FEAT-004 (React SPA surface). All COMPLETE.
- **Risk — transport choice lock-in**: SSE vs WS shapes the server (`http.Server` seam), the proxy, and the client hook. → Mitigation: resolve in Architecture creative *before* Phase 2; Phase 1 (capture+persist) is transport-agnostic and can proceed regardless.
- **Risk — event-capture correctness** (double-emit, emit-on-no-op, missing the old status): the current PATCH handler doesn't read the prior card and the repo always bumps `updated_at`. → Mitigation: creative Q2 designs old-vs-new detection; AC-VERIFY-1/2 lock the behavior with tests.
- **Risk — non-blocking emission**: capture must not slow the `PATCH` (p95<200ms). → Mitigation: emit after the DB write commits / off the response path; AC-VERIFY-3 verifies the write path is unregressed.
- **Risk — connection/resource leaks**: long-lived connections need cleanup + heartbeat. → Mitigation: lifecycle tests in Phase 2 (cleanup on disconnect, no leak).
- **Risk — reconnect gaps**: events during a drop must replay. → Mitigation: persist-first + `Last-Event-ID`/cursor replay (AC-ASYNC-2); the feed is backed by the DB, not just the live stream.
- **Risk — accessibility regressions** (WCAG 2.1 AA): `aria-live` chattiness, color-only status. → Mitigation: bake into UI/UX creative; assert roles/labels in component tests; verify in `/banyan-uat`.
- **Risk — scope creep** (actor identity, non-status events, multi-instance): explicitly bounded out; documented in Scope Boundaries.

## Implementation Roadmap

Four stages: three build phases (each independently testable; Phase 3 completes the entry→success journey) plus a post-UAT E2E implementation, per the Level 4 workflow. Concrete transport/model/UX choices are resolved in the two Creative phases below **before** Phase 1/2/3 build begins.

- [x] **Phase 1 — Activity model + event capture (transport-agnostic backend foundation).** ✅ BUILD COMPLETE (2026-07-15)
  - Add `db/init/003_*.sql` activity table (per creative event-model decision: `board_id`, `card_id`, `from_status`, `to_status`, `created_at`, optional denormalized `card_title`; identity PK, `TIMESTAMPTZ` default, FK to boards/cards with decided `ON DELETE`, indexed FK + a `(board_id, id)` index for backfill/replay; CHECK on statuses).
  - `src/activity/activity.types.ts` + `src/activity/activity.repository.ts` (DI, mirrors `CardsRepository`): `record(event)`, `findRecentByBoard(boardId, limit)`, `findAfter(boardId, cursor)`.
  - Wire status-transition detection into `PATCH /cards/:id` (`src/cards/cards.routes.ts`) per creative Q2 (old-vs-new via fetch-before-update or `RETURNING` old): on a real transition, persist one event and emit to an injected in-process `ActivityEmitter` (added to `AppDeps` in `src/app.ts`, constructed in `src/server.ts`); no-op/non-status PATCH emits/persists nothing; emission off the response path.
  - Structured logs on capture. **Delivers**: AC-VERIFY-1, AC-VERIFY-2, persistence half of AC-INTEGRATION-1. **Depends on**: Architecture creative (event model + capture mechanism).

- [x] **Phase 2 — Realtime push transport + backfill/replay (backend).** ✅ BUILD COMPLETE (2026-07-15)
  - New `/api`-reachable transport endpoint (SSE or WS per creative Q1); if WS, add the `http.Server` upgrade seam to `src/server.ts` and `ws:true` to the Vite proxy.
  - Per-board subscription + in-process fan-out from the `ActivityEmitter`; bounded backfill on connect from the activity repo; reconnection/replay via `Last-Event-ID`/cursor; heartbeat/keepalive; connection cleanup; 12-factor knobs (path, backfill size, heartbeat) via env.
  - Structured logs on connection lifecycle. **Delivers**: server side of AC-HAPPY-1, AC-ASYNC-1, AC-ASYNC-2, AC-VERIFY-3, AC-ERROR-1 (server). **Depends on**: Architecture creative (transport + fan-out/lifecycle).

- [x] **Phase 3 — Frontend live feed UI (completes the entry→success journey).** ✅ BUILD COMPLETE (2026-07-15)
  - Client transport seam (`frontend/src/api/activityStream.ts` — the single place that opens `EventSource`/socket, mirroring the `api/client.ts` discipline) + `hooks/useActivityStream.ts` state machine (connecting/open/reconnecting/degraded, append-on-message, backfill).
  - Feed surface on the board view per UI/UX creative (panel vs drawer vs `/boards/:id/activity`): newest-first, human-readable items (card title + from→to labels), `aria-live` announce, non-color status, and empty/connecting/reconnecting/degraded states; renders backfill on connect.
  - **Delivers**: AC-ENTRY-1, AC-HAPPY-1 (end-to-end), AC-HAPPY-2, AC-ASYNC-1/2 (client), AC-ERROR-1 (client), completes AC-INTEGRATION-1 end-to-end. **Depends on**: UI/UX creative.

- [ ] **Phase 4 (post-UAT) — E2E test implementation.**
  - After `/banyan-uat TASK-005` PASS, implement the generated framework-agnostic E2E spec as runnable tests (real capture → transport → feed render; reconnect/backfill). **Delivers**: automated coverage of the full journey. **Depends on**: `/banyan-uat` PASS.

### Observability Requirements
- **Applies**: Yes (see Architectural Plan → Observability Requirements). Structured logging on capture + connection lifecycle via the existing `log()`; no `console.log`; env-driven levels; OTEL spans/metrics deferred (documented gap).

### API Requirements
- **REST API**: Yes — one new push-transport endpoint (SSE `GET /activity/stream?board_id=` or WS upgrade, per creative) + likely a small backfill read; additive `003_*` schema. Build agents load `api-rest-requirements.md` + `observability-requirements.md`. **GraphQL**: No.

## Creative Phases

Level 4 → creative exploration REQUIRED before build. Two phases (mirroring FEAT-004's successful Architecture + UI/UX split); they map onto the five LOW-confidence questions in the Specification. A **User Journey** phase was added later (2026-07-15) to unblock `/banyan-uat`.

- [x] **User Journey Design** → COMPLETE → `memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md`. UAT-walkable journey grounded in the shipped read-only UI. Key finding: the board exposes **no write controls** (verified across `Card.tsx`/`Column.tsx`/`Columns.tsx`/`api/client.ts`), so the only status-change trigger is a direct `PATCH /api/cards/:id` (driven in-page via the `/api` proxy — genuine end-to-end path, one browser context). Second finding: **only the feed is live; columns render from a one-time fetch**, so AC-HAPPY-1's "column counts reflect the move" is a post-reload check, not a live-column expectation. Four walk sections (Happy / Mobile 375×667 / Negative — N/A no-auth, verifies zero write affordances / Error — reconnecting→degraded via request-blocking + gap-replay), each with numbered steps, per-step Actor (team_lead/contributor/stakeholder), Verify checklist, and Cleanup. All ACs mapped.

- [x] **Architecture Design** → COMPLETE → `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`. Decisions: **Q1 Transport = SSE** (`GET /api/activity/stream?board_id=:id` → `text/event-stream`; traverses the existing Vite `/api` proxy unchanged, keeps `src/server.ts` on `app.listen`, native `Last-Event-ID` reconnect, Supertest-testable; WS/long-poll rejected). **Q2 Capture = atomic old-vs-new via a `RETURNING` CTE inside `cards.repository.update()`**, orchestrated in the `PATCH /cards/:id` handler; activity INSERT awaited (persist-first, backs replay), in-memory emit off the response path; gated on `previousStatus !== newStatus` (no-op/non-status PATCH emits nothing — AC-VERIFY-1/2/3). **Q3 Persistence = new `card_activity` table**: identity PK `id` (doubles as cursor), `board_id` FK `ON DELETE CASCADE`, `card_id` FK `ON DELETE SET NULL`, denormalized `card_title` (survives deletion), CHECK-constrained `from_status`/`to_status`, `created_at`; composite `(board_id, id)` index for backfill+replay; cursor via `Last-Event-ID`; `actor` deferred (additive when auth lands). **Q4 Fan-out = per-board in-process `ActivityEmitter`** (`Map<boardId, Set<handler>>`) injected via `createApp(deps)` (`AppDeps` gains `activityRepo` + `activityEmitter`, constructed in `src/server.ts`); subscribe-before-backfill with dedupe by `id`; `ACTIVITY_HEARTBEAT_MS` keepalive; `req.on('close')` cleanup (no leak); single→multi-instance boundary (Postgres `LISTEN/NOTIFY`/Redis) documented behind the emitter interface, NOT built.
- [x] **UI/UX Design** → COMPLETE → `memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md`. Decisions: **Placement = persistent side panel** — desktop (>1024px) a 4th CSS Grid track (`repeat(3,1fr) minmax(260px,320px)`) right of the columns; tablet (640–1024px) full-width row below the columns; mobile (<640px) 4th stacked section after Done (drawer + dedicated route rejected — the latter fails AC-ENTRY-1's "on `/boards/:id`"). **Item phrasing** = `{actor} moved "{card_title}" from {From} to {To}` with `{actor}` = "Someone" today (only token that changes when auth lands); deleted cards render identically (denormalized `card_title`); absolute timestamps via `<time dateTime>` (extends `Card.tsx`'s `formatDueDate`). **Five states**: connecting (reuse `Loading`), open+streaming (newest-first `<ul>`), open+empty (reuse `EmptyState`, calm copy), reconnecting (new `ActivityFeedStatus` banner `role="status"`, list stays visible), degraded (`ActivityFeedStatus` `role="alert"`, list frozen/visible, rest of board unaffected — AC-ERROR-1). **a11y**: `aria-live="polite"` on a **visually-hidden dedicated announcer** decoupled from the visible list, with an "arming heuristic" (quiet period after entering/re-entering `open`) so backfill + reconnect-replay bursts are silent and only genuinely-new live events announce (kills the chatty-feed risk); status conveyed by text (from→to), no focus stealing on append. **Components**: `ActivityFeed` (region+hook), `ActivityFeedItem`, `ActivityFeedStatus` (new, feed-local), `useActivityStream` hook (mirrors `useApiResource`), `api/activityStream.ts` (the `EventSource` seam, mirrors `api/client.ts`); reuses `Loading`/`EmptyState` unmodified.

---

## Execution State

**Build Status**: IDLE
**Current Build**: Phase 3: Frontend live feed UI (TASK-005)
**Phase Number**: 3 of 4 (3 build phases done; UAT PASS; reflection done; Phase 4 E2E DEFERRED)
**Is Multi-Phase**: YES
**Current Phase**: COMPLETE
**Current Step**: `/banyan-archive` COMPLETE — Task Archive (Phase 4 deferred as tracked follow-up); local-merge to main
**Latest Commit**: 653ecd1 (reflection); archive commit + merge to main follow
**Can Resume**: NO

### Reflection (run 2026-07-15)
- **Ratings**: Task Implementation Quality = ✅ Success; Ecosystem Effectiveness = ✅ Highly Effective.
- **Doc**: `memory-bank/reflection/reflection-TASK-005.md` (Level 4 template).
- **Continuous learning**: 4 learnings extracted — created `connection-lifecycle.md`; amended `data-access.md` (ec→3, promoted low→medium), `frontend-patterns.md` (ec→2), `infrastructure.md` (ec→2, +deployment/migrations scope). 8 learned files (under cap 10).
- **Open follow-ups (carry to archive)**: (1) Phase 4 — implement the generated E2E spec (`memory-bank/uat/spec-TASK-005-e2e.md`) or explicitly defer; (2) REC-1 — no migration path for existing deployments, missing `card_activity` table fails silently to empty feed (add migration runner + readiness signal); (3) REC-2 — mobile breakpoint unverifiable in the UAT MCP; replace client arm-timer heuristic with a server backfill-complete sentinel.

### Active Sub-Agents (REFLECT)
- Reflection Agent (Sonnet): COMPLETE — wrote `memory-bank/reflection/reflection-TASK-005.md`

### UAT (run 20260715-uat-inline, 2026-07-15)
- **Verdict**: PASS_WITH_RECOMMENDATIONS — Required=0, Recommended=2, Optional=0. All 10 ACs verified.
- **Setup added to unblock**: `memory-bank/uat-config.md`, `memory-bank/ux-patterns.md` (scaffold), `memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md`, `.auth/` added to `.gitignore`, header status corrected CREATIVE_COMPLETE→BUILD_COMPLETE→UAT_PASS.
- **Walk**: inline single-context browser walk against seeded board 1 ("Q3 Delivery Board", 4 cards, 3 activity rows). Verified live: entry region (ENTRY-1), backfill (ASYNC-1), live push 229ms no-reload (HAPPY-1, VERIFY-3), phrasing + newest-first + aria-live announce (HAPPY-2), no-op gating at feed+DB (VERIFY-1), one-row-per-transition at DB (VERIFY-2), distinct real items (INTEGRATION-1), Last-Event-ID replay no-gap/no-dupe + reconnecting banner (ASYNC-2), degraded `role="alert"` "Activity feed offline" with board unaffected (ERROR-1), read-only feed (no write controls).
- **Pre-flight remediation (env, not a product bug)**: dev Postgres volume predated `003_card_activity.sql`; table was missing so capture silently no-opped (fail-safe swallow). Applied the idempotent `003` migration in place (no data dropped). → **REC-1**: no migration path for existing deployments + missing table fails silently to an empty feed (add migration runner + readiness signal).
- **REC-2**: mobile breakpoint not verifiable — the UAT MCP renders at a fixed large viewport; covered by responsive CSS + the E2E spec's device-emulation case.
- **Outputs**: `memory-bank/uat/uat-TASK-005.md` (report), `memory-bank/uat/spec-TASK-005-e2e.md` (framework-agnostic E2E spec).

### Completed Steps (Phase 3 build)
- Step 3 Test Writer: 13 tests RED — `activityStream.test.ts` (3), `useActivityStream.test.ts` (4), `ActivityFeed.test.tsx` (5), `BoardViewPage.test.tsx` (+1 mount, region 3→4), shared `test/fakeEventSource.ts`
- Step 4 Coding Agent: `api/activityStream.ts` (EventSource seam, VITE_API_BASE_URL default /api, encodeURIComponent id), `hooks/useActivityStream.ts` (status machine connecting/open/reconnecting/degraded, dedupe-by-id newest-first, arming heuristic, degraded timer, fail-safe try/catch on EventSource construction), `ActivityFeed`/`ActivityFeedItem`/`ActivityFeedStatus`, shared `statusLabels.ts` (Columns.tsx refactored to share it), `BoardViewPage` mounts the feed, `index.css` (desktop 4th grid track via `.columns{display:contents}`, tablet/mobile stacked, `.visually-hidden`)
- Step 6-7 Verification (initial): 33/33 frontend tests PASS; `tsc --noEmit` clean; `vite build` PASS (70.4 kB gzip)
- Step 8 Code Review (build-code-reviewer-agent): **BLOCK → resolved**. 3 findings: (1) boardId change didn't reset feed state → stale cross-board items + skipped connecting; (2) arm-timer latches for connection life → a >250ms intra-burst gap could announce a historical frame; (3) identical repeated announcement text not re-announced (contradicts creative a11y §5). **Fixed**: (1) reset all per-connection state at effect start; (3) key the announcer's inner node by `seq` so each announcement replaces the DOM node (synchronous, re-announces identical text); (2) kept the quiet-period heuristic (correct given the Phase 2 server flushes each batch synchronously as a contiguous burst) + documented the residual and the proper fix (server backfill-complete sentinel — future follow-up). Reverted the reviewer's one non-blocking empty-state if/else suggestion (broke a test that relies on the list always rendering). Added 2 regression tests (board-switch reset; seq bumps for identical text)
- Step 6-7 Verification (post-fix): 35/35 frontend tests PASS (was 20 FEAT-004 → +13 Phase 3 → +2 regression); `tsc` clean; `vite build` PASS (70.5 kB gzip). Backend unchanged (118/118).
- Step 9-10 Docs/Memory: this file + systemPatterns.md + techContext.md + tasks.md + progress.md

**Delivers (completes the journey)**: AC-ENTRY-1, AC-HAPPY-1 (end-to-end live), AC-HAPPY-2 (phrasing + a11y announcer), AC-ASYNC-1/2 (client backfill + reconnect states), AC-ERROR-1 (client degraded), AC-INTEGRATION-1 (real capture→transport→DOM). **All 11 ACs now met end-to-end in code + tests.** Remaining: `/banyan-uat TASK-005` (a11y/live browser walk) → Phase 4 (post-UAT E2E).

### Completed Steps (Phase 2 build)
- Step 3 Test Writer: 10 tests RED — `activity.routes.test.ts` (9) + `app.test.ts` (+1 mount smoke). Contract: `activityStreamHandler(repo,emitter,config)` exported separately + `createActivityRouter(...)` mounting `GET /activity/stream`; env knobs `ACTIVITY_BACKFILL_LIMIT`(50)/`ACTIVITY_HEARTBEAT_MS`(15000)
- Step 4 Coding Agent: `src/activity/activity.routes.ts` (SSE handler — validate board_id→400, SSE headers+flushHeaders, subscribe-before-backfill with buffer+dedupe-by-id seam, Last-Event-ID→findAfter replay / else findRecentByBoard backfill, one frame per event oldest→newest, heartbeat, req.on('close') cleanup, fail-safe catch); `env.ts` + `app.ts` + `server.ts` + `docker-compose.yml` wiring for the two env knobs
- Step 6-7 Verification (initial): 115/115 tests PASS; `tsc` build clean
- Step 8 Code Review (build-code-reviewer-agent): **BLOCK → resolved**. Found 2 real blocking bugs the tests missed: (1) `req.on('close')` registered after the backfill await → disconnect-mid-read leaked subscription+heartbeat and risked a write-after-close crash; (2) malformed `Last-Event-ID` → `NaN` cursor silently dropped buffered live events. **Both fixed**: cleanup now registered before the await with an idempotent `closed` flag guarding all writes + a no-heartbeat-if-closed guard; `parseCursor()` validates the header, falling back to full backfill on malformed input. Added 3 regression tests (disconnect-during-backfill cleanup, malformed-cursor fallback + buffered-event survival, fail-safe catch degrades to live-only)
- Step 6-7 Verification (post-fix): 118/118 tests PASS (was 95 → +10 Phase-1 incl. fail-safe → +13 Phase-2 incl. 3 regression); `tsc` build clean; lint N/A
- Step 9-10 Docs/Memory: this file + systemPatterns.md + techContext.md + tasks.md + progress.md

**Delivers (server side)**: AC-HAPPY-1 (live event → frame), AC-ASYNC-1 (backfill on connect), AC-ASYNC-2 (Last-Event-ID replay + no-gap buffering, robust to malformed cursor), AC-ERROR-1 (400 validation + fail-safe read + leak-free teardown), AC-VERIFY-3 (emission off the PATCH path). Frontend consumption is Phase 3.

### Completed Steps (Phase 1 build)
- Step 0.5 Git Setup: feature/FEAT-005-realtime-activity-feed created; plan+creative baseline committed (12d4f3d)
- Step 3 Test Writer: 9 tests RED — `activity.repository.test.ts` (4), `cards.routes.test.ts` capture block (+5), `app.test.ts` stub wiring. Flagged architecture Q2 `update()` → `{ card, previousStatus }` companion edit (in scope)
- Step 4 Coding Agent: `db/init/003_card_activity.sql` (identity PK/cursor, board_id CASCADE, card_id SET NULL, denormalized card_title, CHECK statuses, `(board_id,id)` index); `src/activity/{activity.types,activity.repository,activity.emitter}.ts`; `cards.repository.update()` → atomic old-vs-new `RETURNING` subquery returning `{ card, previousStatus }`; `cards.routes.ts` PATCH capture hook (gated on real transition, persist-first then emit, fail-safe try/catch, `activity.captured` log, response contract unchanged); `AppDeps`+`server.ts` wiring; companion edit to `cards.repository.test.ts` update block
- Step 6-7 Verification: 105/105 tests PASS (was 95; +9 capture/repo +1 fail-safe); `tsc` build clean; lint N/A
- Step 8 Code Review (build-code-reviewer-agent): APPROVE-WITH-FIXES, 0 blocking. Applied both non-blocking fixes (emitter per-handler try/catch isolation + snapshot; index name aligned to architecture doc) + added the recommended AC-VERIFY-3 capture-failure fail-safe test
- Step 9-10 Docs/Memory: this file + systemPatterns.md + techContext.md + tasks.md + progress.md

**Delivers**: AC-VERIFY-1 (no-op/non-status → no event), AC-VERIFY-2 (one row + one emit per real transition), AC-VERIFY-3 fail-safe (capture never fails PATCH), persistence half of AC-INTEGRATION-1.

### Active Sub-Agents
- Architecture Design (Opus): COMPLETE — `creative/TASK-005-realtime-activity-feed-architecture.md` (SSE, RETURNING-CTE capture, card_activity table, per-board in-process emitter)
- UI/UX Design (Sonnet): COMPLETE — `creative/TASK-005-realtime-activity-feed-uiux.md` (persistent side panel, 5 states, visually-hidden armed aria-live announcer)
- Spec Writer Agent (Opus): COMPLETE — wrote `## Specification` (10 ACs, taxonomy CLEAN)

### Completed Steps (CREATIVE phase)
- Architecture Design (Opus): COMPLETE — resolved Q1–Q4
- UI/UX Design (Sonnet): COMPLETE — resolved Q5 (built on the SSE architecture)

### Completed Steps
- Step 0.1: Auto-provisioned TASK-005 for FEAT-005 (Level 4), registered + linked
- Step 3: Spec Writer Agent (Opus) — drafted End-User Feature spec; 10 ACs (1 ENTRY / 2 HAPPY / 2 ASYNC / 1 ERROR / 3 VERIFY / 1 INTEGRATION); 5 LOW-confidence creative questions flagged
- Step 3.2a: Taxonomy Lint Gate — PASS (CLEAN, 0 errors / 0 warnings)
- Step 3.2: Human review — APPROVED ("Approve — build the plan")
- Step 4-5: Codebase analysis + implementation plan — Test Strategy (~26 tests, backend integration + frontend component + 1 journey), 4 stages (3 build phases + post-UAT E2E), Architectural Plan (Level 4: business context, vision, principles, observability, API), Observability=Yes (structured logging), REST API=1 new transport endpoint + additive 003_* schema, dependencies + risks
- Step 6: Finalized — validation gate PASS; 2 creative phases flagged REQUIRED (Architecture Design, UI/UX Design)
