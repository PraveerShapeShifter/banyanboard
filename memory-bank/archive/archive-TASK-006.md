# Archive: Card Workflow Automation

## Metadata
- **Task ID**: TASK-006
- **Complexity**: Level 3 (inherited from FEAT-006)
- **Started**: 2026-07-15
- **Completed**: 2026-07-16
- **Roadmap Link**: FEAT-006
- **Branch**: feature/FEAT-006-card-workflow-automation
- **Archive Strategy**: local-merge → `main`
- **Final Commit (pre-merge)**: 9c9cf1b (reflection) + archive commit (this archive)

## Summary

Rule-based **workflow automation** for cards. A board owner defines `condition → target_status`
automation rules scoped to a board; a synchronous evaluation engine runs inside the existing
`PATCH /cards/:id` path and auto-moves a card when a rule's condition matches, reusing the
FEAT-005 activity-capture hook so automated moves surface in the realtime feed
(distinguishable from manual moves via `triggered_by`/`rule_id`). A **mid-task product
addition (2026-07-15)** extended scope with **optional asynchronous webhook delivery**
(bounded retry, delivery status tracked separately from trigger-execution status) and a
**Board → Automation UI** in the existing React frontend — a deliberate reversal of the
original "no rule-builder UI" boundary, absorbed by reopening creative and restructuring
into four phases without reworking completed work.

## Requirements

### Original Requirements (FEAT-006)
- Board-scoped automation rules: create, list, update, delete, each with a condition and a target-status action
- Auto-move a card to the target status when a rule's condition is satisfied on a card state change
- Evaluation engine guarded against infinite loops / cyclic rules (bounded, terminating pass)
- Automated moves recorded in the FEAT-005 activity feed, distinguishable from manual moves
- Invalid rule definitions rejected with clear validation errors (400)
- Automated test coverage (matched / not-matched / loop-prevention / disabled-rule no-op)

### Product Addition (2026-07-15)
- A firing trigger may optionally POST a JSON payload to a `webhook_url`, retrying up to 3 times, with delivery status tracked **separately** from trigger-execution status
- A Board Settings → Automation UI lets a board owner create/list/toggle/delete rules and view execution + delivery history

### Success Criteria — all met ✅
- [✓] AC-ENTRY-1 — discover a board's rules via `GET /rules?board_id=`
- [✓] AC-HAPPY-1 — full rule CRUD (201/200/200/204 + 404 after delete)
- [✓] AC-HAPPY-2 — satisfied condition auto-moves the card; PATCH response reflects final status; `triggered_by:'rule'` activity row
- [✓] AC-HAPPY-3 — webhook-bearing firing delivers a JSON payload + records the delivery (sync `pending` row, async POST)
- [✓] AC-ERROR-1 — cyclic/runaway chains bounded (visited-status Set + `MAX_HOPS`), logged, still 200
- [✓] AC-ERROR-2 — coded `{code,message,details}` validation errors (`INVALID_RULE`/`BOARD_NOT_FOUND`/`RULE_NOT_FOUND`)
- [✓] AC-ERROR-3 — engine failures fail-safe; the originating card write still succeeds
- [✓] AC-ERROR-4 — webhook non-2xx/timeout/exhaustion coded, retried (3 attempts), fail-safe
- [✓] AC-ASYNC-1 — automated move visible in the realtime feed, distinguishable from manual
- [✓] AC-ASYNC-2 — multi-hop moves expose each intermediate state; no rollback
- [✓] AC-ASYNC-3 — delivery lifecycle `pending → delivered | failed → exhausted`, separate from trigger status

## Implementation

