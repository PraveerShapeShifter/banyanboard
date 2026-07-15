# Reflection: Card Workflow Automation

## Task ID
TASK-006

## Complexity Level
Level 3 (inherited from FEAT-006)

**Ratings**
- **Task Implementation Quality**: Excellent
- **Claude Code Ecosystem Effectiveness**: Highly Effective (with one persistent, high-signal gap — see Ecosystem Improvement Suggestions)

---

## Summary

TASK-006 added rule-based workflow automation to the board/card system: board-scoped
`automation_rules` that auto-move a card to a target status when a condition is
satisfied, evaluated synchronously inside the existing `PATCH /cards/:id` path, with
bounded cycle protection and full activity-feed integration (FEAT-005 reuse). Mid-task
(2026-07-15), the product scope was extended to add **optional asynchronous webhook
delivery** (bounded retry, delivery status tracked separately from trigger-execution
status) and a **Board Settings → Automation tab** UI — reversing the original task
description's explicit "no rule-builder UI" boundary. This is a genuinely unusual
build: a Level 3 task that had already completed its original creative phase, was
handed a scope addition that reopened creative for two *new* sub-domains (an
outbound-webhook dispatch mechanism the codebase had zero precedent for, and a first
mutation-capable UI in a previously read-only frontend), and absorbed both without
discarding or contradicting the already-frozen auto-move decisions.

All 10 acceptance criteria (AC-ENTRY-1; AC-HAPPY-1/2/3; AC-ERROR-1/2/3/4;
AC-ASYNC-1/2/3) were implemented across 4 build phases, each gated on its
corresponding creative decision (Phases 1-2 on the original auto-move creative,
Phases 3-4 on the reopened webhook/UI creative). The build closed at **216/216
backend tests** (`tsc` clean) and **100/100 frontend tests** (`tsc --noEmit` clean,
`vite build` OK), with zero live-DB/live-network dependence in any test (`pg` and
`fetch` both stubbed). Every deferred item — SSRF hardening scope, restart
durability, the unproduced `trigger_executions.status='failed'` path — is explicitly
named in the task file's Execution State rather than silently absent, which is the
strongest signal of implementation discipline in this task.

On the ecosystem side, the mid-task scope reversal is the most interesting data
point of this reflection: the workflow's "gate build on frozen creative" mechanism
handled a genuine feature pivot cleanly, precisely because the task file's Frozen
Decisions sections are additive and phase-scoped rather than a single monolithic
document that would need renegotiating. The recurring gap is unchanged from the
last four reflections: `.agent-logs/claude/by-task/TASK-006/` does not exist, so
build-session tool/sub-agent metrics remain unavailable for the fifth consecutive
task.

## Plan vs Reality

- **Original estimate**: ~30 tests, 2 build phases (Rules CRUD, Engine), no
  frontend, no webhook — the original spec explicitly excluded a rule-management UI.
- **Actual**: ~55 target tests (per the revised Test Strategy) → **316 actual**
  (216 backend + 100 frontend), 4 build phases, 5 creative documents (not 2), two
  new backend modules (`src/rules/`, `src/webhooks/`), two new DB tables beyond the
  originally-planned `automation_rules` (`trigger_executions`, `webhook_deliveries`),
  and a full new frontend page (`AutomationPage/` — RuleForm, RuleList, HistoryView,
  a hand-rolled `ConfirmDialog`, a new `useRules` hook, and the first **mutation**
  seam added to a previously GET-only `frontend/src/api/client.ts`).
- **Deviations and why**: The single deviation driver was the 2026-07-15 product
  addition (documented inline in the task file, not an emergent surprise mid-build).
  It roughly doubled the surface area: webhook dispatch state machine + two new
  tables + two new read endpoints + a UI panel, on top of the already-planned
  auto-move core. The workflow response was to **restructure** the roadmap into 4
  phases (old Phase 1→new Phase 1, old Phase 2→new Phase 2 folding in the former
  "Phase 3 — activity distinguishability," new Phase 3 = webhook delivery, new
  Phase 4 = UI) rather than bolt the addition on as an ungated Phase 5 — this kept
  every phase gated on a specific creative decision instead of building ahead of an
  open design question.

