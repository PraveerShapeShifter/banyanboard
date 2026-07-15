# User Journey Design: Realtime Activity Feed

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: User Journey
**Task**: TASK-005 (Level 4, FEAT-005)
**Scope**: End-to-end journey for the board-scoped, read-only realtime activity feed on `/boards/:id`. Feature is ALREADY BUILT (Phases 1–3 complete); this doc grounds `/banyan-uat` in the actual shipped UI/transport so a real Chromium walk can PASS/FAIL against concrete selectors and behaviours.
**Fixed inputs**: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md` (SSE transport, capture, persistence, fan-out) and `memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md` (persistent side-panel, five states, a11y). Not re-decided here.

---

## Journey Overview

**Feature**: Whenever a card's `status` changes (via `PATCH /cards/:id { status }`), the backend persists a `card_activity` row and pushes it live over SSE (`GET /api/activity/stream?board_id=:id`) to every client watching that board. The board view renders these as a plain-language, newest-first feed in a persistent panel — updating without any manual reload.

**Primary Persona**: Priya (Team Lead) — watches the board and feed together.

**Journey Type**: **Hybrid / near-realtime asynchronous.** There is no synchronous request the *observer* initiates; the feed is a passively-consumed live stream. The *trigger* (a card move) is an async event originating elsewhere (another actor, or the API). Target: p95 < ~2s from PATCH acknowledgement to feed render; PATCH write path stays p95 < 200ms.

**Orchestration Pattern**: **Notification + Ambient Panel** — the feed is always-present (persistent side panel), non-blocking, and requires zero user action to deliver value. No wizard, no modal, no toggle, no route.

### Success Statement
> Priya opens a board, sees recent card-movement history already populated in the Activity panel, and — while she keeps working — watches a new plain-language item (`Someone moved "…" from … to …`) appear at the top of that panel the moment a card is moved, without reloading and without touching anything.

---

## Persona Context

### Primary User
- **Who**: Priya (role: `team_lead`).
- **Goal**: "See status at a glance, keep cards flowing to Done." The feed is a passive expression of that goal — she should notice work moving without doing anything.
- **Context**: A board tab left open (`/boards/:id`) while she does other work; continuous ambient watch.
- **Proficiency**: Comfortable with web tools; not technical; will never open a terminal or an API client. She experiences the feature purely as "the board updates itself."

### Secondary Users
- **Marco** (role: `contributor`) — the *event source*. He moves cards and wants to confirm his own move registered. **Important reality (see Journey Risks):** the shipped frontend has **no card-move UI** (no drag, no status control, no edit button). Marco's "move" is a `PATCH /cards/:id { status }` against the API. In production this would be a future write UI; in this MVP and in UAT it is an API call.
- **Sam** (role: `stakeholder`) — read-only observer. Same view as Priya, no editing. Benefits from ambient awareness with no new interaction to learn.

All three are **read-only consumers of the feed**. The feed itself exposes **no** write affordances (no buttons, links, inputs — verified in `ActivityFeed.tsx`/`ActivityFeedItem.tsx`).

---

## Journey Map

### Entry Points
| Entry | Context | User Intent |
|-------|---------|-------------|
| App root `/` → BoardListPage → click a board | The only navigation into a board | "Open my board and see what's happening" |
| Direct URL `/boards/:id` (bookmark/reload) | Returning to a known board | "Re-open the board; show me recent activity, not a blank panel" |

There is **no new top-level navigation** for the feed. It is a region *inside* the board view — discovered by being present, not by a link or a menu item (AC-ENTRY-1).

### State Diagram
```
[/ BoardListPage] --click board--> [/boards/:id BoardViewPage]
        │
        ▼  (getBoardView: board + cards fetched once)
   [board success] --> [<ActivityFeed> mounts, EventSource opens]
        │
        ▼
   [connecting]  "Loading activity…"  (shared Loading, aria-live polite)
        │
        ├── history exists ─▶ [open, has items]  backfill rendered SILENTLY, newest-first (AC-ASYNC-1)
        └── no history ─────▶ [open, empty]      "No activity yet…" (NOT an error)
                                   │
                                   ▼
   [open, streaming] ◀───────────────────────────────────────┐
        │  a card is moved elsewhere (PATCH status change)     │
        ▼                                                      │
   [new item prepended to top + announced once, politely]  ────┘  (AC-HAPPY-1/2)
        │
        │  connection drops (server down / network / blocked)
        ▼
   [reconnecting]  role="status" "Reconnecting…"  banner ABOVE the still-visible list
        │  EventSource auto-retries, resends Last-Event-ID
        ├── recovers ─▶ [open] replay missed events SILENTLY (AC-ASYNC-2), banner clears
        └── keeps failing past 10s (ACTIVITY_DEGRADED_AFTER_MS)
                 ▼
           [degraded]  role="alert" "Activity feed offline"  (AC-ERROR-1)
                       list stays visible/frozen; columns + rest of board unaffected
                 │  a frame finally arrives
                 ▼
           [open]  banner disappears, live appends resume