### Approach
Four phases, each committed to the feature branch after per-phase verification:
1. **Phase 1 — Data model + CRUD API** (7a8cad4): migrations `004_automation_rules.sql` / `005_workflow_webhooks.sql`, `src/rules/` module (types/validation/repository/routes), `src/webhooks/` read routes.
2. **Phase 2 — Engine + PATCH integration** (cb4290f): `CardRuleEngine` (visited-status Set, `MAX_HOPS=3`, first-match-wins, fail-safe), per-hop `trigger_executions` + `triggered_by`/`rule_id` activity tagging, `NoopWebhookDispatcher` seam.
3. **Phase 3 — Webhook delivery + retry** (2ae9c11): `HttpWebhookDispatcher` (fetch + `AbortController`, 3 attempts, 30s backoff, coded errors, fully fail-safe), env config, wired into the engine.
4. **Phase 4 — Automation UI** (20facf3): route `/boards/:id/automation`, mutation seam in `api/client.ts`, `RuleForm` (coded-error mapping), `role="switch"` optimistic toggle, `role="alertdialog"` `ConfirmDialog`, master-detail execution/delivery history with delivery badges.

### Key Components
1. **`src/rules/`** — rule persistence + CRUD API
   - Files: `rules.types.ts`, `rules.validation.ts`, `rules.repository.ts`, `rules.routes.ts`, `rules.engine.ts`
   - Purpose: board-scoped rule CRUD (coded error envelope, FK-existence check) + the synchronous, bounded, fail-safe evaluation engine invoked from `PATCH /cards/:id`.
2. **`src/webhooks/`** — trigger-execution log + async delivery
   - Files: `webhooks.types.ts`, `webhooks.repository.ts` (combined `WebhooksRepository`), `webhooks.dispatcher.ts` (`HttpWebhookDispatcher`), `webhooks.routes.ts` (read-only)
   - Purpose: `trigger_executions` + `webhook_deliveries` persistence, fire-and-forget off-path delivery with the DB row as source of truth, and `GET /trigger-executions` / `GET /webhook-deliveries` reads.
3. **`db/init/004_*.sql` / `005_*.sql`** — `automation_rules` (+ `card_activity` `triggered_by`/`rule_id` ALTER), `trigger_executions`, `webhook_deliveries`.
4. **`frontend/src/pages/AutomationPage/`** — the Automation UI (RuleForm, RuleList/RuleListItem, HistoryView, DeliveryStatusBadge, TriggerExecutionItem) + `hooks/useRules.ts`, `api/rules.ts`/`api/webhooks.ts`, and the `mutateJson`/`CodedError` mutation seam added to `api/client.ts`.
5. **Integration** — `src/cards/cards.routes.ts` invokes the injected `ruleEngine` after the FEAT-005 capture block; `src/app.ts`/`src/server.ts` mount and wire the new routers/repos/dispatcher.

### Design Decisions (frozen in creative)
- **Condition storage**: normalized `condition_field/operator/value` columns (JSONB rejected); wire shape `condition: {field, operator, value}` via `toRule()`.
- **Evaluation**: synchronous in the PATCH cycle; response reflects final post-automation status.
- **Cycle detection**: visited-status `Set` + `MAX_HOPS = CARD_STATUSES.length = 3`; first-match-wins by lowest `id`; self-loop rejected at validation.
- **Webhook async mechanism**: fire-and-forget `WebhookDispatcher.dispatch()` (returns void); DB row source of truth; `setTimeout(30s).unref()` retries off-path; 3 total attempts (t=0/30s/60s); `AbortController` 5s timeout; payload built once (byte-stable), at-least-once delivery.
- **Storage**: `payload TEXT NOT NULL`. **SSRF**: absolute `http(s)` only — private/loopback/metadata **not** blocked (documented accepted risk, internal-MVP). **Restart durability**: in-flight retry timers lost on restart (accepted; re-drive provisioned via `findNonTerminalDeliveries` + status index, not built).
- **Config**: new env vars `WEBHOOK_TIMEOUT_MS=5000`, `WEBHOOK_MAX_ATTEMPTS=3`, `WEBHOOK_RETRY_BACKOFF_MS=30000`.
- **Error contract**: `/rules` deliberately introduces a coded `{code,message,details:[{field,error}]}` envelope diverging from the codebase's `{error,details}` — intentional, flagged "do not homogenize" in the spec.

References: `memory-bank/creative/TASK-006-card-workflow-automation-architecture.md`, `-algorithm.md`, `TASK-006-webhook-architecture.md`, `TASK-006-webhook-retry-algorithm.md`, `TASK-006-automation-ui-uiux.md`.

