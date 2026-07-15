# Architecture Decision: Realtime Activity Feed (Backend / Infrastructure)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: Architecture
**Task**: TASK-005 (Level 4, FEAT-005)
**Scope**: Backend/infrastructure only — resolves creative Q1–Q4 (transport, event capture, persistence model, fan-out/lifecycle). Feed UX (Q5) is owned by the UI/UX agent and is out of scope here.

## Context

### System Requirements
- Capture a card-movement event whenever `PATCH /cards/:id` changes `status` (the FEAT-003 path — `src/cards/cards.routes.ts`), and **only** on a real transition (`from_status` ≠ `to_status`).
- Persist each transition as an activity record in a new `db/init/003_*.sql` table, following the `001`/`002` conventions.
- Push events live to connected clients over the project's first server→client transport, board-scoped, without polling.
- Backfill recent history on connect; replay missed events on reconnect (no silent gap).
- Surface a degraded/offline state when the transport fails; never take down board reads or the write path.

### Technical Constraints
- **Express app factory** (`src/app.ts` `createApp(deps)`) is pure/side-effect-free; all I/O is injected via `AppDeps` and constructed at the composition root (`src/server.ts`).
- `src/server.ts` calls `app.listen(...)` **directly** — there is no `http.createServer` / upgrade seam today (matters for WebSocket).
- The frontend reaches the API only through the Vite `/api` proxy (`frontend/vite.config.ts`), which rewrites `/api/*` → API and does **not** set `ws: true`.
- `PostgresCardsRepository.update()` (`src/cards/cards.repository.ts`) returns **only the new row** and **always** appends `updated_at = now()`; the route handler does **not** read the prior card. Old-vs-new detection must be designed deliberately.
- `CardStatus = 'todo' | 'in_progress' | 'done'` (`src/cards/cards.types.ts`), persisted as `VARCHAR(20)` + CHECK (mirroring `002_cards.sql`).
- Query layer is raw `pg` via a pool (`src/db/pool.ts`); all SQL is parameterized and confined to repositories (driver-isolation principle).
- Structured logging is the tiny `log(level, msg, meta)` JSON-per-line wrapper (`src/config/logger.ts`); **no `console.log`**. Full OpenTelemetry SDK is aspirational, not yet wired (documented gap).
- Config is 12-factor: env vars only in app code; local-dev defaults live in `docker-compose.yml` as `${VAR:-default}`.
- Single-instance deployment via `docker compose` (`api` + `db`). Multi-instance fan-out is explicitly out of scope (boundary must be documented, not built).

### Non-Functional Requirements
- **Write path**: `PATCH /cards/:id` stays p95 < 200ms (event capture must not block/regress it — AC-VERIFY-3).
- **Realtime delivery**: p95 < ~2s from PATCH acknowledgement to feed render (AC-VERIFY-3).
- **Observability**: structured logs on capture and connection lifecycle via `log()`.
- **Testability by construction**: the whole design must be exercisable with Vitest + Supertest and injected stubs — **no live DB** (per `systemPatterns.md` Testing Patterns and the boards/cards 95/95 suites).
- **Fail-safe**: a broken transport degrades gracefully; board reads and the write path are unaffected.

### Existing Patterns That Must Be Respected (from systemPatterns.md Guiding Principles)
- Simplicity-first clean architecture (shallow layers; abstraction only on concrete need).
- 12-factor configuration.
- Dependency injection at the composition root (`createApp(deps)` pure; I/O built in `server.ts`).
- Driver/infrastructure isolation (all `pg` in the repository).
- Fail-safe liveness.
- Testability by construction (stubs via Supertest, no live DB).
- **Learned rules applied**: parameterized dynamic UPDATEs + indexed FK column (data-access); `:id` parse → 404 uniformly, FK-existence check → 400 before insert (api-design); env defaults only in compose (configuration); central error middleware + fail-safe (error-handling); stateful in-memory stub repos + role/label queries (testing-patterns).

## Component Analysis

### Core Components
| Component | Purpose | Responsibilities |
|-----------|---------|------------------|
| `003_card_activity.sql` | Activity persistence schema | Identity PK (doubles as event id/cursor), FKs to boards/cards, denormalized `card_title`, CHECK-constrained statuses, `(board_id, id)` index for backfill + replay |
| `src/activity/activity.types.ts` | Domain shapes | `CardActivity`, `RecordActivityInput`, `ActivityEvent` (wire) |
| `src/activity/activity.repository.ts` | Data-access (driver-isolated) | `record(input)`, `findRecentByBoard(boardId, limit)`, `findAfter(boardId, cursorId, limit)` — all parameterized `pg` |
| `ActivityEmitter` (`src/activity/activity.emitter.ts`) | In-process fan-out seam | `subscribe(boardId, handler): unsubscribe`, `emit(boardId, event)`; per-board topics; the swap-point for multi-instance |
| `src/activity/activity.stream.ts` (router) | SSE transport endpoint | `GET /activity/stream?board_id=` — headers, subscribe, backfill/replay, heartbeat, cleanup |
| Capture hook in `cards.routes.ts` `PATCH` | Event capture | Detect real transition, persist one activity row, emit to the bus — off the response path |
| `cards.repository.ts` `update()` (modified) | Old-vs-new detection | Return the new row **plus** `previous_status` atomically (single round-trip) |
| `src/app.ts` `AppDeps` (extended) | Composition | Inject `activityRepo` + `activityEmitter`; wire into cards router (emit) and stream router (subscribe) |
| `src/server.ts` (extended) | Composition root | Construct the Postgres activity repo + the in-process emitter, inject into `createApp` |