```

### Step-by-Step Journey (the "value path" — expanded into UAT steps below)

#### Step 1: Enter the board
- **System**: React SPA (`BoardListPage` → `BoardViewPage`), `getBoard` + `getCards` via `/api`.
- **User Sees**: Board header, three status columns ("To Do (N)", "In Progress (N)", "Done (N)"), and a fourth "Activity" region.
- **User Actions**: None required for the feed; it mounts automatically in the board's `success` branch.
- **Feedback**: Activity panel shows "Loading activity…" then resolves.
- **Transitions**: `connecting` → `open`.
- **Data Flow**: `EventSource('/api/activity/stream?board_id=:id')` opens; server backfills up to `ACTIVITY_BACKFILL_LIMIT` (50) recent events oldest→newest.

#### Step 2: See backfilled history (AC-ASYNC-1)
- **System**: SSE handler `findRecentByBoard`; client renders newest-first, **silently** (no announcement — arming heuristic).
- **User Sees**: A list of recent moves, or the calm "No activity yet…" empty state if the board truly has no history.
- **Value**: Never a blank panel when history exists; Priya has instant context on reopen.

#### Step 3: Watch a live move arrive (AC-HAPPY-1/2, AC-INTEGRATION-1) — the success moment
- **System**: A `PATCH /cards/:id { status }` elsewhere → `activityRepo.record` (persist-first) → `activityEmitter.emit` → SSE frame → client prepends + announces once.
- **User Sees**: A new item at the **top** of the list within ~2s: `Someone moved "<real card title>" from <From Label> to <To Label>`, plus an absolute timestamp (`Jul 15, 2:41 PM`). No reload, no click.
- **Feedback**: Hidden `aria-live="polite"` announcer speaks the sentence exactly once.
- **Value delivered**: Priya *noticed the board move without acting* — the core goal.

#### Step N: Persisted move reflected in columns (on reload)
- **System**: The move is durably persisted (`cards.status` updated in the same PATCH). Columns render from the one-time `getBoardView` fetch and are **not** part of the realtime scope.
- **User Sees**: After a board **reload**, the moved card now sits under its new column and the "(N)" counts change.
- **Note (critical for UAT)**: The **feed** updates live; the **columns do not** update live in this build. "Column counts reflect the move" (AC-HAPPY-1) is a *post-reload* verification of persistence, not a live-column expectation. See Journey Risks.

---

## Async Handling

### Operation Lifecycle
| Phase | Duration | User Experience |
|-------|----------|-----------------|
| Connect | immediate | "Loading activity…" then backfill or empty state |
| Backfill / replay | sub-second burst | Items appear silently, newest-first (no AT announcement) |
| Live streaming | continuous | New item prepends + one polite announcement per genuine event |
| Drop | immediate on failure | "Reconnecting…" banner (`role="status"`), list preserved |
| Degraded | after 10s of failed retries | "Activity feed offline" banner (`role="alert"`), list frozen but visible |
| Recovery | on next successful frame | Banner clears, missed events replay silently, live resumes |

### Progress Communication
- **Method**: Native `EventSource` SSE; browser-managed reconnection with `Last-Event-ID`.
- **Frequency**: Event-driven; `: keep-alive` heartbeat every `ACTIVITY_HEARTBEAT_MS` (15s) keeps the stream from idle-closing.
- **Persistence**: History is durable in `card_activity`; a fresh connect always backfills, so the feed is never blank when events exist.

---

## Distributed System Flow

### System Boundaries
```
[Browser: EventSource] ──GET /api/activity/stream?board_id── [Vite :5173 /api proxy] ── [Express API :3000]
        ▲                                                                                      │
        │◀────────── text/event-stream frames (id:/event:card_moved/data:) ────────────────────┤
        │                                                                                      │
[Any client: PATCH /api/cards/:id {status}] ──────────────────────────────────────────────────▶ (capture)
                                                                                               │ persist-first
                                                                              [Postgres card_activity] ── emit ──▶ subscribers