## Testing
- **Backend**: 216/216 tests passing; `tsc` clean. New suites: `rules.validation`, `rules.repository`, `rules.routes`, `rules.engine`, `webhooks.repository`, `webhooks.routes`, `webhooks.dispatcher` (stubbed `fetch` + fake timers); extended `cards.routes`, `activity.repository`, `app` tests.
- **Frontend**: 100/100 tests passing; `tsc --noEmit` clean; `vite build` OK. New suites: `RuleForm`, `RuleList`, `HistoryView`, `ConfirmDialog`, `useRules`, `rules`/`rulesValidation`.
- **Totals**: 316 tests, zero regressions across all four phases.
- All tests passing: ✅ (no live DB, no real network — `pg` and `fetch` stubbed).

## Files Changed
70 files, +10,265 / −25 lines. Highlights:
- **Backend new**: `src/rules/*` (7), `src/webhooks/*` (7), `db/init/004_*.sql`, `db/init/005_*.sql`, `src/config/env.ts` (webhook vars)
- **Backend modified**: `src/cards/cards.routes.ts` (engine hook), `src/activity/*` (`triggered_by`/`rule_id`), `src/app.ts`, `src/server.ts`
- **Frontend new**: `frontend/src/pages/AutomationPage/*` (11), `hooks/useRules.ts`, `api/rules.ts`/`api/webhooks.ts`, `components/ConfirmDialog.tsx`, `automationLabels.ts`
- **Frontend modified**: `api/client.ts` (mutation seam), `api/types.ts`, `routes.tsx`, `BoardViewPage/BoardHeader.tsx`, `BoardViewPage.tsx`
- **Memory bank**: 5 creative docs, reflection, tasks/registry/progress/roadmap/systemPatterns/learning updates

## Lessons Learned
- **Per-phase creative gating survives mid-task scope reversals**: reopening creative for the webhook+UI addition (after original creative had frozen) and restructuring into 4 phases avoided reworking completed phases — worth formalizing as the documented recovery procedure for scope changes.
- **Embed "do not homogenize" next to an intentionally divergent AC in the spec** — reliably prevented a later agent from "correcting" the coded error envelope.
- **Fail-safe async dispatch**: fire-and-forget with a synchronously-created DB row as source of truth, `.unref()` timers, and a logging call that itself cannot throw — keeps a slow/unreachable webhook entirely off the p95 latency budget.
- **Derive traversal bounds from enum cardinality** (`MAX_HOPS = STATUSES.length`) rather than magic numbers, so the bound self-updates with the domain model.
- **SSRF for user-supplied outbound URLs is a mandatory documented decision**, recorded where the validation lives (accepted risk here, not a silent gap).

Reference: `memory-bank/reflection/reflection-TASK-006.md`

## References
- Reflection: `memory-bank/reflection/reflection-TASK-006.md`
- Creative: `memory-bank/creative/TASK-006-*.md` (5 docs)
- Task/plan: `memory-bank/tasks/TASK-006.md`
- Progress: `memory-bank/progress.md`

## Follow-up
1. **`trigger_executions.status='failed'` path is code-unreachable** — the engine early-returns before `recordExecution` on failure; produce the `'failed'` status on engine failure and add coverage (latent gap, not a defect).
2. **Webhook restart durability** — `findNonTerminalDeliveries` + status index are provisioned but the startup re-drive sweep is not built; in-flight retries are lost on process restart (accepted MVP limitation).
3. **SSRF hardening** — revisit private/loopback/metadata blocking (or an allowlist) if the surface is ever exposed beyond internal-trusted users.
4. **Session-log task-indexing gap** — `.agent-logs/claude/by-task/TASK-006/` absent (5th consecutive task); escalate to a `/banyan-init`/`/banyan-upgrade` fix so Build Session Analysis becomes groundable.
5. **API-wide coded-error rollout** — a future feature could roll the `{code,message,details}` envelope out across boards/cards/activity for consistency.
6. **Live verification** — human `docker compose up` + real-DB round-trip of rule CRUD, an auto-move, and a webhook delivery against a running endpoint (tests stub DB + network).