## What Went Well

### Technical
- The **frozen-decision sections** in the task file (`Frozen Creative Decisions`,
  `Frozen Webhook + UI Decisions`) functioned as an unambiguous, phase-by-phase
  contract. Cross-checking the git commits against those sections shows *zero*
  drift: `MAX_HOPS = CARD_STATUSES.length = 3`, visited-status `Set`,
  first-match-wins by `id ASC`, `WEBHOOK_MAX_ATTEMPTS=3` at t=0/30s/60s,
  `AbortController` 5s timeout, `payload TEXT` (not JSONB) — every one of these
  landed in the code exactly as frozen, including the more obscure ones (cycle
  trip happens *before* applying the looping hop, specifically so no spurious
  activity row is written — visible verbatim in `rules.engine.ts` lines 100-113).
- **Fail-safe posture was applied consistently, not just at the top level.**
  `CardRuleEngine.evaluate()` never throws (three separate catch sites: rules read,
  per-hop persistence, defensive ceiling); `HttpWebhookDispatcher.deliver()` wraps
  its own logger call in a second try/catch (`logDispatchError`) so "even a broken
  logger must not escape the dispatcher" — a level of defensive rigor beyond what
  the AC strictly required.
- **The Phase 1 "note for Phase 2/3" convention** (task file Execution State: exact
  `WebhooksRepository` method names — `recordExecution`, `createDelivery`,
  `markDelivered`/`markFailed`/`markExhausted`, `findNonTerminalDeliveries`) meant
  Phase 2 and Phase 3 build agents consumed the Phase 1 interface with zero
  renegotiation or refactor — confirmed by `grep`ing those exact names into
  `rules.engine.ts` and `webhooks.dispatcher.ts`.
- Reuse discipline: the FEAT-005 `ActivityEmitter`/activity-capture idiom was
  mirrored (not reinvented) for the new `RuleEngine` and `WebhookDispatcher` seams,
  and the frontend Phase 4 mirrored `useActivityStream`'s discipline in the new
  `useRules` hook — both explicitly called out in the frozen decisions and verified
  in the delivered code.
- Zero regressions across 4 phases (181→203→216 backend; 0→100 frontend, all
  additive) despite touching a shared hot path (`PATCH /cards/:id`).

### Process
- The task file's mid-task amendment (`> **Product addition (2026-07-15).**`)
  was written as a structured diff against the original spec — what changed, what
  it reverses, what it reopens — rather than a silent rewrite. This made the
  roadmap restructuring (below) auditable after the fact.