```

### Responsibility Matrix
| Step | Owner | State Storage | Failure Handling |
|------|-------|---------------|------------------|
| Open stream / validate board_id | `activity.routes.ts` | in-process subscription | 400 on bad board_id; no stream opened |
| Backfill / replay | `ActivityRepository` (Postgres) | `card_activity` table | read failure → degrade (live-only), stream + board stay up |
| Capture on move | `cards.routes.ts` PATCH | `card_activity` | wrapped try/catch — capture error logged, never fails the PATCH |
| Fan-out | `InProcessActivityEmitter` | in-memory per-board Map | in-memory, non-blocking; single-instance only (documented boundary) |
| Client state machine | `useActivityStream.ts` | React state/refs | drop → reconnecting → degraded after 10s; auto-recovers |

---

## Error Handling

### Error States
| Error Type | When | User Sees | Recovery |
|------------|------|-----------|----------|
| Slow/absent first response | Server briefly unavailable at connect | Stays on "Loading activity…"; escalates to degraded if it exceeds threshold | Auto — no user action |
| Connection drop | Network blip, server restart, blocked request | `role="status"` "Reconnecting…" banner **above the still-visible list** | Auto-reconnect; replays missed events via `Last-Event-ID` |
| Sustained failure | Retries fail past `ACTIVITY_DEGRADED_AFTER_MS` (10s) | `role="alert"` "Activity feed offline"; list frozen but visible | Self-heals on next frame; **rest of board fully usable throughout** |
| Empty (no history) | Board has zero movement events | Calm "No activity yet. Card moves on this board will appear here." | Not an error; first move populates it |
| Transport unconstructable | No `EventSource` support | Goes straight to `degraded` | Board (columns/cards) unaffected |

### Partial Failure
- **Scenario**: Backfill read fails but the socket is fine.
- **User Experience**: No history shown, but live events still stream in (connection stays `open`).
- **Recovery**: Reload re-attempts backfill; no data lost (rows persisted server-side).

---

## Options Explored

The surface/placement decision (persistent panel vs drawer vs route) was made in the UI/UX creative — Option 1 (Persistent Side Panel) was chosen. This journey doc explores the **UAT trigger mechanism** for observing a live move, since the app has no card-move UI.

### Option 1: API-driven move via in-browser `fetch` (same-origin proxy)
- **Orchestration**: Observer tab open on `/boards/:id`; tester issues `fetch('/api/cards/:id', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:'done'})})` from the browser console/`javascript_tool` **in the same page**.
- **Entry Point**: The already-open board view.
- **Key Interactions**: Discover a card via `GET /api/cards?board_id=:id`; PATCH it to a *different* status; observe the feed update live.
- **Async Handling**: Live SSE frame arrives in the same tab; no reload.
- **Pros**: Single browser context; traverses the exact `/api` proxy path a real client uses (true end-to-end wiring, satisfies AC-INTEGRATION-1); no CORS; no extra tooling; deterministic.
- **Cons**: Uses a console call rather than a click (unavoidable — no write UI exists).
- **Best For**: Every UAT scenario here; the default.
- **Friction Points**: Tester must first fetch a real card id + current status to pick a *changing* transition.

### Option 2: Two browser contexts (role-play Marco separately)
- **Orchestration**: Context A = Priya observing; Context B = "Marco" issuing the PATCH (still an API call — no UI to click).
- **Pros**: Visibly separates observer from actor; demonstrates cross-client live push.
- **Cons**: More setup; the app cannot distinguish sessions anyway (no auth), so the second context adds nothing functional over Option 1.
- **Best For**: A demo of "another person moved it," not required for AC coverage.
- **Friction Points**: Coordinating two tabs; higher flake risk.

### Option 3: External API client (curl/REST tool) triggers the move
- **Orchestration**: Observer tab open; PATCH issued from outside the browser against `http://localhost:3000` or `:5173/api`.
- **Pros**: Clean separation from the browser.
- **Cons**: Requires an out-of-browser tool inside the UAT harness; may hit the backend directly (bypassing the proxy the real client uses); more moving parts.
- **Best For**: Backend-only verification, not the browser-observed journey.
- **Friction Points**: Harness may not have a REST client; port/base-URL confusion.

## Evaluation Matrix

| Criterion | Option 1 (in-page fetch) | Option 2 (two contexts) | Option 3 (external client) |
|-----------|--------------------------|-------------------------|----------------------------|
| Discoverability (of feed) | High | High | High |
| Determinism / low flake | High | Medium | Medium |
| Exercises real proxy path | High | High | Medium (may bypass) |
| Setup simplicity | High | Low | Medium |
| AC-INTEGRATION-1 fidelity | High | High | Medium |
| Single-context sufficiency | Yes | No | Yes |

## Decision

**Chosen**: **Option 1 — API-driven move via in-browser `fetch` through the same-origin `/api` proxy, in a single observing tab.**

### Rationale
The shipped app has no card-move UI, so *some* out-of-band trigger is unavoidable. An in-page `fetch` to `/api/cards/:id` is the lowest-friction, most deterministic trigger that still exercises the genuine end-to-end path (browser → Vite `/api` proxy → Express capture → Postgres persist → emitter → SSE → same browser). It needs one browser context, no auth, no external tooling, and directly proves AC-INTEGRATION-1 (real card, real from→to, changes per move, no canned string). Two-context role-play (Option 2) is offered as an optional demo but adds no AC coverage because the app cannot distinguish sessions.

