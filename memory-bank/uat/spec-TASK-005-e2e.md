# E2E Test Specification — TASK-005: Realtime Activity Feed

**Source**: UAT run `20260715-uat-inline` (PASS_WITH_RECOMMENDATIONS)
**Framework-agnostic** — implement in the project's E2E harness. No E2E framework is
configured today (component tests use **Vitest 3 + RTL**; backend uses **Vitest + Supertest**).
**Recommended harness**: Playwright (real browser + SSE + device emulation for the mobile case);
alternatively drive the API with Supertest for the transport-contract cases and RTL for the UI cases.

**Base URL**: `http://localhost:5173` (SPA) → `/api` proxy → Express `:3000` → Postgres.
**Pre-req**: `card_activity` table must exist (see REC-1 — apply `db/init/003_card_activity.sql`).
The board UI is **read-only**: trigger status changes via `PATCH /api/cards/:id { status }`.

---

## Confirmed selectors (from the walk)

| Element | Selector / accessible query |
|---------|------------------------------|
| Board heading | `heading` name = board name (e.g. "Q3 Delivery Board") |
| Column regions | `region` with `heading` "To Do (N)" / "In Progress (N)" / "Done (N)" |
| Activity region | `region` labeled by `#activity-feed-heading` (accessible name "Activity") |
| Feed list | `ul` inside the Activity region; items are `li` |
| Feed item text | `Someone moved "<card_title>" from <From> to <To>` |
| Feed item time | `<time>` → e.g. "Jul 15, 2026, 6:32 PM" |
| Empty state | text "No activity yet. Card moves on this board will appear here." |
| Connecting state | "Loading activity…" |
| Reconnecting state | element `role="status"`, text "Reconnecting…" |
| Degraded state | element `role="alert"`, text "Activity feed offline" |
| aria-live announcer | `[aria-live="polite"].visually-hidden` (decoupled from the list) |

## Observed waits

- Backfill render after connect: < 1.5s.
- Live push (PATCH → DOM append): ~230ms (assert < 2s).
- Degraded transition after unrecoverable transport error: ~3s (assert ≤ ~10s).

---

## Setup / teardown

- **Seed** (per test or suite): `POST /api/boards {name}` → capture `boardId`; `POST /api/cards {board_id, title, status}` for each fixture card.
- **Backfill fixture**: perform ≥2 real transitions via `PATCH /api/cards/:id {status}` (from ≠ to) before opening the board.
- **Teardown**: `DELETE /api/boards/:id` (CASCADEs activity) — keeps runs isolated.
- **Isolation**: one board per test; assert counts relative to seeded fixtures, not absolutes.

---

## Test cases

### E2E-1 — Entry: feed region present and accessible (AC-ENTRY-1)
1. Seed board + cards. Navigate to `/boards/:id`.
2. Assert a `region` with accessible name "Activity" exists, distinct from the three column regions.
3. Assert it has an accessible name via `aria-labelledby`.

### E2E-2 — Backfill on connect (AC-ASYNC-1)
1. Seed board; perform 2 transitions (e.g. card A todo→in_progress, card B in_progress→done).
2. Navigate to `/boards/:id`.
3. Assert the feed is **not** empty and shows exactly the 2 seeded events, **newest-first**, with correct titles + from→to labels. Cross-check against `GET /api/activity/stream` backfill frames (ids, order).

### E2E-3 — Live push without reload (AC-HAPPY-1, AC-VERIFY-3)
1. Open `/boards/:id` (feed connected).
2. `PATCH /api/cards/:id {status}` a real transition.
3. Assert a new item appears **at the top** within 2s **without navigation/reload**; assert item text names the moved card + correct from→to.

### E2E-4 — Human-readable + newest-first + aria-live (AC-HAPPY-2)
1. With feed open and backfill present, trigger one live transition.
2. Assert phrasing `Someone moved "<title>" from <From> to <To>`; order newest-first.
3. Assert the `aria-live` announcer contains the **new live** event text and did **not** announce the backfill items (arming heuristic).
4. Assert status is conveyed by text, not color alone.

### E2E-5 — No-op / non-status PATCH emits nothing (AC-VERIFY-1)
1. Open board; record feed item count N.
2. `PATCH /api/cards/:id {status: <current status>}` (same status).
3. `PATCH /api/cards/:id {title: "edited"}` (non-status field).
4. Assert feed count still N and `SELECT count(*) FROM card_activity` unchanged.

### E2E-6 — Exactly one well-formed row per transition (AC-VERIFY-2, AC-INTEGRATION-1)
1. Perform two distinct transitions on two different cards.
2. Assert 2 new `card_activity` rows with correct board_id/card_id/card_title/from/to and CHECK-valid statuses.
3. Assert the two feed items **differ** (real data, not a canned string).

### E2E-7 — Reconnect replays missed events, no gap/dupe (AC-ASYNC-2)
- **Transport-level**: open stream, note last id; create a new event; reconnect with `Last-Event-ID: <prevId>`; assert replay returns **only** ids > prevId, in order, no duplicate of prevId.
- **UI-level**: with the feed open, drop the connection (Playwright route abort / network offline on `**/api/activity/stream*`); assert `role="status"` "Reconnecting…" shows; restore; assert it recovers and any events created during the gap appear (no loss).

### E2E-8 — Degraded transport surfaced, board unaffected (AC-ERROR-1)
1. Block/abort `**/api/activity/stream*` so the transport cannot establish.
2. Open `/boards/:id`.
3. Assert `role="alert"` "Activity feed offline" is shown (not the empty "no activity" panel).
4. Assert columns and cards still render (board reads unaffected).

### E2E-9 — Mobile layout (AC-ENTRY-1/HAPPY-2 @ <640px) — REC-2
1. Emulate a 375×667 viewport (device emulation).
2. Navigate to `/boards/:id`.
3. Assert the Activity region is present, full-width, and stacked **after** the Done column.
> Requires a harness with true device emulation (not verifiable in the current UAT MCP).

---

## Notes for the implementer
- Prefer role/accessible-name queries over CSS classes (matches the shipped a11y contract).
- For SSE in Playwright, use `page.route` to abort/fulfill `**/api/activity/stream*` for the failure/reconnect cases.
- Keep timing assertions generous (< 2s live, ≤ 10s degraded) to avoid flake; do not assert exact latency.
- The `Someone` actor token will change when auth lands — assert the structure, not the literal "Someone", if forward-compatibility matters.
