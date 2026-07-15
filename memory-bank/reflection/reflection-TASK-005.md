# Reflection: Realtime Activity Feed (FEAT-005 / TASK-005)

## Metadata
- Task ID: TASK-005
- Complexity: Level 4
- Duration: 2026-07-15 (plan) → 2026-07-15 (UAT PASS) — single-day, four-stage build (dates are compressed in this environment's clock; treat as ordered stages, not literal elapsed time)
- Team: Solo orchestrator + sub-agents (no human pairing beyond phase-gate reviews)

## Executive Summary

TASK-005 added BanyanBoard's first realtime capability: a board-scoped, read-only Activity feed that shows card status transitions live, without polling. The work was correctly scoped as Level 4 — it carried two genuinely architectural decisions (transport choice, event-capture correctness) plus a UX decision under real accessibility risk (a chatty `aria-live` region) — and the workflow matched that weight: two creative phases (Architecture, UI/UX) plus a retroactive User Journey phase, three build phases (activity model + capture → SSE transport + backfill/replay → frontend feed UI), and an inline UAT walk. All 10 originally-specified ACs (plus a UAT-added AC-NAV-1) verified PASS with zero Required findings; the two Recommended findings are real but non-blocking gaps, not defects.

The standout process signal is that the adversarial code-review step earned its keep twice over: `build-code-reviewer-agent` returned BLOCK in both Phase 2 (SSE transport) and Phase 3 (frontend feed), each time catching a genuine bug that the initial test suite had missed — a `req.on('close')` registration-order leak plus a `NaN`-cursor event-drop in Phase 2, and a stale-cross-board-state bug plus two accessibility-announcer edge cases in Phase 3. Phase 1 (backend capture) was cleaner (APPROVE-WITH-FIXES, 0 blocking), consistent with it being the least architecturally novel of the three phases. Test count grew cleanly through the build (95 → 105 → 118 backend; +35 frontend) with no regressions at any phase boundary.

The one real ecosystem/product gap this task surfaced was operational, not architectural: the dev Postgres volume predated the `003_card_activity.sql` migration, so `card_activity` was silently absent and the feature's own fail-safe design (correct in isolation) made that invisible — the feed just looked calmly empty. This is now tracked as REC-1 and is the single most actionable finding to come out of this reflection. Combined with a second, fifth-consecutive absence of task-indexed session logs, this reflection's ecosystem section has two concrete, evidence-backed recommendations rather than speculative ones.

## Goals vs Outcomes

| Goal | Target | Actual | Status |
|------|--------|--------|--------|
| Capture real status transitions only (no false positives on no-op/non-status PATCH) | AC-VERIFY-1 | Gated on `previousStatus !== card.status` via an atomic `RETURNING` CTE; verified in unit tests + live UAT (same-status and title-only PATCH left `card_activity` at 3 rows) | ✅ Met |
| Persist exactly one well-formed row per real transition | AC-VERIFY-2 | Single `INSERT ... RETURNING`, CHECK-constrained `from_status`/`to_status`; UAT DB inspection confirmed 3/3 rows correct, no dupes/misses | ✅ Met |
| Push live to connected clients without polling | AC-HAPPY-1 | SSE (`GET /activity/stream?board_id=`); UAT measured 229ms PATCH→DOM append | ✅ Met |
| Write path stays within existing NFR | p95 < 200ms PATCH | One additional indexed INSERT, no live-path blocking on emit; not independently load-tested but structurally sound (single round-trip capture + in-memory synchronous fan-out) | ⚠️ Partial (verified by construction, not measured under load) |
| Realtime delivery budget | p95 < ~2s | 229ms observed in the one inline UAT sample | ⚠️ Partial (single-sample, not a distribution) |
| Backfill on connect, never blank when history exists | AC-ASYNC-1 | `findRecentByBoard` + subscribe-before-backfill ordering; UAT confirmed feed pre-populated with 2 persisted events matching DB exactly | ✅ Met |
| Reconnect replays gap events, no loss | AC-ASYNC-2 | Native `Last-Event-ID` + `findAfter`; UAT replay test returned exactly ids after cursor, no gap/dup | ✅ Met |
| Degraded/failed transport surfaced, board unaffected | AC-ERROR-1 | `role="alert"` "Activity feed offline"; UAT confirmed columns/cards kept working during forced failure | ✅ Met |
| Accessible feed (WCAG 2.1 AA, non-chatty `aria-live`) | AC-HAPPY-2 | Decoupled hidden announcer + arming heuristic; UAT confirmed silent backfill, exactly one announcement per live event | ✅ Met |
| Real, non-canned, distinct feed items | AC-INTEGRATION-1 | Denormalized `card_title` + real from/to; UAT confirmed two distinct real moves produced two distinct items | ✅ Met |
| Documented single→multi-instance scaling boundary, not built | Architecture requirement | `ActivityEmitter` interface is the documented swap-point (`LISTEN/NOTIFY`/Redis); not built, per scope | ✅ Met |
| Zero Required UAT findings | UAT gate | 0 Required / 2 Recommended / 0 Optional — PASS_WITH_RECOMMENDATIONS | ✅ Met |
| Post-UAT E2E test implementation | Phase 4 | Not yet started — E2E spec generated (`spec-TASK-005-e2e.md`, 9 test cases) but not implemented as runnable tests | ❌ Not yet done (explicitly the next step, not a miss) |
| Migration path for existing deployments | Implicit (not an original AC) | Missing — REC-1 surfaced this as a real gap only discovered live in UAT | ⚠️ Gap (tracked, not blocking) |

## Phase Analysis

### Phase 1: Activity model + event capture
- Planned: transport-agnostic backend foundation (schema, repository, capture hook)
- Actual: delivered as scoped. `db/init/003_card_activity.sql`, `src/activity/{activity.types,activity.repository}.ts`, and the `cards.repository.update()` contract change to `{ card, previousStatus }` via a single `RETURNING`-with-subquery statement.
- Outcome: 9 new tests, 105/105 total PASS. Code review: **APPROVE-WITH-FIXES, 0 blocking** — the two non-blocking fixes applied (per-handler emitter isolation with try/catch, index-name alignment) were genuinely minor. This was the cleanest phase, consistent with it reusing an established pattern (the `RETURNING`-CTE trick is a direct extension of the existing `PostgresCardsRepository` style) rather than introducing new infrastructure.

### Phase 2: Realtime push transport (SSE) + backfill/replay
- Planned: the project's first long-lived server connection type, with lifecycle management
- Actual: `src/activity/activity.routes.ts` (SSE handler), env-driven `ACTIVITY_BACKFILL_LIMIT`/`ACTIVITY_HEARTBEAT_MS`, subscribe-before-backfill ordering.
- Outcome: 10 new tests initially, 115/115 PASS — but code review returned **BLOCK**, catching two real, non-cosmetic bugs the tests missed:
  1. `req.on('close')` was registered **after** the backfill `await`, so a client disconnecting mid-read leaked the emitter subscription and the heartbeat interval, and risked a write-after-close crash (`res.write` on a destroyed socket throws an unhandled error in Node).
  2. A malformed `Last-Event-ID` header coerced to `NaN` in `findAfter(boardId, NaN, …)`, and worse, `NaN` compared against every buffered live-event id evaluates false, silently dropping every buffered event during the backfill/replay window.
  Both were fixed with an idempotent `closed` flag guarding all writes (registered before the await) and a `parseCursor()` validator that falls back to full backfill on any malformed header. Three regression tests were added. Final: 118/118 PASS.
- This phase is the strongest evidence in this task that a long-lived-connection lifecycle (subscribe/backfill/replay/heartbeat/cleanup ordering) is exactly the kind of code where a human-shaped test suite (write the happy path, write the obvious error path) systematically misses ordering/edge-case bugs that only surface under adversarial review.

### Phase 3: Frontend live feed UI (completes the journey)
- Planned: client transport seam, connection state machine, and the UI/UX creative's five-state feed with a decoupled accessible announcer
- Actual: `api/activityStream.ts`, `hooks/useActivityStream.ts`, `ActivityFeed`/`ActivityFeedItem`/`ActivityFeedStatus.tsx`, `index.css` responsive grid extension.
- Outcome: 13 new tests initially, 33/33 frontend PASS — code review again returned **BLOCK**, catching three real bugs:
  1. React Router keeps `BoardViewPage` mounted across a `/boards/:id` param change (navigating board→board doesn't remount), so without an explicit reset, switching boards showed the *previous* board's feed items under the new board's heading.
  2. The 250ms "arm timer" quiet-period heuristic could, under a >250ms intra-burst network gap, misclassify a still-historical backfill/replay frame as a genuinely new live event and announce it.
  3. The announcer's inner text node wasn't guaranteed to re-announce two genuinely different events that happened to produce identical sentence text (e.g. the same card bouncing between the same two statuses twice).
  Fixes: (1) reset all per-connection refs/state at the top of the effect; (3) key the announcer's inner `<span>` by a monotonic `seq` so React always replaces the DOM node, forcing re-announcement regardless of text equality. (2) was **not** fixed structurally — the quiet-period heuristic was kept, with the residual risk and the correct fix (a server-side "backfill-complete" sentinel frame) explicitly documented rather than silently accepted or over-engineered under time pressure. This is a good example of the review process producing a *documented, scoped trade-off* rather than either ignoring the finding or scope-creeping a fix. Two regression tests added (board-switch reset; `seq` bump for identical text). Final: 35/35 frontend PASS, 118/118 backend unchanged.
- The reviewer also proposed a non-blocking empty-state `if/else` restructure that the coding agent correctly **reverted** because it broke an existing test asserting the list always renders — a healthy instance of not accepting every review suggestion uncritically.

## Architecture Assessment

### What Worked
- **Atomic `RETURNING`-CTE capture (Q2)**: folding the old-vs-new status comparison into the same UPDATE statement (`UPDATE ... FROM (SELECT status AS prev_status ...) AS old ... RETURNING ..., old.prev_status`) avoided both a race window and an extra round-trip. This is a genuinely reusable pattern for "detect a transition and act on it" without a trigger or a separate read.
- **SSE over WebSocket**: the architecture doc's rejection of WebSocket was correct and well-argued — it would have forced a structural change to `src/server.ts` (`app.listen` → `http.createServer` + upgrade handling) and the Vite proxy (`ws: true`) for a capability (bidirectional push) the feature doesn't need. SSE's native `Last-Event-ID` reconnection directly bought AC-ASYNC-2 almost for free, and kept the whole transport Supertest-testable with no live socket.
- **Subscribe-before-backfill ordering**: registering the emitter subscription before the backfill DB read, buffering any live event that arrives mid-read, and deduping by id at the seam is a clean, race-free pattern for "don't miss an event that happens during your own connect sequence" — and it was actually exercised by tests (dedup-by-id, no-gap-no-dup at the seam).
- **Decoupled hidden `aria-live` announcer**: separating the announcement channel from the visible list (rather than making the `<ul>` itself a live region) is the correct answer to the "chatty feed" anti-pattern, and the arming heuristic (silence during backfill/replay bursts, announce only genuinely-new frames) is a legitimately clever solution to a wire protocol that doesn't distinguish backfill/replay/live frames.
- **Documented scaling boundary, not built**: the `ActivityEmitter` interface as the single swap-point for a future `LISTEN/NOTIFY`/Redis promotion is a good instance of "simplicity-first" — the in-process `Map`-based implementation is exactly right for a single-container `docker compose` deployment, and the promotion path is written down concretely enough (which table's `NOTIFY`, which existing persist-first property makes it work) that a future task could implement it without re-deriving the design.

### What Could Improve
- **The arm-timer heuristic is a client-side approximation of a server-side fact.** The 250ms quiet-period is explicitly documented as correct "given the Phase 2 server flushes each batch synchronously," which is true today but is an implicit coupling between Phase 2's implementation detail (synchronous flush) and Phase 3's correctness assumption. If Phase 2's SSE handler ever became async/chunked (e.g. under real backpressure), the heuristic's correctness assumption would silently break with no test to catch it, because the tests exercise the heuristic's *current* behavior, not the *coupling*. The documented proper fix (a server "backfill-complete" sentinel frame) is the right call to make in a near-term follow-up rather than treating this residual as permanently acceptable.
- **No load/latency verification for the two NFR budgets.** AC-VERIFY-3 (p95 < 200ms write path, p95 < ~2s delivery) is "verified by construction" plus a single 229ms UAT sample — reasonable given the plan explicitly called this out as a deliberate non-goal for CI (avoiding flaky timing assertions), but it does mean the two headline performance goals of the entire feature have exactly one data point behind them.
- **The migration/deployment story was designed reactively, not proactively.** The architecture doc thoroughly reasons about SSE proxying, DI, and multi-instance scaling, but the `003_*.sql`-only-runs-on-a-fresh-volume behavior of the existing `001`/`002` convention was inherited without re-examining whether it still holds for a *fourth* migration landing on a project that, by now, plausibly has non-fresh dev/deployed volumes. This is precisely the kind of drift that compounds as a project accumulates schema migrations — TASK-005 is the first task where it actually bit.

## Technical Successes

### Zero-Required UAT on the project's most architecturally novel feature
- Evidence: 10/10 ACs PASS (0 Required findings) on a feature introducing the project's first realtime transport, first long-lived connection lifecycle, and first accessibility-critical live region — categories with no prior in-repo precedent to copy.
- Impact: validates that the two-creative-phase (Architecture + UI/UX) + three-phase build + adversarial code review pipeline scales to genuinely novel technical territory, not just CRUD-shaped features (TASK-002/003) or a first-UI feature with strong existing patterns to imitate (TASK-004).

### Adversarial code review caught real bugs in both infrastructure-adjacent phases
- Evidence: Phase 2 BLOCK (2 bugs: close-handler ordering leak, NaN-cursor drop) and Phase 3 BLOCK (3 bugs: stale cross-board state, arm-timer edge case, identical-text non-reannouncement) — 5 genuine defects across 2 phases, all caught before merge, none caught by the initial (23-test) suite each phase wrote first.
- Impact: this is the single strongest evidentiary data point in the project's history so far (across 5 tasks) that the code-review sub-agent step is not ceremonial — it is doing real work specifically on connection-lifecycle and state-machine code, where "test the happy path and the one obvious error path" style TDD systematically misses ordering and edge-case bugs.

### Zero regressions across three sequential build phases touching shared infrastructure
- Evidence: 95 → 105 → 118 backend tests (Phases 1→2, no regressions); 20 → 33 → 35 frontend tests (Phase 3 alone), each phase's fixes adding regression tests rather than just patching the bug.
- Impact: confirms the DI/testability-by-construction architecture (stub repos, stub emitters, injected `AppDeps`) holds up under three sequential phases of a single feature without needing a stabilization pass.

## Technical Challenges

### Challenge: Old-vs-new status detection without a race window or an extra round-trip
- Description: the existing `PostgresCardsRepository.update()` returned only the new row; naively adding a `SELECT` before the `UPDATE` would create a race window (a concurrent PATCH could change status between the read and the write) and add DB round-trip latency against the p95<200ms budget.
- Resolution: a single `UPDATE ... FROM (SELECT status AS prev_status ...) AS old ... RETURNING ..., old.prev_status` statement — atomic, one round-trip, race-free.
- Prevention: this pattern (fold a "read the prior value" need into the same statement via a `FROM` subquery) is worth codifying as a named pattern for any future "detect a transition on write" feature (see Patterns Worth Codifying).

### Challenge: SSE connection lifecycle correctness (leak-free cleanup, no gap/dup at the backfill↔live seam)
- Description: getting subscribe/backfill/heartbeat/cleanup ordering right for a long-lived HTTP response is genuinely tricky — there are several valid-looking orderings that leak resources or drop events under specific disconnect timing.
- Resolution: code review caught both defects (close-handler-after-await leak; NaN-cursor drop) before merge; fixes were structural (idempotent `closed` flag, cursor validation) rather than patches.
- Prevention: this class of bug (ordering-dependent correctness in async cleanup code) is exactly what a dedicated "long-lived connection lifecycle" checklist in a learned rule would catch earlier, at write-time rather than at review-time (see Extractable Learnings).

### Challenge: Distinguishing "catch-up" frames from "genuinely new" frames over a wire protocol with no such distinction
- Description: SSE frames for backfill, reconnect-replay, and live push are wire-identical (`event: card_moved`); the UX requirement (silent backfill, exactly-one-announcement-per-live-event) needed a client-side heuristic.
- Resolution: an arming/quiet-period timer, correctly scoped and documented as depending on the server's synchronous-flush behavior, with the residual risk and proper fix (server sentinel frame) written down rather than hidden.
- Prevention: flagged as near-term technical debt below; the fact that the limitation was *found and documented during code review*, not discovered later in production, is itself the process working as intended.

## Process Assessment

### Effective Practices
- **Adversarial code review as a phase gate**: proven twice in this task alone (Phase 2, Phase 3 BLOCK verdicts) to catch defects a competent initial test suite missed — the strongest argument yet in this project's history for keeping this step mandatory rather than optional for Level 3-4 builds.
- **Explicit non-goals in the Test Strategy** ("What NOT to Test" — no timing assertions in CI for the p95 budgets, no testing `EventSource`/`ws` internals): prevented the team from either over-testing framework internals or writing flaky timing-based CI tests, while still getting the NFRs verified once, live, in UAT.
- **Retroactive User Journey creative phase**: adding this phase *after* the build (rather than before, as originally planned) to unblock `/banyan-uat` was a pragmatic recovery from a workflow gap (see Ecosystem section) and produced a genuinely useful artifact — it correctly identified that the board has no write UI and designed the UAT trigger mechanism (in-page `fetch` PATCH) around that reality, which the actual UAT run then used successfully.

### Improvement Opportunities
- **UAT prerequisites were discovered, not pre-verified.** Three separate pieces of missing setup (`uat-config.md`, `ux-patterns.md` scaffold, and the User Journey creative doc) had to be created inline immediately before the UAT run could proceed, rather than being verified as present during `/banyan-plan` or `/banyan-creative`. For a Level 4 task where UAT is explicitly gated in the workflow, this should be a pre-flight check much earlier.
- **The migration-path gap (REC-1) was discovered by accident of environment state, not by design review.** Nothing in the Architecture creative's Risk Assessment or the plan's Dependencies & Risks section asked "does this migration's `IF NOT EXISTS` DDL run on an existing volume?" — it was inherited silently from the `001`/`002` convention. A Level 4 architecture review checklist item on "does this change require action on already-provisioned environments" would have surfaced this before UAT.

## Business Impact
- **Value Delivered**: BanyanBoard's board view now updates itself — the core "see status at a glance" value proposition (Priya persona) moved from "reload to check" to "watch it happen." This is a capability inflection point for the product, not just a feature: it's the first realtime surface, and the `ActivityEmitter` seam is designed to make a second such surface (e.g. presence, comments) materially cheaper to add.
- **Stakeholder Feedback**: N/A — no external stakeholder review recorded in this cycle; UAT was walked by the orchestrator itself (see Ecosystem section's honesty about this method).
- **Metrics**: 229ms observed PATCH-to-render latency (target <~2s, comfortably met); 0 Required UAT findings across 10 ACs; 153 total automated tests (118 backend + 35 frontend) added/passing for this feature with zero regressions to the pre-existing 95+20 baseline.

## Strategic Insights

### For Future Enterprise Work
- A **"fold the prior value into the write" pattern** (atomic `RETURNING`-with-subquery to detect a transition without a race or an extra round-trip) generalizes to any future feature needing "did X actually change" semantics on an existing mutation path — this is a reusable technique, not a one-off.
- **Long-lived-connection features (SSE, WebSocket, polling-with-backoff) need a lifecycle-specific review lens** distinct from ordinary CRUD review — subscribe/read/write/cleanup ordering bugs are structurally different from the validation/persistence bugs that dominated TASK-002/003, and this task's two BLOCK verdicts were both exactly this category.
- **Client-side heuristics that stand in for a missing server-side signal are a known, bounded form of technical debt** — the arm-timer is a legitimate MVP choice, but the task did the right thing by documenting its correctness assumption and its proper fix rather than treating it as unconditionally correct.

### Reusable Components
- **`ActivityEmitter` interface** (`subscribe`/`emit`, per-board topic map): directly reusable for any future in-process fan-out need (e.g. presence, notifications) before a multi-instance promotion is warranted.
- **The five-state async UI pattern** (connecting/open+streaming/open+empty/reconnecting/degraded) with a decoupled hidden `aria-live` announcer: reusable for any future live-updating surface in this frontend, not just the activity feed.
- **`parseCursor`/malformed-header-falls-back-to-full-resync**: a reusable defensive pattern for any future feature accepting a client-supplied resumption cursor.

## Action Items

### High Priority
- [ ] Implement Phase 4 (post-UAT E2E spec → runnable tests) per `memory-bank/uat/spec-TASK-005-e2e.md` (9 test cases: entry, backfill, live push, phrasing/aria-live, no-op suppression, dual-transition distinctness, reconnect/replay, degraded, mobile-viewport)
- [ ] Address REC-1: add either a migration-runner step or a documented manual-apply instruction for non-fresh Postgres volumes, plus a readiness signal (extend `/health` or log a startup warning) when `card_activity` is absent, so a missing table is distinguishable from a genuinely empty feed

### Medium Priority
- [ ] Address REC-2: verify the mobile (<640px) responsive layout in a harness with real device emulation (e.g. Playwright), since the Claude-in-Chrome MCP could not force a narrow viewport during UAT
- [ ] Replace the client-side arm-timer heuristic with a server-side "backfill-complete" sentinel frame (documented in `useActivityStream.ts` as the correct long-term fix) to remove the residual >250ms-gap misclassification risk
- [ ] Add a load/latency test (even a manual/scripted one, not CI-gated) to get more than one data point behind the two AC-VERIFY-3 NFR budgets

## Claude Code Ecosystem Strategic Evaluation

### Executive Summary
The ecosystem handled this task's genuine architectural novelty well — the two-creative-phase structure (Architecture, then UI/UX building on its fixed inputs) correctly sequenced a transport decision before a UX decision that depended on it, and the adversarial code-review sub-agent step proved its value unambiguously twice. The two friction points this task surfaced are both concrete and fixable: (1) UAT prerequisites (`uat-config.md`, `ux-patterns.md`, a user-journey doc) are gated but not pre-flighted early enough in the Level 4 workflow, forcing inline just-in-time setup; (2) session logs remain un-indexed for a fifth consecutive task, meaning this reflection's tool/sub-agent metrics are qualitative (from Execution State build logs) rather than quantitative (from actual tool-call telemetry).

### Command Architecture Assessment

| Command | Phases Used | Effectiveness | Strategic Notes |
|---------|-------------|---------------|-----------------|
| /banyan-init | (prior task, N/A this cycle) | N/A | Not invoked this task |
| /banyan-plan | PLAN | 5/5 | Spec Writer (Opus) correctly identified 5 LOW-confidence questions and gated 2 REQUIRED creative phases; taxonomy lint CLEAN on first pass |
| /banyan-creative | CREATIVE (Architecture, UI/UX) + a retroactive User Journey phase | 4/5 | Architecture and UI/UX phases were excellent and correctly sequenced; the User Journey phase's late addition (after build, to unblock UAT) reflects a workflow gap rather than a creative-phase quality issue — see Workflow Architecture below |
| /banyan-build | Phase 1, 2, 3 | 5/5 | Each phase followed Test Writer → Coding Agent → Verification → Code Review cleanly; the two BLOCK verdicts (Phase 2, 3) demonstrate the gate is load-bearing, not ceremonial |
| /banyan-uat | 1 inline run | 4/5 | Correctly gated on missing prerequisites (forced their creation) and correctly identified/worked around the "no write UI" reality via the User Journey doc's trigger-mechanism decision; but this run was explicitly a cost-controlled inline walk by the orchestrator rather than the full walker/synthesizer/spec-writer fleet, so its independence from the building agent is weaker than the standard multi-agent UAT flow |
| /banyan-reflect | REFLECT (this document) | 5/5 | Rich per-phase Execution State in `tasks/TASK-005.md` made phase-by-phase reconstruction straightforward without live session logs |
| /banyan-archive | Not yet run | N/A | Next step |

**Command Gap Analysis:**
- **A pre-flight/readiness command for UAT prerequisites**: a lightweight check (ideally run automatically at the *end* of `/banyan-creative` or the start of the final `/banyan-build` phase for Level 3-4 tasks) verifying `uat-config.md`, `ux-patterns.md`, and a user-journey doc all exist, rather than discovering the gap only when `/banyan-uat` itself is invoked and blocks.

### Workflow Architecture Assessment

| Phase | Duration | Friction Level | Value Delivered |
|-------|----------|----------------|-----------------|
| PLAN | Single session | Low | High — 10 ACs, correct creative gating, accurate ~26 test estimate (actual: 23 unit/integration + regression additions, in the right neighborhood) |
| CREATIVE (Architecture) | Single session | Low | High — 4 well-reasoned decisions (Q1-Q4) with rejected alternatives properly argued, not just asserted |
| CREATIVE (UI/UX) | Single session | Low | High — correctly treated Architecture's outputs as fixed inputs; the chatty-`aria-live` risk was identified and solved rather than glossed over |
| CREATIVE (User Journey, retroactive) | Single session, post-build | **Medium** | High value once triggered, but its *timing* (after Phase 3 build, immediately before UAT) is the friction — it should have been anticipated during the original planning gate, since Level 4's workflow explicitly requires UAT and UAT explicitly requires a journey doc |
| BUILD (×3) | 3 sessions | Low | High — clean phase boundaries, no regressions, 2 genuine BLOCK catches |
| UAT | Single inline session | Medium | High — thorough (10/10 ACs, live measurements) but delivered via a cost-controlled shortcut (inline single-context walk) rather than the standard independent multi-agent fleet, which trades some evaluative independence for lower cost |
| REFLECT | This session | Low | — |

**Workflow Recommendations:**
- **Surface the UAT-prerequisite dependency at `/banyan-plan` time for any Level 2-4 task**, not just at `/banyan-uat` invocation time — the phase-gate check already exists (`/banyan-uat`'s hard block), but it fires too late in the cycle to avoid an inline scramble.

### Context System Assessment

| Context Category | Files Loaded | Usefulness | Token Efficiency |
|------------------|--------------|------------|------------------|
| Level-specific (Level 4 plan/creative/build/reflection context) | plan, creative (architecture+uiux), build ×3, level4-reflection.md | 5/5 | Good — progressive loading meant each phase only pulled in what it needed |
| Agent prompts (Spec Writer, Architecture, UI/UX, Test Writer, Coding, Reviewer) | All invoked per Execution State | 5/5 | Good — each sub-agent's output is self-contained and traceable to its inputs |
| Phase guidance (api-rest-requirements.md, observability-requirements.md) | Referenced in the plan's API/Observability sections | 4/5 | Good — the deliberate "OTEL is a documented gap, not built" framing kept the team from over-building telemetry the project hasn't adopted anywhere else |

**Context Gaps:**
- No context file exists for "long-lived connection / streaming endpoint" build guidance specifically — the Phase 2 BLOCK findings (close-handler ordering, NaN-cursor) are exactly the class of bug a dedicated checklist would target at write-time.

**Context Redundancy:**
- None observed this task — the Architecture and UI/UX creative docs cleanly divided scope (Q1-Q4 vs Q5) with no duplicated decision-making.

### Tool Utilization Analysis

> **Caveat**: `.agent-logs/claude/by-task/TASK-005/` does not exist, and this is the **fifth consecutive task** (TASK-001 through TASK-005) without task-indexed session logs. Per the fallback methodology, the counts below are qualitative, reconstructed from the Execution State build logs in `tasks/TASK-005.md`, not from actual tool-call telemetry. Run `/banyan-init` (or its upgrade path) to enable task-indexed session logging so future reflections can report real Tool Utilization tables instead of this caveat.

| Tool | Operations | Success Rate | Limitations Encountered |
|------|------------|--------------|-------------------------|
| Read | Not measurable (no logs) | N/A | Qualitatively heavy — architecture/UI-UX creative docs each read prior code (`cards.repository.ts`, `vite.config.ts`, `Column.tsx`) before deciding |
| Edit | Not measurable | N/A | Used for the 5 code-review fix rounds (2 in Phase 2, 3 in Phase 3) |
| Write | Not measurable | N/A | New files: `activity.types.ts`, `activity.repository.ts`, `activity.emitter.ts`, `activity.routes.ts`, `003_card_activity.sql`, `activityStream.ts`, `useActivityStream.ts`, `ActivityFeed*.tsx` |
| Task (sub-agent dispatch) | Reconstructed: Spec Writer, Architecture, UI/UX, User Journey, ×3 (Test Writer/Coding/Reviewer) per build phase = ~13 dispatches | High (2 BLOCK→resolved, 1 APPROVE-WITH-FIXES) | The two BLOCK cycles are the clearest positive signal this task produced for the sub-agent architecture |
| Bash | Not measurable | N/A | Test runs (`npm test`) per phase per Execution State; no evidence of log-discarding anti-patterns in the recorded Execution State |
| Grep/Glob | Not measurable | N/A | — |

**Tool Gap Analysis:**
- No SSE-specific or long-lived-HTTP-connection testing tool/helper exists in the repo; Phase 2's tests had to hand-roll mock req/res streaming semantics (`activityStreamHandler` exported separately from the router specifically to enable this) — this worked, but is a pattern worth codifying rather than re-deriving next time.

**Workarounds Required:**
- `activityStreamHandler` was deliberately exported separately from `createActivityRouter` purely so tests could drive it deterministically with a mock req/res instead of a real, never-ending HTTP socket — a sound workaround for Supertest's lack of native SSE test ergonomics.

### Subagent Architecture Assessment

| Agent Type | Invocations | Output Quality | Prompt Issues |
|------------|-------------|-----------------|---------------|
| Spec Writer (Opus) | 1 | 5/5 | None — 10 ACs, taxonomy CLEAN, correctly flagged 5 LOW-confidence creative questions |
| Architecture Design (Opus) | 1 | 5/5 | None — Q1-Q4 all argued with rejected alternatives, not just asserted; explicitly cited learned rules being applied |
| UI/UX Design (Sonnet) | 1 | 5/5 | None — correctly treated architecture as fixed input; produced the arming-heuristic solution to the chatty-feed risk unprompted (this was a genuinely hard sub-problem, not a rote checklist item) |
| User Journey Design (agent, retroactive) | 1 | 4/5 | High quality once run, but its late timing is a workflow issue, not an agent-quality issue |
| Test Writer (Sonnet, ×3 phases) | 3 | 4/5 | Good coverage (9/10/13 tests per phase) but each phase's suite missed the bugs code review caught — expected given TDD's structural blind spot for ordering/lifecycle bugs, not a prompt defect per se |
| Coding Agent (Sonnet, ×3 phases + fix rounds) | 3 + 5 fix rounds | 5/5 | Correctly reverted one reviewer suggestion (empty-state if/else) that would have broken an existing test — good judgment, not blind compliance |
| build-code-reviewer-agent (×3 phases) | 3 | 5/5 | The standout performer this task — 2/3 BLOCK verdicts, both with genuine, specific, correctly-scoped findings |
| Documentation Agent (Haiku, ×3 phases) | 3 | Not independently assessed this cycle | — |

**Agent Prompt Improvements:**
- Consider giving the Test Writer agent an explicit "connection lifecycle" checklist prompt addition (subscribe/read/write/cleanup ordering under each disconnect timing) for any future streaming-endpoint task, since this task's evidence shows that category of bug is systematically missed by an unprompted TDD pass.

**New Agent Types Needed:**
- None identified as strictly necessary — the existing roster (Spec Writer, Architecture, UI/UX, User Journey, Test Writer, Coding, Reviewer, Documentation) covered this task's genuine novelty without a missing specialization.

### Memory Bank Architecture Assessment

| Document Type | Created | Utility | Maintenance Burden |
|---------------|---------|---------|--------------------|
| tasks.md | Y (updated) | 5/5 | Low |
| progress.md | Y (5 entries this task) | 5/5 | Low — the phase-by-phase progress entries were detailed enough to reconstruct this reflection's Phase Analysis section largely from progress.md alone |
| creative/*.md | 3 (architecture, uiux, user-journey) | 5/5 | Low — cross-referencing between the two original creative docs and the retroactive journey doc was clean (each explicitly states what's a "fixed input" from the others) |
| uat/*.md | 2 (report + E2E spec) | 5/5 | Low |
| reflection/*.md | Y (this document) | 5/5 | — |
| archive/*.md | Not yet created | — | Next step |

**Knowledge Preservation Quality:**
- Excellent. The Execution State section of `tasks/TASK-005.md` alone (without any session logs) contained enough detail — exact bug descriptions, exact fix descriptions, before/after test counts per phase — to reconstruct a full Phase Analysis and Technical Challenges section for this reflection. This is a strong argument that rich Execution State logging can partially substitute for missing session-log telemetry, though it cannot substitute for actual tool-call counts.

**Cross-Reference Effectiveness:**
- High. The UI/UX creative doc explicitly labels architecture decisions as "fixed inputs... not re-decided here"; the User Journey doc explicitly labels both prior creative docs as "fixed inputs" and states it is "grounding UAT in the actual shipped UI" — this discipline of explicit dependency-declaration between memory-bank documents made navigation unambiguous.

### Ecosystem Scalability Assessment

| Metric | Observation | Impact |
|--------|-------------|--------|
| Context window pressure | Low-Medium | Each creative/build phase's context stayed scoped to its own concern; no evidence of an agent needing to re-derive context that a prior phase had already established |
| Token efficiency | Good | Progressive context loading (Level 4 context files loaded per-phase, not all at once) kept each phase's working set proportional to its actual scope |
| Phase handoff quality | Smooth | Each phase's "Delivers" section maps cleanly to specific ACs, and each build phase's Execution State entry states exactly what the next phase depends on |
| Recovery from errors | Good | Both BLOCK verdicts led to targeted, scoped fixes plus regression tests — no evidence of a fix needing a second round of review |

### Strategic Improvement Recommendations

> **CRITICAL**: These are recommendations only. Do NOT implement changes during reflection. Changes to the Claude Code ecosystem should be handled as separate Level 2-3 tasks.

#### Immediate (High Priority)
| Recommendation | Component | Rationale | Expected Benefit |
|----------------|-----------|-----------|-------------------|
| Add task-indexed session logging (`.agent-logs/claude/by-task/TASK-XXX/`) | Init/logging infrastructure | 5th consecutive task without it; this reflection's Tool Utilization and Sub-Agent Invocation tables are qualitative estimates instead of measured data | Future reflections get real tool-call/sub-agent metrics instead of a caveat |
| Pre-flight UAT prerequisites (uat-config.md, ux-patterns.md, journey doc) during `/banyan-plan` or `/banyan-creative` for Level 2-4 tasks, not only at `/banyan-uat` invocation | Command / phase gates | This task had to create all three inline, immediately before the UAT run, rather than earlier in the cycle | Removes a late-stage scramble; catches the gap when there's still time to plan around it |

#### Short-term (Medium Priority)
| Recommendation | Component | Rationale | Expected Benefit |
|----------------|-----------|-----------|-------------------|
| Add a "long-lived connection / streaming endpoint" build-context checklist (subscribe/read/write/cleanup ordering, cursor/header validation) | Build context files | Both Phase 2 BLOCK findings are exactly this category of bug; a dedicated checklist could shift detection from review-time to write-time | Fewer BLOCK cycles on future streaming features; faster phases |
| Add a "does this schema/infra change require action on already-provisioned environments" prompt to the Architecture creative agent's Risk Assessment step | creative-architecture-agent | REC-1's migration gap was inherited silently from an existing convention (`003_*.sql` only runs on a fresh volume) rather than re-examined for a 4th migration in a maturing project | Surfaces migration/upgrade gaps during design review, not during live UAT |

#### Long-term (Strategic)
| Recommendation | Component | Rationale | Expected Benefit |
|----------------|-----------|-----------|-------------------|
| Consider a lightweight "full UAT fleet vs inline walk" cost/independence trade-off note surfaced explicitly at `/banyan-uat` invocation time (not just documented after the fact in the report) | uat command / uat-synthesizer-agent | This task's UAT was inline-walked by the orchestrator itself for cost control, which is a reasonable call but trades away some evaluative independence from the building agent — worth making that trade-off an explicit, visible choice rather than an after-the-fact note | Clearer expectations about UAT independence per run |

### Patterns Worth Codifying

1. **Atomic "fold prior value into the write" capture**: `UPDATE ... FROM (SELECT <col> AS prev FROM <table> WHERE id = $k) AS old WHERE <table>.id = $k RETURNING ..., old.prev AS previous_<col>` — use whenever a mutation needs to detect and react to "did this specific column actually change" without a race window or an extra round-trip. First used in `cards.repository.ts` `update()`.
2. **Subscribe-before-read, buffer-and-dedupe-by-id**: for any live push + backfill combination, register the live subscription *before* running the backfill/replay read, buffer anything that arrives during that read, then flush the buffer deduped against the last id already written. Prevents both gaps and duplicates at the backfill↔live seam. First used in `activity.routes.ts`.
3. **Decoupled hidden `aria-live` announcer + arming heuristic**: never attach `aria-live` to a visibly-updating list; use a sibling visually-hidden element as the sole announcement channel, and gate "is this a genuinely new event vs. a catch-up frame" behind a quiet-period timer when the wire protocol doesn't distinguish them. First used in `ActivityFeed.tsx` / `useActivityStream.ts`.
4. **Export the raw async handler separately from the router it's mounted on**, specifically to make an otherwise-untestable long-lived connection (SSE, WebSocket) drivable with a mock req/res in tests. First used as `activityStreamHandler` vs `createActivityRouter`.

## References
- Architecture Docs: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`
- Creative Phases: `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`, `memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md`, `memory-bank/creative/TASK-005-realtime-activity-feed-user-journey.md`
- Progress Log: `memory-bank/progress.md`
- UAT Artifacts: `memory-bank/uat/uat-TASK-005.md`, `memory-bank/uat/spec-TASK-005-e2e.md`
- Task Plan / Execution State: `memory-bank/tasks/TASK-005.md`

---

## Extractable Learnings (for Continuous Learning)

1. **connection-lifecycle** (`src/**/*.routes.ts`, SSE/WebSocket/streaming endpoints): Register the disconnect-cleanup handler (`req.on('close')`) before any `await` in the request handler, guarded by an idempotent `closed` flag that gates every subsequent write.
2. **data-access** (`src/**/*.repository.ts`): Fold a "detect the prior value before this write" need into a single atomic statement via a `FROM (SELECT ... ) AS old` subquery rather than a separate SELECT-then-UPDATE, to stay race-free and avoid an extra round-trip.
3. **frontend-patterns** (`frontend/src/hooks/*.ts`, live/streaming UI): Decouple an `aria-live` announcer into its own hidden element, never the visibly-updating list itself, and gate announcements on a genuinely-new-vs-catch-up distinction when the transport can't tell the two apart on the wire.
4. **deployment** (`db/init/*.sql`, docker-compose volumes): Treat every new migration file as a deployment-affecting change, not just a schema change — verify or document what happens on an already-provisioned (non-fresh) volume before shipping.

## Learned Rules Applied

- `api-design.md`: Loaded, partially applicable — the existing "unparseable/out-of-range id → 404" rule informed `parseBoardId`'s design in `activity.routes.ts`, though the activity stream's `board_id` is a query filter (400 on malformed, per the existing `GET /cards?board_id=` convention) rather than a path `:id` (404) — correctly distinguished, not misapplied.
- `data-access.md`: Loaded, directly applicable and extended — the "always parameterize" and "index the FK/filter column" rules held for `card_activity`'s `(board_id, id)` composite index; this task's own atomic-capture pattern (see Extractable Learnings #2) is a natural addition to this file.
- `error-handling.md`: Loaded, directly applicable — the "central error middleware, fail-safe posture" rule generalized cleanly to activity capture's try/catch-log-never-throw wrapper and the SSE stream's fail-safe backfill-read-failure handling.
- `configuration.md`: Loaded, directly applicable — `ACTIVITY_BACKFILL_LIMIT`/`ACTIVITY_HEARTBEAT_MS` followed the existing "env with compose defaults" pattern exactly, no deviation needed.
- `testing-patterns.md`: Loaded, directly applicable — the "inject I/O as dependencies" and "query by role/accessible name" rules held throughout; the DI-based `activityRepo`/`activityEmitter` stubs and the `ActivityFeed.test.tsx` role-based queries are direct applications.
- `frontend-patterns.md`: Loaded, partially applicable — the "single fetch seam, status-union state machine" rule generalized correctly to `activityStream.ts`/`useActivityStream.ts`'s connecting/open/reconnecting/degraded union, though this is the first task to extend that rule from a request/response resource to a long-lived streaming connection, which is a genuinely new sub-case (see Extractable Learning #3, a natural addition to this file).
- `infrastructure.md`: Loaded, **not directly applicable** — this file's one rule concerns Docker-daemon-unavailable verification deferrals, which didn't arise this task; however, the REC-1 migration gap this task surfaced is arguably this file's most natural home for a new rule (Extractable Learning #4), since it's the same "infrastructure/deployment correctness beyond the code" category.

This is the **first task to touch a realtime/SSE transport and an in-process event bus**. The backend-scoped learned rules (data-access, error-handling, configuration, testing-patterns) transferred cleanly because they're expressed at a level of abstraction (parameterize queries, fail-safe fallbacks, env-driven config, inject I/O) that holds regardless of whether the I/O is a request/response query or a long-lived stream. The one genuine gap is connection-lifecycle-specific guidance (subscribe/backfill/cleanup ordering) — no existing learned rule addressed it, and this task's two Phase 2 BLOCK findings are exactly the evidence that such a rule would have value going forward (Extractable Learning #1).

---

**Overall Task Success**: ✅ Success

**Overall Workflow Effectiveness**: ✅ Highly Effective

**Recommendation**: Ready to proceed to `/banyan-archive TASK-005` after completing (or explicitly deferring with a tracked follow-up) Phase 4's E2E test implementation. REC-1 (migration path) and REC-2 (mobile verification) are non-blocking but should be carried forward as tracked follow-ups in the archive, consistent with this project's established pattern of carrying UAT recommendations into archive notes.