### Trade-offs Accepted
- **Trigger is a console call, not a click**: acceptable and unavoidable — no write affordance exists in this MVP; documented as a journey risk, not a defect.
- **Columns are verified on reload, not live**: acceptable — the realtime scope is the feed only; the persisted move is confirmed via a board reload.

---

## Implementation Guidelines (as-built reference for the UAT walker)

### Frontend (shipped)
1. `frontend/src/pages/BoardViewPage/ActivityFeed.tsx` — `<section aria-labelledby="activity-feed-heading">` + `<h2 id="activity-feed-heading">Activity</h2>`; renders `Loading` / `EmptyState` / item `<ul>` / hidden announcer / `ActivityFeedStatus` banner.
2. `frontend/src/hooks/useActivityStream.ts` — state machine `connecting|open|reconnecting|degraded`; dedup by `id`; arming heuristic; `ACTIVITY_DEGRADED_AFTER_MS = 10000`.
3. `frontend/src/api/activityStream.ts` — the only `EventSource` seam; URL `${VITE_API_BASE_URL ?? '/api'}/activity/stream?board_id=<id>`.
4. `frontend/src/statusLabels.ts` — `formatActivitySentence`: `Someone moved "<title>" from <From> to <To>`; labels To Do / In Progress / Done.

### Backend (shipped)
1. `GET /activity/stream?board_id=` — `src/activity/activity.routes.ts` (SSE; 400 on bad board_id; backfill/replay/heartbeat/cleanup).
2. Capture hook — `src/cards/cards.routes.ts` PATCH (gated on `previousStatus !== card.status`).
3. `db/init/003_card_activity.sql` — persistence.

### Integration Points
| System | Interface | Data Exchanged |
|--------|-----------|----------------|
| Browser ↔ API | `GET /api/activity/stream?board_id=` (SSE) | `event: card_moved` frames (`CardActivity` JSON) |
| Any client → API | `PATCH /api/cards/:id { status }` | triggers capture + emit |
| API → Postgres | `card_activity` INSERT / SELECT | persisted transitions |

---

## Acceptance Criteria (MANDATORY)

### AC-ENTRY-1: Priya can find the Activity feed on the board view
**Priority**: MUST

**Given** Priya is on `/boards/:id` in a loaded (`success`) board
**When** she looks at the board view
**Then** she sees a region with accessible name **"Activity"** (`<section aria-labelledby="activity-feed-heading">` + `<h2>Activity</h2>`), visually and semantically **distinct** from the three status columns ("To Do (N)", "In Progress (N)", "Done (N)"), on desktop as a 4th grid track right of the columns.

**Verification**:
- [ ] E2E: A region/landmark named "Activity" exists on `/boards/:id`
- [ ] E2E: It is distinct from the three column sections (4 named regions total: To Do, In Progress, Done, Activity)
- [ ] E2E: axe-core finds no critical violation on the region (correct role/name)

### AC-HAPPY-1: A live move appears at the top of the feed without a reload; columns reflect the move on reload
**Priority**: MUST

**Given** Priya's board is open with the feed in state `open`
**When** these EXACT steps run:
  1. Note a real card on this board via `GET /api/cards?board_id=<id>` (capture its `id`, `title`, current `status`)
  2. Issue `PATCH /api/cards/<cardId>` with body `{ "status": "<a DIFFERENT status>" }` (e.g. `in_progress` → `done`)
  3. Wait ≤ ~2s, DO NOT reload
**Then**:
  - The feed shows a NEW top item: `Someone moved "<that title>" from <From Label> to <To Label>` with a timestamp
  - The item is newest-first (above any prior items)
  - After a **separate board reload**, the card now renders under its new column and the column "(N)" counts have changed
  - Data is: one new `card_activity` row persisted; `cards.status` updated

**Verification**:
- [ ] E2E: New feed item appears live within budget, no reload
- [ ] E2E: Item text matches the moved card's real title and real from→to
- [ ] E2E: After reload, moved card is in the target column; counts updated
- [ ] Integration: exactly one `card_activity` row for this move

### AC-HAPPY-2: Feed items are human-readable, newest-first, not color-only, announced politely
**Priority**: MUST

**Given** the feed is `open`
**When** a live `card_moved` event arrives
**Then**:
  - User sees a plain-language sentence naming card title + from/to columns **as text** (never color/badge alone)
  - Newest item is at the top
  - Exactly one polite (`aria-live="polite"`) announcement fires (from the hidden announcer, NOT the visible `<ul>`); focus does not move

**Verification**:
- [ ] E2E: Sentence uses text labels "To Do"/"In Progress"/"Done"
- [ ] E2E: Order is newest-first
- [ ] E2E/DOM: The visible `<ul>` carries NO `aria-live`; a sibling `.visually-hidden` element does
- [ ] E2E: Focus position unchanged after the item appears