### Component Interactions
```
PATCH /cards/:id { status }
  │  validateUpdateCard
  ▼
cardsRepo.update(id, input)         ── one round-trip (CTE): UPDATE ... RETURNING new row + prev_status
  │  route compares prev_status vs card.status
  ├─ equal, or non-status field only ─▶ 200 OK, NO activity row, NO emit          (AC-VERIFY-1)
  └─ real transition (old ≠ new):
        activityRepo.record({board_id, card_id, card_title, from, to})
                                     ── INSERT ... RETURNING id, created_at         (AC-VERIFY-2)
        activityEmitter.emit(board_id, event)   ── in-memory, O(subscribers), non-blocking
        200 OK  (write path unregressed)                                          (AC-VERIFY-3)

activityEmitter  (in-process; per-board topics keyed by board_id)
   └─▶ each subscribed SSE connection for that board_id:
         res.write(`id: ${id}\nevent: card_moved\ndata: ${json}\n\n`)             (AC-HAPPY-1)

GET /activity/stream?board_id=:id   (SSE — plain HTTP GET through the Vite /api proxy)
   set text/event-stream headers; flushHeaders()
   subscribe(board_id, handler)                     ← register FIRST (buffer live events)
   backfill = activityRepo.findRecentByBoard(id, N)  (fresh connect)              (AC-ASYNC-1)
   OR  replay = activityRepo.findAfter(id, Last-Event-ID)  (reconnect)            (AC-ASYNC-2)
   write backfill/replay frames → then flush buffered live frames (dedupe by id)
   heartbeat: `: keep-alive\n\n` every ACTIVITY_HEARTBEAT_MS
   req.on('close') → unsubscribe() + clearInterval()   (no leak)
   client EventSource auto-reconnects with Last-Event-ID on drop                 (AC-ERROR-1 client / AC-ASYNC-2)
```

---

## Q1 — Transport: SSE vs WebSocket vs Long-Polling