- The Implementation Roadmap explicitly preserved lineage ("the original three
  auto-move phases are preserved, not removed — the old 'Phase 1 Rules CRUD' and
  'Phase 2 Engine' map onto the new Phases 1-2 ... folded into the new Phase 2")
  instead of quietly renumbering with no trace of the prior plan.
- Risk tracking in the spec (`### Dependencies & Risks`) was kept live across the
  addition — RESOLVED risks (JSONB, match-ambiguity) stayed marked resolved, and
  the new webhook/SSRF/UI risks were appended with their own mitigation column,
  rather than merging into one undifferentiated risk list.

## Challenges Encountered

### Challenge 1 — A Level 3 task reopening creative after completion
- **Description**: Creative had already run once (architecture + algorithm for the
  auto-move core) and been frozen before the product addition landed. The addition
  needed *new* creative for a domain the codebase had literally no precedent for
  (no queue/scheduler/outbound-HTTP-client pattern anywhere in-repo) plus a UI/UX
  creative for the first mutation-capable frontend page.
- **Resolution**: Rather than reopening the *original* two creative docs, the
  workflow spawned three *additional* creative sub-phases (webhook architecture,
  webhook retry algorithm, automation UI/UX) and phase-gated only Phases 3-4 on
  them, leaving Phases 1-2 gated on the already-complete original creative. This
  is visible directly in the commit sequence: `b1468de` (freeze webhook+UI
  creative) landed *before* `7a8cad4` (Phase 1 build), even though Phase 1 didn't
  need the new creative — the gate was evaluated per-phase, not per-task.
- **Prevention**: This pattern (freeze incremental creative before the phase that
  needs it, not before the whole task) worked because the roadmap was restructured
  to declare per-phase creative dependencies explicitly. Future tasks with
  anticipated scope growth should structure phases with the same granularity from
  the start, even if the addition hasn't landed yet.

### Challenge 2 — Introducing an intentionally incompatible error envelope
- **Description**: The rules module needed a new coded `{code, message, details}`
  error shape that deliberately diverges from the existing `{error, details}` shape
  used by `boards`/`cards`/`activity`. A build agent (or a code reviewer) could
  plausibly "fix" this as an inconsistency.
- **Resolution**: The spec pre-empted this with an explicit, bolded warning
  ("Build agents: this mismatch is intentional — do not 'fix' the rules error body
  to match cards") plus a full Error Code Catalog table. Verified in
  `rules.validation.ts`/`rules.routes.ts` — the coded envelope is used consistently
  and was not homogenized with the legacy shape.
- **Prevention**: This "pre-empt the obvious wrong instinct in the spec itself"
  technique is worth generalizing — see Extractable Learnings.

### Challenge 3 — Async delivery status vs. distinguishable execution status
- **Description**: `trigger_executions.status` (did the auto-move apply) and
  `webhook_deliveries.status` (did the POST succeed) had to be tracked as two
  fully independent state machines so a card could be `executed` while its webhook
  is still `pending`/`failed`/`exhausted` (AC-ASYNC-3).
- **Resolution**: Delivered as designed — `recordExecution` is called
  unconditionally per hop with `status: 'executed'`, and the webhook lifecycle is
  entirely owned by `HttpWebhookDispatcher`/`webhooks_deliveries`, with no code
  path that lets a delivery outcome mutate `trigger_executions.status`.
- **Residual gap (not fully resolved, documented)**: the engine never produces
  `trigger_executions.status = 'failed'` — every recorded execution is
  `'executed'` because a hop that fails to persist returns early *before* calling
  `recordExecution` at all (see `rules.engine.ts` lines 118-129, 183-194). The
  column and CHECK constraint exist; the code path that would populate `'failed'`
  does not. This is called out explicitly in the task file's Execution State as a
  documented deferral, which is the correct posture, but it does mean the
  `trigger_executions` table's own error-state semantics are currently unreachable
  in practice.

## Creative Decision Assessment

### Architecture Design (auto-move core)
- **Decision**: Normalized `condition_field`/`condition_operator`/`condition_value`
  columns (not JSONB), synchronous in-request evaluation, `CardRuleEngine` as an
  injected seam mirroring `ActivityEmitter`.
- **Outcome**: Held up completely. `rules.types.ts`/`rules.repository.ts` expose
  the normalized columns via a `toRule()`-style nested `condition: {field,
  operator, value}` projection on the wire, and the engine is constructed exactly
  as an injected `AppDeps` member, threaded into `createCardsRouter` per the spec.
- **Verdict**: Good. The rejection of JSONB (avoiding a precedent-setting first use)
  proved right in hindsight — it made the later `webhook_deliveries.payload TEXT`
  decision (Frozen Webhook Decisions) a straightforward "same posture, no new
  precedent" call rather than a fresh debate.

### Algorithm Design (loop prevention)
- **Decision**: Visited-status `Set<CardStatus>` + `MAX_HOPS = 3` (derived from
  `CARD_STATUSES.length`), first-match-wins by lowest `id`, self-loop rejected at
  validation time.
- **Outcome**: Implemented with an extra defensive layer not strictly demanded by
  the algorithm doc — a belt-and-suspenders ceiling check after the loop
  (`rules.engine.ts` lines 197-207) that is explicitly commented as "dead code in
  the 3-status model," guarding against a future model change silently breaking
  the invariant.
- **Verdict**: Good. Tying `MAX_HOPS` to the status-enum length rather than a bare
  magic number is a durable choice — if a 4th status is ever added, the bound
  self-updates and stays provably correct without a design review.

### Webhook Architecture Design (product addition)
- **Decision**: Fire-and-forget `WebhookDispatcher.dispatch()` (returns `void`),
  `pending` row created synchronously, POST + retries off-path; DB row is source
  of truth; new `src/webhooks/` module; `payload TEXT`; restart durability
  accepted as a documented MVP gap (re-drive provisioned via
  `findNonTerminalDeliveries` + a status index but not built); SSRF accepted-risk
  (http(s)-only, no private/loopback blocking).
- **Outcome**: Held up completely — verified directly in
  `webhooks.dispatcher.ts`: `dispatch()` is synchronous up to the DB insert and
  then `void`s the async chain; `pendingRetries`/`payloads` are in-memory Maps
  (confirming the "lost on restart" limitation is real, not just documented);
  `.unref()` is applied to every scheduled timer exactly as frozen.
- **Verdict**: Good, with one open question for a future task: `findNonTerminalDeliveries` was provisioned specifically to enable a startup re-drive sweep, and that capability sits unused. Provisioning it now (index + query) without a consumer is defensible engineering discipline, but it should be tracked as technical debt, not forgotten.

### Webhook Retry Algorithm Design (product addition)
- **Decision**: Re-entrant `deliver(deliveryId)`, one `fetch` per call, 2xx →
  `delivered`, failure with attempts remaining → `failed` + 30s retry, 3rd failed
  attempt → `exhausted`; `AbortController` 5s timeout; byte-stable payload
  (`occurred_at` frozen at first serialization) for at-least-once delivery with
  receiver-side dedupe expected.
- **Outcome**: Held up completely, including two subtle correctness details:
  `deliver()` re-reads the row first and no-ops on an already-terminal status
  (idempotent against a duplicate timer fire), and `attempt = row.attempts + 1` is
  computed from the persisted count rather than an in-memory counter, so the state
  machine survives being called from a fresh `setTimeout` closure with no shared
  mutable state beyond the DB row itself.
- **Verdict**: Good. The "re-read + no-op on terminal" idempotency guard is exactly
  the kind of thing that's easy to skip under time pressure and easy to regret
  later; its presence here is a genuine quality signal.

### Automation-tab UI/UX Design (product addition)
- **Decision**: Route `/boards/:id/automation`; a new mutation seam
  (`CodedError`/`MutationResult<T>`/`mutateJson`) added to the previously GET-only
  `api/client.ts`; `RuleForm` maps server `INVALID_RULE` `details[].field` to
  inline field errors; `role="switch"` optimistic toggle with rollback; hand-rolled
  `role="alertdialog"` `ConfirmDialog` (explicitly not `window.confirm`);
  master-detail history view, manual Refresh (no delivery SSE); `useRules` mirrors
  `useActivityStream`'s discipline.
- **Outcome**: Held up completely per the Phase 4 commit — `ConfirmDialog.tsx`
  (114 lines + 150-line test file) and the optimistic-toggle-with-rollback in
  `RuleListItem`/`useRules` are both present, and the server-error-to-inline-field
  mapping is a dedicated code path in `RuleForm.tsx`, not an afterthought.
- **Verdict**: Good. Extending the fetch-seam discipline from a read-only client
  to a mutation-capable one, without introducing a second parallel HTTP mechanism,
  is the single most reusable pattern out of this task's five creative decisions.

## Lessons Learned

### Technical
- Deriving a hard bound from an existing enum's cardinality (`MAX_HOPS =
  CARD_STATUSES.length`) is more durable than a bare magic-number constant — it
  stays provably correct as the domain model grows, with no separate design review
  needed.
- A fire-and-forget async seam is only as safe as its "never throws or rejects
  out" guarantee at *every* layer, including the logger call itself — the
  `logDispatchError`'s own try/catch in `HttpWebhookDispatcher` is a small detail
  that closes an otherwise-real crash path (a broken structured logger call could
  otherwise reject inside an unawaited promise chain).
- Re-reading a durable row before acting on it (rather than trusting an in-memory
  counter across a `setTimeout` boundary) is what makes a re-entrant retry state
  machine safe against duplicate timer fires and eventual restart-driven re-drives
  — the DB row, not the closure, is the actual source of truth.

### Process
- Restructuring an in-progress Level 3 roadmap into a different phase count (2 →
  4) mid-task is manageable *if* the roadmap document explicitly states the
  mapping from old phases to new phases — this task's roadmap did that
  ("old 'Phase 1 Rules CRUD' ... maps onto the new Phases 1-2") and it made the
  restructuring auditable rather than a silent rewrite.
- Putting an explicit "build agents: do not fix this" warning directly in the spec
  next to an intentionally-unusual pattern (the divergent error envelope) appears
  to have worked — the delivered code did not attempt to homogenize the two error
  shapes.

## Recommendations

- Track the unused `findNonTerminalDeliveries` capability (provisioned for a
  startup re-drive sweep, not yet wired to anything) as an explicit technical-debt
  item so it does not silently rot; a future feature (or the same feature's
  hardening pass) should either wire it into server startup or document why it
  remains dormant.
- Before considering this feature "done" for production, resolve the two
  documented-but-open risk items together in one follow-up: (a) SSRF
  private/loopback blocking, and (b) webhook restart durability — both were
  explicitly deferred to "MVP acceptable," and both are the kind of risk that
  compounds if left open past a second iteration.
- Update `memory-bank/roadmap.md`'s FEAT-006 AC list to include the two
  product-addition ACs (webhook delivery, Automation tab) — the task file itself
  flags this as not yet done ("these two product-addition ACs are not yet
  reflected in `memory-bank/roadmap.md`'s FEAT-006 entry").
- Consider a lightweight regression test (or at least a documented manual check)
  that exercises the `trigger_executions.status = 'failed'` path once a real
  scenario can produce it — right now the column/CHECK constraint exists but no
  code path populates it, which is a latent test-coverage gap that current tests
  cannot catch because the behavior itself doesn't exist yet.

---

## Claude Code Ecosystem Evaluation

### Commands Assessment

| Command | Used | Effectiveness | Notes |
|---------|------|---------------|-------|
| `/banyan-roadmap feature create` | Y | High | FEAT-006 created with Level 3 complexity, inherited correctly by TASK-006 |
| `/banyan-plan` | Y | High | Spec Writer (per model-selection strategy) produced a 10-AC spec with an explicit Error Code Catalog and per-AC test-strategy mapping; taxonomy audit added AC-ERROR-3/AC-ASYNC-2 |
| `/banyan-creative` | Y (×5 sub-phases) | High | 2 original (architecture, algorithm) + 3 reopened (webhook architecture, webhook retry algorithm, UI/UX) — all 5 froze cleanly with zero contradiction against each other or the original two |
| `/banyan-build` | Y (×4 phases) | High | Each phase built exactly against its frozen decisions; test counts climbed 181→203→216 backend, 0→100 frontend, additive with no regressions |
| `/banyan-reflect` | Y (this document) | High | — |

### Workflow Assessment
- **Phase Progression**: Smooth, including the mid-task restructuring. The
  transition from "2 planned phases" to "4 restructured phases" happened at a
  clean boundary (a dedicated freeze commit, `b1468de`, before any Phase-3/4 code
  was touched) rather than bleeding into an in-flight build phase.
- **Unnecessary Phases**: None. All 4 phases map to distinct, non-overlapping AC
  groups.
- **Missing Phases**: None for this task's scope. A natural *next* task (not
  missing from this one) would be a hardening pass for the two open risk items
  (SSRF range-blocking, restart-durability re-drive).

### Context Files Assessment
- **Helpful Files**: The task file's own `Frozen Creative Decisions` / `Frozen
  Webhook + UI Decisions` sections functioned as the de facto context file for
  every build phase — more load-bearing than any generic context doc, because
  they were task-specific and phase-scoped. `systemPatterns.md`'s existing
  Testing Patterns section (integration-first via Supertest, no live DB) was
  correctly inherited into the Test Strategy without needing to be restated.
- **Gaps Identified**: There is no standing context-file guidance for
  "introducing an intentionally divergent cross-cutting contract" (the coded
  error envelope). This task worked around the gap by putting the warning
  directly in the spec, which worked, but a reusable context-file pattern for
  "how to introduce a deliberate inconsistency without it getting silently
  homogenized by a later agent" would generalize beyond this one task.
- **Outdated Content**: None encountered.

### Tools Assessment

| Tool | Usage | Effectiveness | Limitations |
|------|-------|---------------|-------------|
| Read | High | High | Used extensively to cross-check frozen decisions against delivered code across 5 creative docs + 4 phase commits |
| Grep | Medium | High | Effective for verifying exact method-name threading (`recordExecution`, `markDelivered`, etc.) between Phase 1's repository and Phase 2/3's consumers |
| Bash (git log/show) | High | High | `git show --stat <sha>` per phase commit was the single most reliable source of "what actually got built," more reliable than progress.md (which had no TASK-006 entries yet at reflection time) |
| Glob | Low | High (negative result correctly obtained) | Confirmed absence of `.agent-logs/claude/by-task/TASK-006/` cleanly |
| Task (sub-agent spawn) | N/A this session | — | Not used directly by the reflection agent; the 5 creative sub-agents were spawned by `/banyan-creative`, not observable from this reflection's own tool calls |

### Subagent Assessment
- **Agents Used**: `creative-architecture-agent` (×2 — auto-move + webhook),
  `creative-algorithm-agent` (×2 — auto-move + webhook retry),
  `creative-uiux-agent` (×1 — Automation tab); build-phase agents (coding,
  test-writer/runner, code-reviewer, documentation) per the standard
  `/banyan-build` sub-agent architecture.
- **Prompt Quality**: High, judged by output consistency — five independently
  spawned creative agents (across two separate `/banyan-creative` invocations
  separated by a scope-reversal event) produced decisions that compose without
  contradiction (e.g., the webhook architecture agent correctly re-used the
  "reject JSONB" precedent set by the *original* architecture agent rather than
  re-litigating it).
- **Output Quality**: High. Every frozen decision I could verify against the
  delivered code (11 distinct decisions checked across 5 docs) matched exactly,
  including subtle implementation details (cycle-trip-before-apply, re-entrant
  deliver() re-reading the row, `.unref()` on timers).
- **Improvements Needed**: None specific to this task's sub-agent performance.
  The one systemic gap (below) is tooling/observability, not agent quality.

### Memory Bank Assessment
- **File Structure**: Adequate — 5 creative docs prefixed consistently
  (`TASK-006-card-workflow-automation-architecture.md`,
  `TASK-006-webhook-architecture.md`, etc.) made it straightforward to map each
  doc to its corresponding Frozen Decisions section in the task file.
- **Template Usefulness**: The Level 3 task-file template's separation of
  "Creative Exploration Needed" (open questions) from "Frozen Creative Decisions"
  (resolved) worked well for a task that had *both* categories simultaneously
  live for a period (auto-move resolved, webhook/UI still open) — the template
  did not force a false choice between "planning" and "built" states.
- **Missing Documents**: `progress.md` had zero TASK-006 entries at the time of
  this reflection (its most recent entries are TASK-005's archive) — the
  chronological narrative for TASK-006 currently exists only in the task file's
  Execution State and the git commit messages. This is a documentation gap for
  future archaeology (a future task or human skimming `progress.md` alone would
  not see TASK-006 at all until `/banyan-archive` back-fills it).

### Ecosystem Improvement Suggestions

> These are suggestions only. No changes were implemented during this reflection.

#### High Priority
1. **Task-index session logs at the source, not as a post-hoc reflection
   workaround** — `.agent-logs/claude/by-task/TASK-006/` does not exist, exactly
   as with TASK-002, TASK-003, TASK-004, and TASK-005. This is now a
   **five-for-five** pattern, not an isolated miss. The reflection methodology's
   own fallback instructions ("scan date-partitioned logs... note the gap") have
   never actually been exercised in five tasks because the guidance in this run
   was to skip even that fallback — meaning tool-utilization counts, sub-agent
   invocation counts, and error-recovery counts have been **structurally
   unavailable for the Build Session Analysis section in every reflection this
   project has produced.** Given the recurrence, the likely fix is not a per-task
   reminder but a change to whatever mechanism is supposed to populate
   `by-task/` (a hook on session start/end keyed by the active `TASK-XXX`, most
   likely) so it activates automatically rather than depending on each project
   remembering to run an upgrade step.
2. **Add a context-file pattern for "deliberately introducing a divergent
   cross-cutting contract."** This task's coded-error-envelope decision worked
   only because the spec author thought to add an explicit "do not fix this"
   warning. A reusable checklist (when is divergence acceptable vs. when should
   a new module conform to an existing one; how to flag it durably enough that a
   later, unrelated task doesn't quietly "fix" the inconsistency) would reduce
   reliance on one spec author's judgment call generalizing correctly every time.

#### Medium Priority
1. **Auto-backfill `progress.md` per build phase, not only at `/banyan-archive`.**
   TASK-001 through TASK-005 all show per-phase `progress.md` entries written
   *during* the build (per the log excerpts read for this reflection); TASK-006
   currently has none, meaning its `/banyan-build` phases did not add
   `progress.md` entries the way earlier tasks' phases did. If this is a real
   process drift (not an artifact of this reflection running before archive),
   it is worth confirming whether the Documentation sub-agent's
   `progress.md`-append step is being invoked consistently across builds.
2. **Provide a standard "provisioned but not wired" tracking mechanism.** This
   task deliberately built `findNonTerminalDeliveries` + a supporting index for a
   future restart-durability sweep, without wiring a consumer. That is
   reasonable engineering, but there is no memory-bank convention for flagging
   "this capability exists in code, unused, waiting on a future task" distinct
   from ordinary technical debt — it currently lives only as a sentence in the
   Execution State's `Deferred / accepted` list, which is easy to lose track of
   once the task is archived.

#### Low Priority
1. **Cross-link creative docs to their consuming phase commit.** The 5 creative
   docs and the 4 phase commits currently correlate only by reading both and
   matching content by hand (as done for this reflection). A one-line backlink
   (e.g., a "Consumed by: commit `cb4290f`" footer added post-build) would make
   future audits of "did the frozen decision actually land" faster without
   requiring a full re-read.

---

## Key Learnings

### Extractable Learnings (for Continuous Learning)

1. - **async-dispatch** (`src/webhooks/*.ts`, off-request-path handlers): Make outbound dispatch fire-and-forget with a synchronously-created DB row as the durable source of truth, `.unref()` every retry timer, and guarantee even the dispatcher's own logging call cannot throw out of the async chain.
2. - **api-design** (`src/**/*.routes.ts`, new modules introducing a cross-cutting contract change): When a new module deliberately diverges from an established response-shape convention, state the divergence and the "do not homogenize" instruction directly in the spec next to the affected AC, not just in a design doc a future agent may not load.
3. - **performance** (rule/graph evaluation engines, synchronous request-path traversal): Derive a hard traversal bound from an existing enum's cardinality (e.g. `MAX_HOPS = STATUSES.length`) rather than a bare magic number, so the bound self-updates and stays provably correct as the domain model grows.
4. - **security** (`*.validation.ts` accepting user-supplied outbound URLs, e.g. `webhook_url`): Treat SSRF exposure from user-supplied outbound URLs as a mandatory documented decision (accept-and-record scope, e.g. http(s)-only with no private/loopback blocking) rather than an implicit gap — record the accepted-risk boundary in the same place the validation rule lives.

**Limits applied**: 4 learnings (within the Level 3 cap of 2-4).

### Learned Rules Applied

- `api-design.md`: Applied — the FK-existence-check pattern (`parentRepo.findById` before insert → dedicated 400) was reused verbatim for `POST /rules`' `board_id` → `BOARD_NOT_FOUND` check.
- `data-access.md`: Applied — parameterized queries and `RETURNING`-based writes are used throughout `rules.repository.ts`/`webhooks.repository.ts`; the "optional filter as a single method" pattern is followed by `GET /rules?board_id=`/`GET /trigger-executions`/`GET /webhook-deliveries`'s filter params.
- `error-handling.md`: Loaded but partially superseded — the "centralize error shape" spirit held (one coded envelope per module) but the rules module's actual shape deliberately diverges from the shape this rule documents (`{error, details}` vs `{code, message, details}`), which is itself the topic of Extractable Learning #2 above.
- `frontend-patterns.md`: Applied and extended — the single-fetch-seam discipline was extended from a read-only client to a mutation-capable one (`mutateJson`/`MutationResult`/`CodedError` added to `api/client.ts`), and the status-union async-state discipline was carried into the new `useRules` hook mirroring `useActivityStream`.
- `connection-lifecycle.md`: Loaded but not applicable — this rule targets long-lived server-to-client streaming connections (SSE); the webhook dispatcher is an outbound fire-and-forget call, a different shape of async problem (see Extractable Learning #1 for the pattern this task actually needed).
- `testing-patterns.md`: Applied — `webhooks.dispatcher.test.ts` stubs `fetch` and uses fake timers exclusively, per the existing "no live network, no wall-clock waits" convention.
- `configuration.md`: Applied — the three new webhook env vars (`WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_RETRY_BACKOFF_MS`) were added through `src/config/env.ts` rather than hardcoded, consistent with 12-factor config.
- `infrastructure.md`: Applied — `004_automation_rules.sql`/`005_workflow_webhooks.sql` were treated as deployment-affecting (numbered migration convention preserved, referenced explicitly in the roadmap).

### For Claude Code Workflow

1. The per-phase creative-gating mechanism is robust to genuine mid-task scope
   changes — process improvement opportunity: formalize "restructure phases,
   preserve lineage in the roadmap text" as the documented recovery procedure for
   scope-reversal events, rather than leaving it as an emergent pattern this task
   happened to follow well.
2. Explicit "do not fix this" warnings embedded in the spec next to an
   intentionally unusual AC appear to reliably prevent a later agent from
   silently "correcting" the intentional divergence — worth promoting from an
   ad hoc spec-author habit to a documented technique.
3. The session-log task-indexing gap has now affected five consecutive
   reflections identically; this is no longer a one-off observation and should
   be escalated past "note in the reflection" to an actual `/banyan-init`/
   `/banyan-upgrade` follow-up, since noting it repeatedly without resolution
   has zero marginal value at this point.

---

## Conclusion

TASK-006 is a strong Level 3 delivery: all 10 acceptance criteria were implemented
and verified against 316 passing tests with zero regressions across 4 build
phases, and — more distinctively — it demonstrates that the frozen-creative-decision
mechanism survives a genuine mid-task product-scope reversal without contradiction
or rework of already-completed phases. The fail-safe posture (engine, dispatcher,
even the dispatcher's own logging call) was applied with real rigor rather than
box-checking, and every deferred risk (SSRF scope, restart durability, the
unproduced `trigger_executions.status='failed'` path) is explicitly named rather
than silently absent. The main ecosystem friction is not new: the task-indexed
session-log directory has now been absent for five consecutive tasks, which means
this reflection's Build Session Analysis — like the four before it — is grounded
in git history and source inspection rather than actual tool-call telemetry.

**Overall Task Success**: ✅ Success

**Overall Workflow Effectiveness**: ✅ Highly Effective

**Recommendation**: Ready to archive. Carry forward as open follow-ups: (1) the
`findNonTerminalDeliveries` unused-capability tracking item, (2) the SSRF/restart-
durability hardening pair, (3) the `memory-bank/roadmap.md` FEAT-006 AC-list
update, and (4) the recurring by-task session-log indexing gap (now 5-for-5)
flagged as High Priority for the ecosystem itself, independent of this task.

## References
- Plan: `memory-bank/tasks/TASK-006.md`
- Creative: `memory-bank/creative/TASK-006-card-workflow-automation-architecture.md`, `memory-bank/creative/TASK-006-card-workflow-automation-algorithm.md`, `memory-bank/creative/TASK-006-webhook-architecture.md`, `memory-bank/creative/TASK-006-webhook-retry-algorithm.md`, `memory-bank/creative/TASK-006-automation-ui-uiux.md`
- Progress: `memory-bank/progress.md` (no TASK-006 entries yet — see Memory Bank Assessment)
- Build commits: `7a8cad4` (Phase 1), `cb4290f` (Phase 2), `2ae9c11` (Phase 3), `20facf3` (Phase 4), `b1468de` (creative freeze)