### AC-ASYNC-1: On connect, the feed backfills recent history (never blank when history exists)
**Priority**: MUST

**Given** the board already has at least one card-movement event
**When** Priya (re)opens `/boards/:id` (fresh connect / reload)
**Then**:
  - The feed populates with recent history (bounded to ≤ 50), newest-first, consistent with what is persisted
  - It is NOT the empty "No activity yet…" state
  - No AT announcement fires for the backfill burst (silent catch-up)

**Verification**:
- [ ] E2E: After generating ≥1 move, reload → feed shows that history (not empty)
- [ ] E2E: Item(s) match persisted events
- [ ] E2E: Zero announcements during the backfill burst

### AC-ASYNC-2: A dropped connection shows reconnecting, auto-recovers, and replays missed events
**Priority**: SHOULD

**Given** the feed is `open`
**When** the SSE connection drops (see Error Scenarios trigger) AND a card is moved while it is down, THEN the connection is restored
**Then**:
  - A `role="status"` "Reconnecting…" banner is shown while down (list stays visible)
  - The connection auto-recovers with no user action
  - The event that occurred during the outage appears in the feed after recovery (replayed via `Last-Event-ID`) — nothing silently lost

**Verification**:
- [ ] E2E: "Reconnecting…" (`role="status"`) observed during the drop
- [ ] E2E: Existing items never disappear during the drop
- [ ] E2E: The gap event appears after recovery (replay)

### AC-ERROR-1: A failed/degraded transport shows an explicit offline state; the rest of the board keeps working
**Priority**: MUST

**Given** the feed is `open`
**When** the SSE transport fails repeatedly past `ACTIVITY_DEGRADED_AFTER_MS` (10s)
**Then**:
  - A `role="alert"` "Activity feed offline" banner is shown (NOT a blank "no activity" panel)
  - The existing item list stays visible/frozen
  - The three columns and the rest of the board remain fully usable (scroll, read cards, navigate)

**Verification**:
- [ ] E2E: "Activity feed offline" (`role="alert"`) appears after ~10s of sustained failure
- [ ] E2E: Panel is not blank; prior items still visible
- [ ] E2E: Columns/cards still render and the board is navigable

### AC-VERIFY-1: A no-op PATCH creates no activity item
**Priority**: MUST

**Given** the feed is `open` and idle
**When** a `PATCH /api/cards/:id` is issued that does NOT change status (same `status`, or only non-status fields like `title`/`description`)
**Then**:
  - No new feed item appears (no announcement)
  - No new `card_activity` row is created

**Verification**:
- [ ] E2E: PATCH same status → feed unchanged
- [ ] E2E: PATCH non-status field only → feed unchanged
- [ ] Integration: `card_activity` row count unchanged

### AC-INTEGRATION-1: The feed reflects the REAL movement (anti-stub)
**Priority**: MUST

**Given** two distinct, real cards with distinct titles on the board
**When** each is moved to a distinct new status via `PATCH /api/cards/:id`
**Then**:
  - Each feed item names THAT card's real title and its real from→to (derived from the input, not a placeholder)
  - The two items differ from each other (output changes with input)
  - No canned/hardcoded string; no "TODO"/"sample"/"test" placeholder

**Verification**:
- [ ] E2E: Move card A → item names A's title + A's transition
- [ ] E2E: Move card B (different) → item names B's title + B's transition; item differs from A's
- [ ] E2E: No placeholder text present

### AC-NAV-1: Navigating away and back re-establishes the feed (not stale)
**Priority**: SHOULD

**Given** Priya has the feed open on board X
**When** she navigates to `/` (or another board) and returns to board X
**Then**:
  - The feed re-connects fresh (`connecting` → `open`) and re-backfills board X's history
  - No leaked/duplicate connection; no other board's items shown

**Verification**:
- [ ] E2E: Navigate away → back → feed repopulates from backfill
- [ ] E2E: Only board X's events shown

---

## UAT Walk Sections (for `/banyan-uat`)