### Option 1: Server-Sent Events (SSE)
- **Description**: A long-lived HTTP `GET /activity/stream?board_id=` responding with `text/event-stream`; the server `res.write()`s framed events; the browser's native `EventSource` handles reconnection and `Last-Event-ID`.
- **Components**: An Express router only — no new server primitives. Reached through the Vite `/api` proxy as an ordinary GET (no proxy change).
- **Pros**:
  - Read-only, server→client — exactly SSE's shape; the feed never sends data upstream.
  - Zero changes to `src/server.ts` (`app.listen` stays) and zero changes to `frontend/vite.config.ts` — SSE traverses the existing `/api` proxy unchanged.
  - Native browser reconnection + `Last-Event-ID` header gives us gap-replay (AC-ASYNC-2) essentially for free.
  - Fully testable with Supertest (it's an HTTP response; assert framed `data:` lines against a stubbed emitter) — honours testability-by-construction with no live DB.
  - Built-in event `id:` field maps 1:1 onto our identity-PK cursor.
- **Cons**:
  - Unidirectional (fine here; a limitation only if the feed later needs client→server realtime, which is explicitly out of scope).
  - Browsers cap ~6 concurrent SSE connections per origin over HTTP/1.1 (a non-issue for a board-scoped feed on one tab; HTTP/2 removes it).
  - Proxies/load balancers can buffer or idle-close streams → mitigated by the heartbeat (Q4).
- **Technical Fit**: **High** — fits the Express + DI model and the proxy unchanged.
- **Complexity**: **Low**.
- **Scalability**: **Medium** — in-process fan-out is single-instance; promotion path documented (Q4). Same ceiling as WS.

### Option 2: WebSocket (`ws`)
- **Description**: A bidirectional socket upgraded from HTTP; a `ws` server attached to an `http.Server` handling the `upgrade` event.
- **Components**: `ws` dependency; an explicit `http.createServer(app)` seam in `src/server.ts`; `ws: true` on the Vite proxy; a custom subprotocol for board subscription + a hand-rolled reconnect/replay layer on the client.
- **Pros**:
  - Bidirectional and lowest per-message overhead — valuable **if** the feed ever needs client→server realtime.
  - Single connection can multiplex many boards.
- **Cons**:
  - **Bidirectional is overkill** for a read-only feed — pays complexity for a capability the scope forbids.
  - Forces a structural change to the composition root: replace `app.listen` with `http.createServer(app)` + `server.on('upgrade')`, plus `ws: true` on the proxy — new seams, more surface, against simplicity-first.
  - Reconnection + missed-event replay must be **hand-built** (no `Last-Event-ID` equivalent) — more code, more tests, more risk on AC-ASYNC-2.
  - Harder to exercise with Supertest (needs a WS test client); erodes testability-by-construction.
- **Technical Fit**: **Low** — introduces the one seam the current server deliberately lacks.
- **Complexity**: **High**.
- **Scalability**: **Medium** — same in-process fan-out ceiling as SSE; no scaling advantage at this size.

### Option 3: HTTP Long-Polling
- **Description**: Client repeatedly issues `GET /activity?board_id=&after=<cursor>`; the server holds the request until an event or a timeout, then responds; client immediately re-polls.
- **Components**: One ordinary REST route; a server-side wait/timeout loop.
- **Pros**:
  - Simplest transport primitive; traverses any proxy; trivially testable.
- **Cons**:
  - Higher latency and request churn; reconnection/held-request bookkeeping is fiddly.
  - Reinvents, worse, what SSE gives natively (streaming + reconnect + event ids).
  - No real advantage over SSE while costing more requests against the p95 budgets.
- **Technical Fit**: **Medium**.
- **Complexity**: **Medium**.
- **Scalability**: **Low** — request amplification.

### Evaluation Matrix (Q1)
| Criteria | SSE | WebSocket | Long-Polling |
|----------|-----|-----------|--------------|
| Fit to read-only server→client | High | Low (overkill) | Medium |
| Changes to server.ts / proxy | None | Both required | None |
| Reconnect + gap-replay | Native (`Last-Event-ID`) | Hand-built | Hand-built |
| Testability (Supertest, no live DB) | High | Low | High |
| Simplicity-first alignment | High | Low | Medium |
| Latency vs p95<2s | Meets | Meets | Marginal |

### **Chosen**: Option 1 — **Server-Sent Events (SSE)**.
**Rationale**: The feed is read-only server→client, which is precisely SSE's design point. SSE fits the existing Express + DI model and the Vite `/api` proxy **with no changes to `src/server.ts` or `vite.config.ts`**, whereas WebSocket forces an `http.createServer` upgrade seam the composition root deliberately lacks plus `ws: true` on the proxy — added surface for a bidirectional capability the scope explicitly forbids. SSE's native `Last-Event-ID` reconnection satisfies AC-ASYNC-2 almost for free, and an SSE endpoint is a plain HTTP response fully exercisable with Supertest against a stubbed emitter (testability-by-construction). This is the direct expression of the simplicity-first guiding principle.
**Trade-off accepted**: unidirectional and the ~6-connections-per-origin HTTP/1.1 cap — both irrelevant to a read-only, board-scoped feed on a single tab.

---

## Q2 — Event Capture Mechanism

### Option A: Fetch-before-update in the route handler
- **Description**: In `PATCH`, `SELECT` the card's current status, then call `update()`, compare old vs new.
- **Pros**: No repository signature change; obvious/readable.
- **Cons**: **Two round-trips** and a **race window** between the read and the write (a concurrent PATCH could change status in between, mis-detecting the transition). Extra DB work on every PATCH pushes against p95<200ms.
- **Fit**: Medium. **Complexity**: Low. **Correctness**: Medium (race).

### Option B: `RETURNING` old value atomically (CTE in `update()`)
- **Description**: `update()` reads the prior status and applies the update in **one** statement, returning the new row plus `previous_status`:
  ```sql
  UPDATE cards
     SET <dynamic sets>, updated_at = now()
    FROM (SELECT status AS prev FROM cards WHERE id = $k) AS old
   WHERE cards.id = $k
   RETURNING <COLUMNS>, old.prev AS previous_status;
  ```
  `update()` returns `{ card, previousStatus } | null`. The route compares `previousStatus` vs `card.status`.
- **Pros**: **Single round-trip**, **race-free** (old and new observed atomically), keeps all SQL in the repository (driver isolation), parameterized (data-access rule). Minimal added latency. Cleanly testable with the in-memory stub (the stub returns `{card, previousStatus}`).
- **Cons**: Changes the `CardsRepository.update` return contract — existing `cards.routes.test.ts`/stubs must be updated (the task explicitly extends these tests, so this is in scope).
- **Fit**: High. **Complexity**: Low–Medium. **Correctness**: High.

### Option C: Conditional `UPDATE ... WHERE status <> $new RETURNING`
- **Description**: Only update when the status actually differs.
- **Pros**: Emits precisely on change.
- **Cons**: **Breaks non-status PATCHes** — a title/description/due-date edit (which must still update and bump `updated_at`) would be filtered out by the `WHERE status <> $new` guard. Also conflates "no row" with "no change." Reject.
- **Fit**: Low. **Complexity**: Medium. **Correctness**: Low (wrong for the common edit path).

### Option D: PostgreSQL trigger writes the activity row
- **Description**: A `BEFORE/AFTER UPDATE` trigger on `cards` inserts an activity row when `OLD.status <> NEW.status`.
- **Pros**: Guaranteed capture regardless of caller; atomic with the card update.
- **Cons**: Hides business logic in the DB (against simplicity-first readability); **cannot drive the in-process Node emitter** (a trigger has no path to the `EventEmitter` without `LISTEN/NOTIFY`); **not exercisable with Supertest + stubs / no live DB** — directly violates testability-by-construction. Reject for MVP. **Note**: this is the *natural pairing* with the multi-instance promotion path (trigger + `LISTEN/NOTIFY`) — see Q4's scaling boundary.
- **Fit**: Low (given testability). **Complexity**: Medium. **Correctness**: High but untestable here.

### Where capture lives + non-blocking emission
Capture is orchestrated in the **`PATCH /cards/:id` route handler** (it has `board_id`, `card_id`, the card `title`, and both statuses). On a real transition it:
1. `await activityRepo.record({...})` — **one small indexed INSERT**. Awaited so the row is durably persisted *before* fan-out (persist-first backs backfill/replay integrity — AC-ASYNC-1/2). Total PATCH DB work is now two fast indexed queries, comfortably within p95<200ms.
2. `activityEmitter.emit(board_id, event)` — a **synchronous, in-memory** fan-out. It does not block the response: each subscriber write is a buffered `res.write()` on that subscriber's socket (Node buffers; the PATCH request never awaits a slow client). No external I/O is on the response path.

This satisfies "emission is off the response path" (AC-VERIFY-3): the only added cost to `PATCH` is one indexed INSERT; fan-out is in-memory and does not await network delivery. Capture is wrapped so a persistence/emit failure is logged (`log('error', ...)`) and **never** breaks the write path (fail-safe) — a card move still succeeds even if activity capture hiccups.

### Evaluation Matrix (Q2)
| Criteria | A: fetch-before | B: CTE RETURNING | C: conditional | D: trigger |
|----------|-----------------|------------------|----------------|-----------|
| Round-trips added | 1 (extra SELECT) | 0 (folded in) | 0 | 0 |
| Race-free old/new | No | Yes | Yes | Yes |
| Handles non-status edits | Yes | Yes | **No** | Yes |
| Driver isolation | Yes | Yes | Yes | Leaks to DB |
| Testable w/ stubs, no live DB | Yes | Yes | Yes | **No** |
| Simplicity/readability | Medium | High | Medium | Low |

### **Chosen**: Option B — **atomic old-vs-new via a `RETURNING` CTE in `cards.repository.update()`**, with capture orchestrated in the `PATCH` route handler; the activity INSERT is awaited (persist-first), the emit is a synchronous in-memory fan-out off the response path.
**Rationale**: Single round-trip and race-free, keeps all SQL in the repository (driver isolation, parameterized per the data-access rule), and stays fully testable with the in-memory stub. Non-status edits still update correctly (unlike Option C). The trigger (Option D) is rejected for MVP because it is untestable without a live DB and cannot reach the in-process emitter — but it is flagged as the natural companion to the `LISTEN/NOTIFY` multi-instance path.
**Trade-offs accepted**: the `CardsRepository.update` return type gains `previousStatus` (the cards tests are extended, already in scope); the activity INSERT adds one indexed round-trip to `PATCH` (measured to stay < 200ms).

**Maps to**: AC-VERIFY-1 (no-op / non-status PATCH → no row, no emit — gated on `previousStatus !== card.status`), AC-VERIFY-2 (exactly one well-formed row per real transition), AC-VERIFY-3 (write path unregressed), persistence half of AC-INTEGRATION-1.

---

## Q3 — Activity / Event Persistence Model

### Field decisions
| Field | Type | Rationale |
|-------|------|-----------|
| `id` | `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Monotonic identity PK (mirrors `001`/`002`); **doubles as the SSE event id / `Last-Event-ID` cursor** — no separate cursor column needed. |
| `board_id` | `INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE` | Feed is board-scoped; the primary query filter. Cascade: deleting a board removes its activity (board-scoped activity is meaningless without the board; consistent with `cards` cascade and productBrief "board deletion cascades"). |
| `card_id` | `INTEGER NULL REFERENCES cards(id) ON DELETE SET NULL` | **Preserve history** — deleting a card must not erase the record that it moved. `SET NULL` keeps the row; `card_title` (below) keeps it readable. |
| `card_title` | `VARCHAR(200) NOT NULL` | **Denormalized** snapshot so the feed still reads ("moved 'Deploy pipeline'…") after the card is deleted (when `card_id` is null). Width matches `cards.title`. |
| `from_status` | `VARCHAR(20) NOT NULL CHECK (from_status IN ('todo','in_progress','done'))` | Constrained to the `CardStatus` set, mirroring `002_cards.sql`. |
| `to_status` | `VARCHAR(20) NOT NULL CHECK (to_status IN ('todo','in_progress','done'))` | Same. A DB-level guard that `from` ≠ `to` is deliberately **not** added (the application gates emission; a redundant CHECK adds friction with no benefit). |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Mirrors `001`/`002`; used for human-readable timestamps in the feed. |
| ~~`actor`~~ | *(deferred)* | No auth exists (productBrief Open Question). Feed attributes generically ("someone"). Promotion: add `actor_id INTEGER NULL REFERENCES users(id)` when auth ships — purely additive. |

### FK `ON DELETE` — the deliberate asymmetry
- `board_id … ON DELETE CASCADE` — activity dies with its board.
- `card_id … ON DELETE SET NULL` — activity **survives** its card, preserving movement history.

This asymmetry is intentional: a board is the scope container (no board → no feed), whereas a card's history is worth keeping after the card is gone, which is exactly why `card_title` is denormalized.

### Index
```sql
CREATE INDEX card_activity_board_id_id_idx ON card_activity (board_id, id);
```
One composite index serves **both** access paths (index-only friendly): backfill (`WHERE board_id=$1 ORDER BY id DESC LIMIT n`) and replay (`WHERE board_id=$1 AND id > $cursor ORDER BY id ASC`). Mirrors the `cards_board_id_idx` learned pattern (index the FK/filter column) while adding `id` for the cursor scan/order.

### Backfill / replay cursor mechanism
**Chosen cursor = the activity row `id` (identity PK), surfaced as the SSE `id:` field and consumed via `Last-Event-ID`.**
- **Backfill (fresh connect)**: `findRecentByBoard(boardId, limit)` → `WHERE board_id=$1 ORDER BY id DESC LIMIT $2`, reversed to oldest→newest for display (AC-ASYNC-1).
- **Replay (reconnect)**: `findAfter(boardId, cursorId, limit)` → `WHERE board_id=$1 AND id > $2 ORDER BY id ASC LIMIT $3` (AC-ASYNC-2).
- **Why `id` over `(created_at, id)`**: the identity PK is strictly increasing and unique per row — no tie-breaking, no clock-skew, no composite-cursor encoding. `EventSource` sends the last `id:` it saw as `Last-Event-ID` natively, so the mapping is 1:1 and requires zero client bookkeeping.
- **Documented caveat**: identity values are assigned at INSERT; under concurrent inserts a higher `id` could become visible before a lower one commits, which could theoretically let a subscriber's cursor skip a still-uncommitted lower `id`. For a single-instance, low-concurrency small-team tool this is acceptable (and `(created_at, id)` would not fix it either). Flagged, not engineered around.

### `003_card_activity.sql` DDL sketch
```sql
-- 003_card_activity.sql — third schema for BanyanBoard (FEAT-005 / TASK-005).
-- Runs after 001_boards.sql and 002_cards.sql (both FK targets must exist).
-- Records a row per real card status transition captured on PATCH /cards/:id.
-- The identity PK doubles as the realtime event id (SSE Last-Event-ID cursor).

CREATE TABLE IF NOT EXISTS card_activity (
  id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id    INTEGER      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id     INTEGER               REFERENCES cards(id)  ON DELETE SET NULL,
  card_title  VARCHAR(200) NOT NULL,                        -- denormalized: survives card deletion
  from_status VARCHAR(20)  NOT NULL CHECK (from_status IN ('todo', 'in_progress', 'done')),
  to_status   VARCHAR(20)  NOT NULL CHECK (to_status   IN ('todo', 'in_progress', 'done')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Serves both backfill (board_id, id DESC LIMIT n) and replay (board_id, id > cursor).
CREATE INDEX IF NOT EXISTS card_activity_board_id_id_idx ON card_activity (board_id, id);
```

### Repository interface sketch
```ts
export interface ActivityRepository {
  record(input: RecordActivityInput): Promise<CardActivity>;               // INSERT ... RETURNING id, created_at
  findRecentByBoard(boardId: number, limit: number): Promise<CardActivity[]>; // backfill (returns oldest→newest)
  findAfter(boardId: number, cursorId: number, limit: number): Promise<CardActivity[]>; // replay
}
```

### **Chosen (Q3)**: The `card_activity` table above — denormalized `card_title`, `board_id` **CASCADE** / `card_id` **SET NULL**, composite `(board_id, id)` index, identity-PK cursor via `Last-Event-ID`. `actor` deferred (additive later).
**Maps to**: AC-VERIFY-2 (well-formed constrained row), AC-ASYNC-1 (backfill), AC-ASYNC-2 (replay), AC-INTEGRATION-1 (grounded, distinct events).

---

## Q4 — Fan-out & Connection Lifecycle

### Subscription scope: per-board vs global
- **Per-board (chosen)**: subscribers register interest in one `board_id`; `emit(board_id, …)` reaches only that board's connections.
- **Global (rejected)**: one firehose that clients filter — leaks other boards' activity over the wire, wastes bandwidth, and pushes filtering to the client. The feed is board-scoped, so per-board topics are the natural, minimal design.

### Fan-out mechanism: `ActivityEmitter` abstraction (injected)
A small purpose-built interface (not raw `EventEmitter`, which warns past 10 listeners and offers a clumsy unsubscribe):
```ts
export interface ActivityEmitter {
  subscribe(boardId: number, handler: (event: ActivityEvent) => void): () => void; // returns unsubscribe
  emit(boardId: number, event: ActivityEvent): void;
}
```
- **In-process implementation** (`InProcessActivityEmitter`): a `Map<number, Set<handler>>` keyed by `board_id`. `subscribe` adds to the set and returns a closure that deletes it (and prunes empty sets); `emit` iterates the board's set synchronously.
- **Constructed in `src/server.ts`**, injected via `AppDeps`, shared by the cards router (emit on capture) and the stream router (subscribe). This mirrors the existing DI pattern exactly and keeps `createApp` pure/testable (a stub emitter is injected in `app.test.ts`).

### Connection lifecycle (SSE)
1. **Open** `GET /activity/stream?board_id=:id`: validate `board_id` (parseId → 404/400 per the api-design learned rule); set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`; `res.flushHeaders()`. Log `activity.stream.open` (board_id).
2. **Register first, then backfill** (no-gap-no-dup ordering): `subscribe(board_id, handler)` **before** querying, buffering any live events that arrive during the DB read; then run backfill (fresh) or replay (reconnect, from `Last-Event-ID`); write those frames; then flush buffered live frames, **deduping by `id`** (drop any buffered `id` ≤ the last backfilled/replayed `id`). This guarantees AC-ASYNC-1 + AC-HAPPY-1 have no gap and no duplicate at the seam.
3. **Live**: `handler` writes `id: <id>\nevent: card_moved\ndata: <json>\n\n` per event.
4. **Heartbeat**: every `ACTIVITY_HEARTBEAT_MS` write a comment line `: keep-alive\n\n` — keeps proxies/LBs from idle-closing the stream and lets the client notice a dead link.
5. **Cleanup (no leak)**: on `req.on('close')` (client navigates away / disconnects) → call the `unsubscribe()` closure **and** `clearInterval(heartbeat)`. Log `activity.stream.close`. This is the leak-prevention assertion in Phase 2 tests.
6. **Reconnect**: the browser's `EventSource` auto-reconnects and resends `Last-Event-ID`; the server takes the replay path. The client shows a connecting/reconnecting state (AC-ASYNC-2); a hard failure surfaces the degraded state (AC-ERROR-1, client-side — UI/UX owns the visual).

### Documented scaling boundary (single-instance → multi-instance)
**What ships (MVP, single-instance `docker compose`)**: the in-process `Map`-backed emitter. `emit` reaches only subscribers **on the same Node process**. Correct because there is exactly one `api` container.

**The boundary line**: the moment a second `api` instance runs behind a load balancer, a PATCH handled by instance A emits only to A's subscribers — clients pinned to instance B miss the live push (they'd still get it on reconnect via DB replay, but not live). **This is explicitly NOT built now.**

**Promotion path (documented, not implemented)** — the `ActivityEmitter` interface is the single swap-point:
- **Postgres `LISTEN/NOTIFY` (preferred — no new infra)**: because we already **persist-first**, capture can `NOTIFY card_activity, '<payload or id>'` after the INSERT (or a DB trigger — Q2 Option D — does the NOTIFY). Every instance holds a dedicated `LISTEN` connection and, on notification, re-fans-out to its **local** subscribers via the same interface. Swap `InProcessActivityEmitter` for `PgNotifyActivityEmitter`; routes and capture are untouched.
- **Redis pub/sub (if Postgres connection pressure becomes a concern)**: `emit` → `PUBLISH`; each instance `SUBSCRIBE`s and re-fans-out locally. Adds a Redis dependency to compose.

No routes, repositories, or the capture hook change when this promotion happens — only the emitter implementation constructed in `server.ts`. This honours simplicity-first (don't build multi-instance pub/sub for a single-instance deployment) while making the future cheap.

### **Chosen (Q4)**: Per-board subscription over an injected in-process `ActivityEmitter` (`Map<boardId, Set<handler>>`); SSE lifecycle with subscribe-before-backfill dedup ordering, `ACTIVITY_HEARTBEAT_MS` keepalive, and `req.on('close')` cleanup (unsubscribe + clearInterval). Multi-instance via `LISTEN/NOTIFY`/Redis is documented as the promotion path behind the `ActivityEmitter` seam, not built.
**Maps to**: AC-HAPPY-1 (live per-board delivery), AC-ASYNC-1 (backfill), AC-ASYNC-2 (replay/reconnect), AC-ERROR-1 (server-side degrade/cleanup), AC-VERIFY-3 (non-blocking in-memory fan-out).

---

## Transport Endpoint Contract
| Aspect | Value |
|--------|-------|
| Method / Path | `GET /activity/stream?board_id=:id` (path from `ACTIVITY_STREAM_PATH`) |
| Reachability | Plain HTTP GET through the Vite `/api` proxy — **no proxy change** (no `ws:true`, no `http.Server` seam) |
| Response headers | `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` |
| Request query | `board_id` (required positive integer; invalid → 400, mirroring cards validation) |
| Reconnect / cursor | `Last-Event-ID` request header (native `EventSource`) = the activity row `id`; server replays `id > Last-Event-ID` for that board |
| Backfill on connect | Most recent `ACTIVITY_BACKFILL_LIMIT` events for the board, oldest→newest, emitted as `id:`+`data:` frames before live events |
| Frame format | `id: <activity.id>\nevent: card_moved\ndata: <JSON ActivityEvent>\n\n` |
| Heartbeat | `: keep-alive\n\n` every `ACTIVITY_HEARTBEAT_MS` |
| Lifecycle | subscribe→backfill/replay(dedup)→live→heartbeat; `req.on('close')` → unsubscribe + clearInterval |

**One-line contract**: `GET /api/activity/stream?board_id=:id` → `text/event-stream`; backfills the last N events then streams `event: card_moved` frames with monotonic `id:`; reconnect replays via the native `Last-Event-ID` header; `: keep-alive` heartbeat; per-board scope.

## `AppDeps` Extension Shape
```ts
export interface AppDeps {
  checkDb: DbHealthCheck;
  boardsRepo: BoardsRepository;
  cardsRepo: CardsRepository;
  activityRepo: ActivityRepository;    // NEW — backfill/replay reads + capture write
  activityEmitter: ActivityEmitter;    // NEW — in-process per-board fan-out (swap-point for multi-instance)
}
```
Wiring: `createApp` passes `activityEmitter` + `activityRepo` into the cards router (so capture can emit) and mounts a new stream router `createActivityStreamRouter(activityRepo, activityEmitter)`. Constructed in `src/server.ts`:
```ts
const activityRepo = new PostgresActivityRepository(pool);
const activityEmitter = new InProcessActivityEmitter();
const app = createApp({ checkDb, boardsRepo, cardsRepo, activityRepo, activityEmitter });
```

## Environment Variables
| Variable | Purpose | Default (compose) |
|----------|---------|-------------------|
| `ACTIVITY_STREAM_PATH` | SSE endpoint path | `/activity/stream` |
| `ACTIVITY_BACKFILL_LIMIT` | Max events returned on connect backfill | `50` |
| `ACTIVITY_HEARTBEAT_MS` | SSE keepalive interval (ms) | `15000` |
| `LOG_LEVEL` | Log verbosity (existing) | `info` |

Defaults live in `docker-compose.yml` `api.environment` as `${VAR:-default}` (configuration learned rule); `env.ts` reads them into the typed `Env`. No hardcoding in app code.

## Observability Architecture
### Logging (uses the existing `log()` JSON-per-line abstraction — no `console.log`)
| Event | Level | Fields |
|-------|-------|--------|
| `activity.captured` | info | board_id, card_id, from_status, to_status, activity_id |
| `activity.stream.open` | info | board_id |
| `activity.stream.backfill` | debug | board_id, count |
| `activity.stream.replay` | debug | board_id, last_event_id, count |
| `activity.stream.close` | info | board_id |
| `activity.capture.error` | error | board_id, card_id, message (fail-safe — logged, not thrown) |

No PII/tokens are logged (none exist — no auth). Cardinality-safe: `board_id`/`card_id` appear in **logs**, never as metric labels.

### Distributed Tracing & Metrics — documented gap (deliberate, per plan)
The project currently ships only the minimal `log()` wrapper; the full OpenTelemetry SDK (traces/metrics, W3C `traceparent` propagation, Prometheus endpoint) is **aspirational and not yet wired** anywhere in the codebase (CLAUDE.md). Per the task plan, this feature **documents structured logging now and defers OTEL spans/metrics** to avoid over-building a telemetry stack the project has not adopted. When OTEL lands project-wide: the SSE connection would open a long-lived span (`activity.stream`), capture would emit an `ActivityService.capture` span linked to the PATCH server span, and `traceparent` would ride the SSE connect request. Flagged as a known gap; not built in this task.

### Configuration Variables (observability)
| Variable | Purpose | Default |
|----------|---------|---------|
| `LOG_LEVEL` | Log verbosity | `info` (dev friendly) |
| *(OTEL_* / METRICS_*)* | Deferred — not wired project-wide yet | — |

---

## Decision Summary
| Q | Decision |
|---|----------|
| Q1 Transport | **SSE** — `GET /activity/stream` (read-only fit; no server/proxy change; native `Last-Event-ID` reconnect; Supertest-testable). |
| Q2 Capture | **Atomic old-vs-new via a `RETURNING` CTE in `cards.repository.update()`**, orchestrated in the `PATCH` handler; INSERT persist-first (awaited), in-memory emit off the response path. Trigger rejected (untestable, can't reach the Node bus). |
| Q3 Persistence | `card_activity` with denormalized `card_title`; `board_id` CASCADE / `card_id` SET NULL; `(board_id, id)` index; identity-PK cursor via `Last-Event-ID`; `actor` deferred. |
| Q4 Fan-out/lifecycle | **Per-board** subscription over an injected in-process `ActivityEmitter`; subscribe-before-backfill dedup; `ACTIVITY_HEARTBEAT_MS` keepalive; `req.on('close')` cleanup; `LISTEN/NOTIFY`/Redis documented as the multi-instance swap-point (not built). |

## Decision → AC Traceability
| AC | Satisfied by |
|----|--------------|
| AC-ENTRY-1 | (Frontend — UI/UX) served by the stream + backfill contract |
| AC-HAPPY-1 | Q1 SSE live frames + Q4 per-board emit on capture |
| AC-HAPPY-2 | Q3 fields (`card_title`, `from/to_status`) enable human phrasing (rendering is UI/UX) |
| AC-ASYNC-1 | Q3 `findRecentByBoard` backfill + Q4 subscribe-before-backfill ordering |
| AC-ASYNC-2 | Q1 native `Last-Event-ID` + Q3 `findAfter` replay + Q4 reconnect lifecycle |
| AC-ERROR-1 | Q4 lifecycle cleanup + fail-safe capture; SSE degrade signalled to client (UI/UX renders) |
| AC-VERIFY-1 | Q2 emission gated on `previousStatus !== card.status` (no-op/non-status → nothing) |
| AC-VERIFY-2 | Q2 exactly one INSERT per transition + Q3 CHECK-constrained well-formed row |
| AC-VERIFY-3 | Q2 persist-first + in-memory non-blocking emit; PATCH adds one indexed INSERT (<200ms) |
| AC-INTEGRATION-1 | Q3 grounded rows (real card_id/title/from/to) + Q1 end-to-end frames — two moves differ |

## Validation Checklist
- [x] Meets all system requirements (capture, persist, push, backfill, replay, degrade)
- [x] Respects technical constraints (no `server.ts`/proxy change; DI; driver isolation)
- [x] Addresses NFRs (p95<200ms write / p95<2s delivery; structured logging; testability)
- [x] Technically feasible with current stack (Express + `pg` + SSE, no new runtime primitives)
- [x] Risks identified and acceptable (below)
- [x] Complies with Guiding Principles in systemPatterns.md (simplicity-first, 12-factor, DI, driver isolation, fail-safe, testability) — no deviations
- [x] Respects established patterns (App Factory, DI at composition root, repository/driver isolation, `log()`)
- [x] Observability architecture defined (structured logging events; OTEL gap documented)
- [x] Trace context propagation: N/A today (single service, no OTEL wired) — gap documented
- [x] Logging consistent with observability-requirements.md (structured, env-driven level, no PII, no `console.log`)
- [ ] Metrics naming conventions — deferred with the OTEL stack (documented gap, not built)

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Activity INSERT pushes PATCH over p95<200ms | Low | Medium | Single indexed INSERT; measure in Phase 1; emit is in-memory only |
| SSE stream idle-closed by a proxy/LB | Medium | Medium | `ACTIVITY_HEARTBEAT_MS` keepalive comments; `X-Accel-Buffering: no` |
| Connection/interval leak on disconnect | Medium | High | `req.on('close')` → unsubscribe + clearInterval; explicit Phase 2 leak test |
| Gap or duplicate at backfill↔live seam | Medium | Medium | Subscribe-before-backfill + dedupe by `id`; DB-backed replay on reconnect |
| Cursor skip under concurrent inserts (identity visibility) | Low | Low | Accepted for single-instance low-concurrency; documented; DB replay bounds loss |
| Multi-instance live miss if scaled out | Low (out of scope) | Medium | Documented `LISTEN/NOTIFY`/Redis promotion behind the `ActivityEmitter` seam |
| `update()` contract change ripples to cards tests | High | Low | In scope — cards tests are explicitly extended; stub returns `{card, previousStatus}` |

## Next Steps (implementation guidance for /banyan-build)
1. **Phase 1**: add `db/init/003_card_activity.sql`; `src/activity/activity.types.ts` + `activity.repository.ts` (+ stub in tests); modify `cards.repository.update()` to return `{ card, previousStatus }` via the CTE; wire the capture hook into `PATCH /cards/:id`; extend `AppDeps` with `activityRepo` + `activityEmitter`; structured `activity.captured` log. Tests: AC-VERIFY-1/2, persistence half of AC-INTEGRATION-1.
2. **Phase 2**: add `InProcessActivityEmitter` + `createActivityStreamRouter`; mount in `createApp`; construct in `server.ts`; implement backfill/replay/heartbeat/cleanup; add env knobs to `env.ts` + `docker-compose.yml`. Tests: subscribe/live, backfill, replay, per-board scoping, leak-free cleanup, degrade.
3. **Phase 3** (UI/UX-led): client `EventSource` seam + `useActivityStream` hook + feed surface — depends on the UI/UX creative.
4. Keep `src/server.ts` on `app.listen` (SSE needs no upgrade seam); keep `vite.config.ts` unchanged.

---

## NEW_TERMS_INTRODUCED
- **`card_activity`** — the `003_*` activity table (one row per real card status transition).
- **`ActivityEmitter`** — injected in-process per-board fan-out interface (`subscribe`/`emit`); the documented swap-point for multi-instance pub/sub.
- **`InProcessActivityEmitter`** — the MVP `Map<boardId, Set<handler>>` implementation.
- **`ActivityRepository`** — driver-isolated data access (`record`, `findRecentByBoard`, `findAfter`).
- **`ActivityEvent`** — the wire/event shape pushed over SSE (`event: card_moved`).
- **Backfill** — the bounded set of recent events sent on a fresh connect.
- **Replay** — events sent after reconnect, from `Last-Event-ID` (`id > cursor`).
- **`card_moved`** — the SSE `event:` name for a card status transition frame.

---

ARCHITECTURE CREATIVE COMPLETE
Document: memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md
Decision: SSE transport + atomic CTE old-vs-new capture (persist-first, non-blocking emit) + a `card_activity` table (denormalized title, board-CASCADE/card-SET-NULL, identity-PK cursor) + per-board in-process `ActivityEmitter` with documented LISTEN/NOTIFY promotion path.
