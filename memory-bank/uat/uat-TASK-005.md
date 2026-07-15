# UAT Report — TASK-005: Realtime Activity Feed

**SYNTHESIZER STATUS**: PASS_WITH_RECOMMENDATIONS
**Counts**: Required=0  Recommended=2  Optional=0
**Confidence**: high=10 (AC verdicts) · high=2 (findings)

| Field | Value |
|-------|-------|
| Run ID | `20260715-uat-inline` |
| Task | TASK-005 (FEAT-005) |
| Journey | `memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md` |
| Environment | dev — `http://localhost:5173` (Vite SPA) → `/api` proxy → Express `:3000` → Postgres `:5432` |
| Sections walked | happy, negatives (read-only), errors (degraded + reconnect/replay); mobile — see LIMITATION |
| Persona | Priya (team_lead) primary; Marco (contributor) role-play move source; no auth (all "Someone") |
| Method | Inline walk (single browser context). Status changes triggered via in-page `PATCH /api/cards/:id` through the `/api` proxy — the genuine end-to-end path, since the board UI is read-only (no write controls). |
| Plugin | banyan-memory-bank |
| Timestamp | 2026-07-15 |

> **Note on method**: This run was walked inline by the orchestrator (single browser
> context) rather than via the multi-agent walker/synthesizer/spec-writer fleet, a
> deliberate cost-control decision for this session. All findings carry first-hand
> browser/DB/transport evidence and pass the evidence gate.

---

## Pre-flight: environment remediation (not a product finding)

On first navigation the feed rendered its **empty state** despite seeded movements.
Root cause: the dev Postgres **data volume predated `db/init/003_card_activity.sql`**
(volume created 2 days before Phase 1 landed the table), and Postgres only runs
`docker-entrypoint-initdb.d` scripts on a *fresh* volume — so `card_activity` was
absent. The PATCH capture's fail-safe `try/catch` swallowed the missing-table error
(`relation "card_activity" does not exist`), so PATCH still returned 200 with no row
and no emit. Remediated **non-destructively** by applying the idempotent `003`
migration in place (`CREATE TABLE IF NOT EXISTS …`) against the running DB — no data
dropped. This behaviour is captured as **REC-1** below.

---

## Acceptance Criteria — verdicts

| AC | Priority | Verdict | Evidence |
|----|----------|---------|----------|
| **AC-ENTRY-1** — feed region present, distinct, accessible name/role | MUST | ✅ PASS | a11y tree: `region` "Activity" with `aria-labelledby="activity-feed-heading"`, separate from the three column regions (To Do / In Progress / Done). |
| **AC-HAPPY-1** — status change appears live, no reload, at top | MUST | ✅ PASS | Live `PATCH /api/cards/3 {status:done}` with page open → new item appeared **at top without reload**: *"Someone moved \"Fix login bug\" from In Progress to Done"*; feed 2→3 items. |
| **AC-HAPPY-2** — human-readable, newest-first, non-color status, aria-live | MUST | ✅ PASS | Items read `Someone moved "<title>" from <From> to <To>`; newest-first order verified across backfill + live; status conveyed by **text** (from→to), not color; `aria-live="polite"` visually-hidden announcer fired with the live event text and stayed silent for backfill (arming heuristic). |
| **AC-ASYNC-1** — backfill on connect, consistent w/ persisted, never blank | MUST | ✅ PASS | On load, feed pre-populated with the 2 persisted events (ids 1,2); matches DB `card_activity` rows exactly (title + from→to + order). |
| **AC-ASYNC-2** — reconnecting state, auto-recover, replay gap (no loss) | SHOULD | ✅ PASS | Reconnecting banner `role="status"` "Reconnecting…" shown on transport drop. Transport replay: reconnect with `Last-Event-ID: 1` returned **only** ids 2,3 in order — no gap, no duplicate of id 1. |
| **AC-ERROR-1** — explicit degraded/offline state, board unaffected | MUST | ✅ PASS | Forced transport failure → banner `role="alert"` **"Activity feed offline"** (not a blank "no activity" panel); columns/cards kept rendering (`boardStillWorks: true`). |
| **AC-VERIFY-1** — no-op / non-status PATCH creates no event | MUST | ✅ PASS | Same-status PATCH (`done`→`done`) and title-only PATCH both returned 200 (title edit bumped `updated_at`), yet feed stayed at 3 items and DB `card_activity` stayed at **3 rows**. |
| **AC-VERIFY-2** — each real transition = exactly one well-formed row | MUST | ✅ PASS | DB: 3 rows, each with correct `board_id=1`, real `card_id`, denormalized `card_title`, CHECK-valid `from_status`/`to_status`; no dupes, no missing. |
| **AC-VERIFY-3** — delivery within budget, write path unregressed | SHOULD | ✅ PASS | Measured live push **229ms** from PATCH to DOM append (budget p95 < ~2s); emission is off the response path (fail-safe try/catch after the awaited write). |
| **AC-INTEGRATION-1** — real movement, two distinct moves differ, not canned | MUST | ✅ PASS | Backfill + live items reference the actual moved cards and actual from→to; three items all differ (Write API docs I→D, Fix login bug T→I, Fix login bug I→D) — not a fixed string. |

**All 10 ACs PASS. Required findings: 0.**

---

## Findings

### REC-1 (Recommended, confidence: high) — No migration path for existing deployments; missing activity table fails silently to an empty feed
- **Category**: deployment / observability
- **Evidence**: `card_activity` absent on the pre-existing dev volume (`relation "card_activity" does not exist`); feed rendered empty + SSE emitted only `: keep-alive`; PATCH capture error is swallowed by the fail-safe `try/catch` in `src/cards/cards.routes.ts` (logged as `activity.capture.error`, but PATCH still 200).
- **Why it matters**: `003_card_activity.sql` only auto-runs on a **fresh** Postgres volume. Any existing deployment upgraded to FEAT-005 will lack the table; the fail-safe design (correct for request resilience) means the failure is **invisible to the user** — the feed looks like "no activity yet" indefinitely rather than surfacing a fault.
- **Recommendation**: add a migration runner (or document a required manual `003` apply) for non-fresh environments, and surface a readiness signal (e.g. extend `/health` or log a startup warning) when `card_activity` is absent so an empty feed is distinguishable from a broken one.
- **Not Required because**: not an acceptance-criterion failure — the feature works correctly once the table exists (verified end-to-end).

### REC-2 (Recommended, confidence: high) — Mobile breakpoint not verifiable in this harness
- **Category**: test-coverage / environment
- **Evidence**: after `resize_window(375, 667)`, `window.innerWidth` still reported 2133 and the feed remained in the desktop 4th-grid-track position (`x=1281, w=320`); the `<640px` stacked layout media query never triggered. The Claude-in-Chrome MCP renders at a fixed large viewport regardless of window size.
- **Why it matters**: AC-ENTRY-1/HAPPY-2 mobile placement (feed stacked after Done, full-width) could not be confirmed live.
- **Recommendation**: verify mobile via real-device/emulated viewport (the generated E2E spec includes a mobile-viewport case for a harness with device emulation, e.g. Playwright).
- **Not Required because**: desktop layout verified; mobile is covered by the shipped responsive CSS + Phase-3 component structure; this is a harness limitation, not observed breakage.

---

## Decision

**Required = 0 → PASS.** Two Recommended findings do not block. Proceed to E2E spec
(generated: `memory-bank/uat/spec-TASK-005-e2e.md`).

**Recommended next step**: `/banyan-build TASK-005` to implement the E2E spec as
runnable tests (Phase 4). Optionally address REC-1 (migration path) as follow-up work.