> **Test Accounts Used**: **NONE.** BanyanBoard has no authentication (per `uat-config.md` and productBrief Open Question). All actors (`team_lead` Priya, `contributor` Marco, `stakeholder` Sam) share **one anonymous session**; the app cannot distinguish them and every captured movement attributes to **"Someone"**. Persona differentiation below is **role-play only**.
>
> **Base URL / context**: `http://localhost:5173` (Vite dev server, React SPA). SSE and PATCH both traverse the same-origin `/api` proxy → Express API on `:3000`. Requires the stack running (`docker compose up`, or `npm run dev` in `frontend/` + backend on `:3000` + Postgres). No prod UAT.
>
> **How a card "move" is triggered (READ THIS):** the shipped board UI is **read-only** — there is **no drag-and-drop, no status dropdown, no edit button** on cards, and `api/client.ts` has no PATCH. The only way to change a card's status is a direct `PATCH /api/cards/:id { status }`. In UAT, issue it from the observing page via `javascript_tool`:
> ```js
> // 1. discover a real card on the open board (id from the /boards/:id URL)
> const cards = await (await fetch('/api/cards?board_id=' + BOARD_ID)).json();
> // 2. pick one and move it to a DIFFERENT status
> await fetch('/api/cards/' + cards[0].id, {
>   method: 'PATCH',
>   headers: { 'Content-Type': 'application/json' },
>   body: JSON.stringify({ status: 'done' })   // choose a status != cards[0].status
> });
> ```
> This runs in the same tab Priya is watching, so the live SSE frame arrives without a second browser context.

---

### Section A — Happy Path (serial) · Actor: `team_lead` (Priya), with `contributor` (Marco) role-playing the move

**Precondition**: The board should have at least one prior movement event so backfill is observable. If it is a brand-new board, run step A6 once, reload, and treat that as the backfill seed.

1. **[team_lead]** Navigate to `http://localhost:5173/` (BoardListPage). Verify at least one board is listed. *(Entry point)*
2. **[team_lead]** Click a board. Verify the URL is `/boards/:id` and the board view renders: board header + three columns ("To Do (N)", "In Progress (N)", "Done (N)"). Capture the board id from the URL.
3. **[team_lead]** Locate the **Activity** region (accessible name "Activity", distinct from the columns). Verify it shows either recent history items or "No activity yet…". *(AC-ENTRY-1)*
4. **[team_lead]** If history is present, verify it is **newest-first** and each item reads `Someone moved "<title>" from <From> to <To>` with a timestamp, and that this appeared **without a reload prompt** and is **not** the empty state. *(AC-ASYNC-1)*
5. **[team_lead]** Confirm no announcement/toast fired for the backfill burst (silent catch-up) — the hidden announcer should not have spoken for history.
6. **[contributor]** In the same tab, via `javascript_tool`: `GET /api/cards?board_id=<id>`, pick a real card, note its `id`/`title`/`status`, then `PATCH /api/cards/<id>` to a **different** status (e.g. `in_progress` → `done`). Do NOT reload. *(trigger)*
7. **[team_lead]** Within ~2s, verify a NEW item appears at the **top** of the feed naming **that card's real title** and its **real from→to** (e.g. `Someone moved "Deploy pipeline" from In Progress to Done`). *(AC-HAPPY-1, AC-HAPPY-2, AC-INTEGRATION-1)*
8. **[team_lead]** Verify exactly one polite announcement fired (hidden `.visually-hidden` `aria-live="polite"` element updated; the visible `<ul>` has no `aria-live`) and that focus did not move. *(AC-HAPPY-2)*
9. **[contributor]** Move a **second, different** card to a different status; verify the new item names the second card and **differs** from the first item. *(AC-INTEGRATION-1)*
10. **[team_lead]** **Reload** the board. Verify (a) the feed re-backfills and shows the moves just made (not blank), and (b) the moved cards now sit under their new columns with updated "(N)" counts. *(AC-HAPPY-1 columns-on-reload, AC-ASYNC-1)*
11. **[contributor]** No-op checks (feed must NOT change): PATCH the same card with its **current** status (unchanged), then PATCH only a non-status field (e.g. `{ "title": "<same or new title>" }` — but if you change the title, that is still a non-status field; ensure `status` is absent/unchanged). Verify NO new feed item appears and NO announcement fires. *(AC-VERIFY-1)*

**Verify checklist (Section A)**:
- [ ] Board reachable at `/boards/:id`; three columns render
- [ ] "Activity" region present, accessibly named, distinct from columns (AC-ENTRY-1)
- [ ] Backfill history newest-first, human-readable, not empty when history exists, silent (AC-ASYNC-1, AC-HAPPY-2)
- [ ] Live move → new top item within ~2s, real title + real from→to, no reload (AC-HAPPY-1, AC-INTEGRATION-1)
- [ ] Exactly one polite announcement; visible `<ul>` has no `aria-live`; focus unmoved (AC-HAPPY-2)
- [ ] Two distinct moves produce two distinct items (AC-INTEGRATION-1)
- [ ] After reload: moved cards in new columns, counts updated (AC-HAPPY-1)
- [ ] No-op / non-status PATCH → no feed item, no announcement (AC-VERIFY-1)
- [ ] axe-core: no critical/serious violation on the feed region

**Cleanup (Section A)**: No app-level cleanup UI exists. Data created is `card_activity` rows + moved card statuses (persisted, harmless). If a pristine board is needed for re-runs, restore the DB seed / use a disposable board. Close the tab to `EventSource.close()` the stream.

---

### Section B — Mobile viewport check · Actor: `stakeholder` (Sam)

1. **[stakeholder]** Resize to **375 × 667** (mobile). Navigate to `/boards/:id`.
2. **[stakeholder]** Verify the layout stacks vertically: columns To Do → In Progress → Done, then the **Activity** section as the **final** stacked block after Done (full width). *(responsive)*
3. **[stakeholder]** Verify the Activity heading and items are legible and not clipped; the page body does not scroll horizontally.
4. **[stakeholder]** (Optional live check) Trigger one PATCH via `javascript_tool` and verify a new item appears at the top of the mobile Activity section without reload.

**Verify checklist (Section B)**:
- [ ] Activity region present and usable at 375×667
- [ ] Activity is the last stacked section, after Done
- [ ] No horizontal page scroll; items legible
- [ ] (Optional) Live item appears on mobile

**Cleanup (Section B)**: Reset viewport to desktop; close tab.

---

### Section C — Negative / Access-Denied Paths · Actor: `stakeholder` (Sam)

> **N/A by design — no auth, no RBAC.** BanyanBoard has no authentication or authorization, so there are **no** access-denied, login-required, or role-gated paths to walk. Do **not** invent RBAC steps. The only meaningful negative check here is that the **read-only feed exposes no write affordances**.

1. **[stakeholder]** On `/boards/:id`, inspect the Activity region and its items. Verify there are **no** interactive controls inside the feed: no buttons, no links, no inputs, no drag handles, no "edit"/"delete"/"move" affordances. *(read-only guarantee)*
2. **[stakeholder]** Verify feed items are static text (`<p>` sentence + `<time>`), not clickable.
3. **[stakeholder]** Confirm there is no card-move UI anywhere on the board (no draggable cards, no status dropdown) — the feed cannot be used to mutate anything.

**Verify checklist (Section C)**:
- [ ] No auth/login/RBAC surface exists (correctly N/A)
- [ ] Feed region contains zero interactive/write controls
- [ ] Feed items are non-interactive static text

**Cleanup (Section C)**: None.

---

### Section D — Error Scenarios · Actor: `team_lead` (Priya)

> **Trigger mechanism (browser-only, keeps the rest of the board working):** use Chrome DevTools **request blocking** on the SSE URL pattern `**/api/activity/stream*` to force the `EventSource` into `onerror` without touching the columns' already-loaded data. (Alternative: `docker compose stop api` then `start api`, if request-blocking is unavailable — but blocking is preferred because it isolates the failure to the feed and proves the board stays usable.)

**D1 — Reconnecting + gap replay (AC-ASYNC-2)**
1. **[team_lead]** With the feed `open`, block `**/api/activity/stream*`. Within moments verify the **"Reconnecting…"** banner (`role="status"`) appears **above** the still-visible item list; existing items do NOT disappear.
2. **[team_lead]** While blocked, trigger a card move via `javascript_tool` PATCH (this persists a new `card_activity` row the live stream can't yet deliver).
3. **[team_lead]** **Unblock** the SSE URL. Verify the connection auto-recovers (banner clears, back to `open`) with no user action.
4. **[team_lead]** Verify the move made during the outage now appears in the feed (replayed via `Last-Event-ID`) — nothing silently lost.

**D2 — Degraded / offline, board still works (AC-ERROR-1)**
5. **[team_lead]** Re-block `**/api/activity/stream*` and leave it blocked for **> 10s** (`ACTIVITY_DEGRADED_AFTER_MS`). Verify the banner escalates to **"Activity feed offline"** (`role="alert"`), the panel is **not** blank (prior items remain visible/frozen).
6. **[team_lead]** While degraded, verify the rest of the board still works: the three columns render, cards are readable, and navigating to `/` and back functions normally.
7. **[team_lead]** Unblock the SSE URL. Verify the banner disappears on the next successful frame and live appends resume.

**Verify checklist (Section D)**:
- [ ] Drop → "Reconnecting…" (`role="status"`), list preserved (AC-ASYNC-2)
- [ ] Move during outage → replayed and shown after recovery (AC-ASYNC-2)
- [ ] Sustained failure > 10s → "Activity feed offline" (`role="alert"`), not blank (AC-ERROR-1)
- [ ] Columns/cards/navigation fully usable while degraded (AC-ERROR-1)
- [ ] Recovery clears the banner; live resumes

**Cleanup (Section D)**: Remove all DevTools request-block rules; if the backend was stopped, `docker compose start api`; reload the board to confirm a healthy `open` state; close tab.

---

## Accessibility Checklist
- [ ] "Activity" region reachable by heading/landmark navigation (mirrors columns' `aria-labelledby`)
- [ ] New live item announced exactly once via a **decoupled hidden** `aria-live="polite"` element (never the visible `<ul>`)
- [ ] Backfill/replay bursts are silent (arming heuristic) — no announcement flood on load/reconnect
- [ ] Reconnecting uses `role="status"` (polite); degraded uses `role="alert"`
- [ ] Status conveyed as text ("from In Progress to Done"), never color alone
- [ ] Focus never programmatically moved on connect/append/reconnect/degrade
- [ ] No time limits on any user action (feed is passive)
- [ ] axe-core: zero critical violations across connecting/open/empty/reconnecting/degraded states

## Analytics & Observability
### Key Metrics
| Metric | Purpose | Target |
|--------|---------|--------|
| PATCH→feed-render latency | Realtime responsiveness | p95 < ~2s |
| PATCH write path latency | No regression from capture | p95 < 200ms |
| Backfill-non-blank rate (when history exists) | AC-ASYNC-1 health | ~100% |
| Reconnect recovery rate | Resilience | high |

### Instrumentation Points (server logs, structured `log()` — no console.log)
- `activity.captured` — on a real transition (board_id, card_id, from, to, activity_id)
- `activity.stream.open` / `.backfill` / `.replay` / `.close` — connection lifecycle
- `activity.stream.error` / `activity.capture.error` — fail-safe degrade paths

## Validation Checklist
- [ ] Journey delivers stated value (ambient live awareness without action)
- [ ] All three personas can complete the (read-only) journey
- [ ] Errors are recoverable (auto-reconnect, self-healing degrade)
- [ ] Async states are explicit (five distinct states, never blank/silent)
- [ ] Consistent with existing patterns (Loading/EmptyState reuse, column `aria-labelledby` mirror)
- [ ] Accessible per WCAG 2.1 AA (decoupled announcer, text-not-color, no focus theft)
- [ ] Testable with the defined UAT sections and concrete selectors

## Journey Risks (for UAT)
1. **No card-move UI (highest-impact):** the board is read-only; the "move" MUST be an API `PATCH /api/cards/:id`. A walker expecting a drag/dropdown/button will fail to find one — that is expected, not a defect. Use the `javascript_tool` fetch recipe above.
2. **Columns are not live:** only the feed updates in realtime. "Column counts reflect the move" (AC-HAPPY-1) must be checked **after a reload**, not expected to change live. Do not FAIL the run for static columns during the live moment.
3. **Backfill needs pre-existing history:** to observe AC-ASYNC-1 non-blank, the board must already have ≥1 movement event, or the walker must create one and reload. A pristine board legitimately shows "No activity yet…" (not a failure).
4. **Choosing a *changing* transition:** the PATCH must target a status **different** from the card's current one, else AC-VERIFY-1 (no-op) is exercised instead of AC-HAPPY-1. Always read the card's current status first.
5. **Degraded threshold is 10s:** the walker must keep the SSE blocked/offline for **>10s** to observe `degraded`; a shorter blip only shows `reconnecting`.
6. **Single-instance fan-out:** live push works because there is one API container. If the harness somehow runs multiple API instances behind a balancer, live push may miss (events still replay on reconnect). Keep UAT single-instance.
7. **Two-context observation is optional:** because the move is API-driven, a single observing tab + an in-page PATCH is sufficient; a second "Marco" browser context adds no functional coverage (no auth to distinguish sessions) and raises flake risk.
8. **Announcement assertion is subtle:** verifying "exactly one polite announcement" requires inspecting the hidden `.visually-hidden` `aria-live` node's content change, not a visible toast. Assert on the DOM node, and assert the visible `<ul>` has NO `aria-live`.

## Next Steps
1. `/banyan-uat` walks Sections A–D at the configured viewports (desktop 1280×720 default; mobile 375×667 for Section B), using the `javascript_tool` PATCH recipe as the move trigger.
2. On PASS, generate the framework-agnostic E2E spec covering: entry region presence, live-move (with API trigger), no-op suppression, backfill-on-reconnect replay, and degraded state — mirroring the AC verifications above.
3. Feed any UAT findings (e.g. announcement timing, degraded copy) back into a `/banyan-build` follow-up before archive.

---

USER JOURNEY CREATIVE COMPLETE
Document: memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md
Journey: Open board `/boards/:id` → backfilled Activity panel (AC-ASYNC-1, AC-ENTRY-1) → a `PATCH /api/cards/:id` status change → new "Someone moved …" item live, newest-first, one polite announcement (AC-HAPPY-1/2, AC-INTEGRATION-1) → no-op PATCH changes nothing (AC-VERIFY-1); drop → "Reconnecting…" + gap replay (AC-ASYNC-2); sustained failure → "Activity feed offline", board still usable (AC-ERROR-1)
Pattern: Notification + Ambient Persistent Panel (read-only near-realtime SSE feed)
