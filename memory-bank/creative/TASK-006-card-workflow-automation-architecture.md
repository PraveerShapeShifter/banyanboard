# Architecture Decision: Card Workflow Automation (rule model + evaluation placement)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: Architecture
**Task**: TASK-006 / FEAT-006 (Level 3)
**Scope of this doc**: The three decisions this architecture phase OWNS — (1) `condition` storage representation + the canonical logical condition model, (2) evaluation timing (synchronous vs deferred), (3) `src/rules/` module placement + engine wiring. It explicitly does NOT decide the loop-prevention algorithm/bound or the rule-match ambiguity policy — those belong to the Algorithm phase, which consumes the condition model frozen here.

---

## Context

### System Requirements
- Persist board-scoped **automation rules** (`automation_rules` table via new `db/init/004_automation_rules.sql`) exposing `id, board_id, name, condition, target_status, enabled, created_at, updated_at`.
- A rule is a single `condition → target_status` mapping (AC-HAPPY-1/2). Compound AND/OR composition is **out of scope** this iteration.
- On `PATCH /cards/:id`, after a real status transition is captured (FEAT-005), evaluate the card's new state against the board's enabled rules and apply auto-moves (AC-HAPPY-2).
- The `PATCH /cards/:id` response body must reflect the card's **final** post-automation status (Success Criteria; AC-HAPPY-2).
- Each auto-move hop persists its own `card_activity` row tagged `triggered_by:'rule'` + `rule_id` and fans out via the reused FEAT-005 `ActivityEmitter` (AC-ASYNC-1/2).
- Rule-engine failures are **fail-safe**: never crash the process, never convert the caller's successful PATCH into a `500` (AC-ERROR-3), never loop forever (AC-ERROR-1).

### Technical Constraints
- **No external validation library** — hand-rolled field checks, mirroring `cards.validation.ts` (`checkTitle`/`checkStatus` style).
- **No JSONB anywhere in the codebase today** — this would be the first use; no pattern to mirror.
- **No cross-repository transaction / unit-of-work pattern** — `cards.repository.ts` commits each `update()` atomically on its own. AC-ASYNC-2 explicitly declares no rollback across hops.
- **No async job/queue/scheduler infrastructure** — the app is a synchronous Express request/response service; the only "async seam" is the in-process `ActivityEmitter` (fire-and-forget, in-memory).
- **DI at the composition root** — side-effecting resources are constructed in `server.ts` and injected into a pure `createApp(deps)`; the factory reads no env and opens no sockets.
- **Observability today = a minimal structured `log(level, msg, meta)`** (JSON-per-line to stdout, `src/config/logger.ts`). No OpenTelemetry SDK, no metrics, no tracing are wired in-repo (the CLAUDE.md OTEL standard is aspirational; the concrete logger is the `log()` wrapper).

### Non-Functional Requirements
- **Latency**: API p95 < 200ms, p99 < 500ms (`productBrief.md`). Synchronous in-request evaluation is only viable if the auto-move chain is bounded by a small fixed constant.
- **Availability / fail-safe liveness**: rule evaluation must never crash the process or fail the underlying card write (systemPatterns "Fail-safe liveness"; AC-ERROR-3).
- **Simplicity-first clean architecture** (systemPatterns Guiding Principle #1): shallow layers; add abstraction only when a concrete need appears; favor direct, readable code over indirection.
- **Testability by construction**: HTTP behavior exercised via Supertest with injected stubs; no live DB in tests.

### Existing Patterns That MUST Be Respected
- Module layout: `types` / `validation` / `repository` / `routes` (+ co-located `*.test.ts`), mirrored across `boards`/`cards`/`activity`.
- Repository as an **interface** with a `Postgres*` implementation; parameterized SQL only; a `to<Entity>()` row-mapper.
- App-level FK-existence check via `boardsRepo.findById` before insert (surface `BOARD_NOT_FOUND` 400, never a raw Postgres FK 500) — as `POST /cards` does.
- `VARCHAR(20) CHECK (... IN ('todo','in_progress','done'))` is the established status-enum persistence idiom (`cards.status`, `card_activity.from_status`/`to_status`).
- The **injected seam** idiom: `ActivityEmitter` is a purpose-built interface injected via `AppDeps`, constructed in `server.ts`, as the single swap-point (systemPatterns "In-process event fan-out seam").
- The **fail-safe side-effect on the write path** idiom: the `PATCH /cards/:id` activity-capture block is gated on a real transition (`previousStatus !== card.status`), persist-first, wrapped in try/catch that logs and never fails the response.

---

## Component Analysis

### Core Components
| Component | Purpose | Responsibilities |
|-----------|---------|------------------|
| `src/rules/rules.types.ts` | Domain shapes | `AutomationRule`, `RuleCondition` (`{field, operator, value}`), `CreateRuleInput`, `UpdateRuleInput`, the `CONDITION_FIELDS`/`CONDITION_OPERATORS` const enums |
| `src/rules/rules.validation.ts` | Hand-rolled body validation | `validateCreateRule`/`validateUpdateRule`; coded-error field checks (`INVALID_RULE`); reuses `CARD_STATUSES` message style |
| `src/rules/rules.repository.ts` | Data access | `RulesRepository` interface + `PostgresRulesRepository`; maps flat `condition_*` columns ↔ nested `condition` object; `findEnabledByBoard(boardId)` for the engine |
| `src/rules/rules.routes.ts` | REST surface | `createRulesRouter(rulesRepo, boardsRepo)` — 5 CRUD endpoints, coded error envelope, FK-existence check |
| `src/rules/rules.engine.ts` | Evaluation engine (the seam) | `RuleEngine` interface + `CardRuleEngine`; evaluates a card's post-transition state, applies bounded auto-move hops, records `triggered_by:'rule'` activity, internally fail-safe |
| `db/init/004_automation_rules.sql` | Schema | `automation_rules` table + `card_activity` `triggered_by`/`rule_id` columns |

### Component Interactions
```
                    POST/GET/PATCH/DELETE /rules
client ───────────────────────────────────────────▶ createRulesRouter(rulesRepo, boardsRepo)
                                                          │ FK check via boardsRepo.findById
                                                          ▼
                                                     PostgresRulesRepository ──▶ automation_rules

            PATCH /cards/:id  (existing FEAT-003 path)
client ───────────────────────────────────────────▶ createCardsRouter(cardsRepo, boardsRepo,
                                                        activityRepo, activityEmitter, ruleEngine)
                                                          │  cardsRepo.update -> {card, previousStatus}
                                                          │  if (previousStatus !== card.status):
                                                          │     ├─ [FEAT-005] activityRepo.record(triggered_by:'manual') + emit   (existing block)
                                                          │     └─ finalCard = ruleEngine.evaluate(card)   ◀── NEW, immediately after
                                                          ▼
                                                     res.status(200).json(finalCard)   // reflects final status

RuleEngine.evaluate(card):  (constructed in server.ts with the SAME instances)
   rulesRepo.findEnabledByBoard(card.board_id)   // ONE read per pass
   loop (bounded — Algorithm phase owns bound + cycle strategy):
       match rule.condition against current card state
       cardsRepo.update(card.id, { status: rule.target_status })   // atomic per-hop, no cross-hop txn
       activityRepo.record({ ..., triggered_by:'rule', rule_id })   // per-hop activity
       activityEmitter.emit(board_id, event)                        // reuse FEAT-005 fan-out
   return last-applied card   // internally fail-safe: never throws
```

The engine reuses the **repository layer directly** — it does NOT re-enter the HTTP handler, so there is no HTTP re-entrancy and no double-capture of the manual transition. It reuses `activityRepo`/`activityEmitter` for its own hops.

---

## Decision 1 — `condition` storage representation + canonical condition model

### Canonical Logical Condition Model (frozen for the Algorithm phase to consume)

A rule's `condition` is a **single predicate** with the shape:

```jsonc
condition: { "field": <ConditionField>, "operator": <ConditionOperator>, "value": <string> }
```

For **this iteration** the domains are deliberately minimal:

| Element | Allowed values (this iteration) | Type | Rationale |
|---------|--------------------------------|------|-----------|
| `field` | `"status"` | `ConditionField = 'status'` | `status` is the only card field whose change is the auto-move trigger in every AC (AC-HAPPY-2, AC-ERROR-1 examples are all status→status). `title`/`description` equality is not meaningful for "keep cards flowing"; `due_date` comparisons are clock-driven ("due date passes") and explicitly **out of scope** (needs a scheduler). |
| `operator` | `"eq"` | `ConditionOperator = 'eq'` | Equality is sufficient for status matching. Comparison operators (`lt`/`gt`) only make sense for `due_date`, which is out of scope. |
| `value` | `"todo" \| "in_progress" \| "done"` | `string` constrained to `CARD_STATUSES` | Reuses the existing `CardStatus` enum and its CHECK — zero new value-typing machinery. |

**Matching semantics** (input to the Algorithm phase): a rule matches a card iff `card[condition.field] === condition.value` (i.e. `card.status === condition.value`). The auto-move target is `rule.target_status`. Because both the matched field and the target are drawn from the same three-status enum, the **transition graph the Algorithm phase reasons about is a directed graph over `{todo, in_progress, done}`** — which is exactly why a visited-status set / small hop bound is tractable. A rule whose `condition.value === target_status` (a self-loop) is a validation-time candidate for rejection or a no-op — flagged to the Algorithm/validation owner, not decided here.

**Extensibility (non-breaking future path)**: the `{field, operator, value}` shape is intentionally general so a later feature can widen `ConditionField` (add `due_date`), `ConditionOperator` (add comparisons), or introduce a compound wrapper — additively, without reshaping existing rows for the `status/eq` case.

### Storage Options Explored

#### Option 1: Normalized typed columns (`condition_field`, `condition_operator`, `condition_value`)
- **Description**: Three `VARCHAR` columns, each with a `CHECK` constraint matching the frozen enum. The repository maps the flat columns to/from the nested `condition` object on the wire (a `toRule()` mapper, exactly like `toCard()`/`toActivity()`).
- **Components**: 3 columns in `004_*.sql`; a `toRule()` projection in `rules.repository.ts`.
- **Pros**:
  - **Postgres enforces the entire shape** (field/operator/value all CHECK-constrained) — a corrupt condition cannot be persisted even by a future non-HTTP writer.
  - **Mirrors the existing `status`/`target_status` idiom exactly** — no new persistence precedent, no new mental model for the next developer.
  - Hand-rolled validators map 1:1 to columns; `condition_value` reuses the `checkStatus` message/enum.
  - Directly honors simplicity-first: "add abstraction only when a concrete need appears" — there is no schema-less need this iteration (compound AND/OR is out of scope).
- **Cons**:
  - Adding a future operator/field/compound needs a migration (`ALTER ... CHECK`). Acceptable — schema evolution is normal at MVP.
  - Tiny flat↔nested mapping in the repository (already the house style; not new indirection).
- **Technical Fit**: High — matches the exact enum-column pattern already used three times.
- **Complexity**: Low.
- **Scalability**: High for the frozen model; medium if the model explodes into deep compound trees (then reconsider).

#### Option 2: Single `JSONB` column (`condition JSONB NOT NULL`)
- **Description**: Store the `{field, operator, value}` object verbatim; `pg` round-trips JSONB as a parsed JS object automatically.
- **Components**: 1 column; no marshalling code.
- **Pros**:
  - Slightly less repository code (no flat↔nested mapping).
  - Future compound/multi-field conditions fit without a migration.
- **Cons**:
  - **First use of JSONB in the codebase** — a new persistence precedent with *no* pattern to mirror, directly in tension with the simplicity-first Guiding Principle ("add abstraction only when a concrete need appears"). The concrete need (compound conditions) is explicitly out of scope.
  - **Postgres cannot enforce the shape** without heavy `CHECK (jsonb_typeof(...) ...)` expressions that are harder to read than three plain CHECKs — so the DB-level guarantee is *weaker*, not stronger, for the model we actually have.
  - Value typing becomes ambiguous (is `value` a string, a date, a number?) — the normalized enum sidesteps this entirely for `status`.
  - Speculative generality: buys flexibility we are contractually told not to need yet.
- **Technical Fit**: Low — introduces a precedent the guiding principles caution against.
- **Complexity**: Medium (validation must carry the full shape burden with no DB backstop).
- **Scalability**: High for arbitrary future shapes — but that scalability is unused this iteration.

#### Option 3: Serialized JSON in a `TEXT`/`VARCHAR` column
- **Description**: `JSON.stringify` the condition into a text column; parse on read.
- **Pros**: No JSONB precedent; single column.
- **Cons**: **Worst of both** — no DB shape enforcement AND manual `JSON.parse`/`stringify` (a new failure mode: unparseable stored text), not queryable/indexable, no type safety. Strictly dominated by Options 1 and 2.
- **Technical Fit**: Low. **Complexity**: Medium. **Scalability**: Low. (Rejected outright.)

### **Chosen**: Option 1 — Normalized typed columns (`condition_field`, `condition_operator`, `condition_value`)

**Rationale**: The frozen condition model is a single status-equality predicate. Normalized enum-columns are the *direct, readable, pattern-consistent* representation for that model: they reuse the exact `VARCHAR(20) CHECK (... IN (...))` idiom the codebase already uses three times, let Postgres enforce every part of the shape, and keep validation a 1:1 mirror of `cards.validation.ts`. JSONB would set a first-in-codebase precedent purely to buy compound-condition flexibility that is explicitly out of scope — the textbook definition of the premature abstraction the simplicity-first Guiding Principle forbids. The wire contract still exposes the future-proof nested `condition: {field, operator, value}` object, so the API is not locked to the flat storage and a later JSONB migration (if compound conditions ever land) remains open.

**Persisted columns** (in `automation_rules`):
```sql
condition_field    VARCHAR(20) NOT NULL CHECK (condition_field    IN ('status')),
condition_operator VARCHAR(10) NOT NULL CHECK (condition_operator IN ('eq')),
condition_value    VARCHAR(20) NOT NULL CHECK (condition_value    IN ('todo','in_progress','done')),
```

---

## Decision 2 — Evaluation timing (synchronous vs deferred)

### Options Explored

#### Option A: Synchronous, in-request (the spec's current assumption)
- **Description**: After the manual transition is captured, call `ruleEngine.evaluate(card)` *inside* the `PATCH /cards/:id` handler; apply all bounded hops before responding; the response body is the engine's final card.
- **Pros**:
  - Honors the Success Criteria / AC-HAPPY-2 contract verbatim: **response reflects the final status**; the caller (curl/Postman/automation) never needs a second request.
  - A straight-line extension of the existing capture block in the *same* handler — **no new infrastructure** (no queue, no scheduler, no worker), respecting simplicity-first.
  - Fully testable via the existing Supertest integration-first convention — the auto-move completes deterministically within the request.
  - Fail-safe fits naturally: the engine is internally guarded and cannot crash the process (Fail-safe liveness).
- **Cons**:
  - Adds DB work to the request path. Mitigated by the **small fixed hop bound** (Algorithm phase) and by fetching the board's enabled rules **once per pass** (see below).
- **Technical Fit**: High. **Complexity**: Low. **Scalability**: Medium (bounded by design).

#### Option B: Deferred / async (evaluate after responding; final state only via the activity feed)
- **Description**: Respond immediately with the client-requested status; schedule the engine (`setImmediate`/`queueMicrotask`/fire-and-forget) to run after the response; clients learn the final state only from the FEAT-005 SSE feed.
- **Pros**:
  - Removes auto-move work from the latency budget of the triggering request.
- **Cons**:
  - **Overturns the stated contract** — the Success Criteria explicitly require the PATCH response to reflect the final status; AC-HAPPY-2 asserts the final status in the response body. Deferral would demand a spec change and a weaker "eventually consistent, watch the feed" contract for a REST-only feature with no UI.
  - **No async infrastructure exists** — a bare fire-and-forget promise risks an unhandled rejection crashing the process, *violating* Fail-safe liveness unless wrapped in its own guard (new machinery).
  - Harder to test under the Supertest convention (the effect races the assertion).
  - Introduces an observability gap window where `GET /cards/:id` disagrees with the just-returned PATCH.
- **Technical Fit**: Low (fights the contract and the fail-safe principle). **Complexity**: Medium/High. **Scalability**: High (decoupled) — but unnecessary at MVP throughput ("modest, small-team concurrency").

### Latency Analysis vs p95 < 200ms

Per `PATCH /cards/:id`, synchronous evaluation adds, worst case:
- **1** `SELECT` of the board's enabled rules (`findEnabledByBoard`, indexed by `board_id`, small N per board) — fetched **once per pass**, evaluated in memory across hops.
- Per applied hop: **1** `UPDATE` (`cardsRepo.update`, single-row by PK) + **1** `INSERT` (`activityRepo.record`) → `2 × H` queries, where `H` is the fixed hop bound.

Each of these is a single-row parameterized operation on an indexed PK — ~sub-ms to low-single-digit-ms on a pooled local connection. Even at a generous `H = 10`, that is `1 + 2·10 = 21` tiny queries, comfortably tens of ms — well inside the 200ms p95 / 500ms p99 budget. The **typical** case is `H = 0–1` (no rule, or one auto-move), adding one `SELECT` (+ optionally one `UPDATE`+`INSERT`). This is why the NFR *depends on* the hop bound being a small fixed constant (not per-rule configurable) — the guardrail the Algorithm phase owns is precisely what keeps synchronous evaluation within budget.

### **Chosen**: Option A — Synchronous, in-request evaluation (CONFIRM the spec's assumption)

**Rationale**: Synchronous evaluation is the only option that keeps the "response reflects final status" contract the Success Criteria and AC-HAPPY-2 mandate, and it does so as a minimal, testable, fail-safe extension of the existing write-path capture block — no new async infrastructure, no new process-crash surface. The p95 budget is protected not by deferring work but by the small fixed hop bound (Algorithm phase) plus a single per-pass rules read. Deferral would buy latency headroom the MVP's modest throughput does not need, at the cost of overturning the contract and importing an async failure model the codebase has no pattern for.

---

## Decision 3 — `src/rules/` module placement + engine wiring

### The engine is an injected seam (`RuleEngine`), mirroring `ActivityEmitter`

- **`rules.engine.ts`** exports a `RuleEngine` interface and a `CardRuleEngine` implementation:
  ```ts
  export interface RuleEngine {
    /**
     * Evaluate `card`'s post-transition state against its board's enabled
     * rules and apply bounded auto-move hops. Returns the card's final
     * (last-successfully-applied) state. INTERNALLY FAIL-SAFE: never throws —
     * on a cycle-guard trip or a mid-pass persistence error it logs a
     * structured event and returns the last-applied card.
     */
    evaluate(card: Card): Promise<Card>;
  }
  ```
- `CardRuleEngine` is constructed with the **same instances** the routes use, injected at the composition root:
  ```ts
  // server.ts
  const rulesRepo = new PostgresRulesRepository(pool);
  const ruleEngine = new CardRuleEngine({ rulesRepo, cardsRepo, activityRepo, activityEmitter });
  createApp({ ..., rulesRepo, ruleEngine });
  ```
- `AppDeps` gains `rulesRepo: RulesRepository` and `ruleEngine: RuleEngine`.
- `createApp` mounts the router and threads the engine:
  ```ts
  app.use(createRulesRouter(deps.rulesRepo, deps.boardsRepo));               // needs boardsRepo for FK check
  app.use(createCardsRouter(deps.cardsRepo, deps.boardsRepo,
                            deps.activityRepo, deps.activityEmitter, deps.ruleEngine)); // +1 param
  ```

**Why an injected interface (not a plain imported function)**: it mirrors the established `ActivityEmitter` seam (systemPatterns "single swap-point... only the injected implementation changes"), keeps `cards.routes.ts` decoupled from `rulesRepo` and the engine's internals, and lets `cards.routes.test.ts` inject a stub `RuleEngine` (assert "engine was invoked with the post-transition card", "final status is returned") without wiring the whole rules subsystem — preserving Testability by construction.

### Invocation point in `cards.routes.ts`

Inside the existing real-transition gate, **immediately after** the FEAT-005 capture try/catch:

```ts
let finalCard = card;
if (previousStatus !== card.status) {
  try { /* existing FEAT-005 activity capture (triggered_by:'manual') */ } catch { /* logged, fail-safe */ }

  // NEW — rule evaluation, gated on a real transition (a non-status PATCH
  // changes no match state, so it must not run the engine — latency + no
  // spurious auto-moves). Engine is internally fail-safe; the defensive
  // try/catch mirrors the activity block as belt-and-suspenders.
  try {
    finalCard = await ruleEngine.evaluate(card);
  } catch (err) {
    log('error', 'rules.execution_failed',
        { code: 'RULE_EXECUTION_FAILED', card_id: card.id, board_id: card.board_id,
          message: err instanceof Error ? err.message : String(err) });
    // finalCard remains the manually-applied card (AC-ERROR-3: PATCH still 200).
  }
}
res.status(200).json(finalCard);   // final status on success; manual status on engine failure
```

Placing the engine call **inside** the `previousStatus !== card.status` gate means non-status PATCHes (title/description/due_date edits) skip evaluation entirely — no spurious auto-moves and zero added latency on the common non-status path. The engine records its **own** per-hop `card_activity` rows (`triggered_by:'rule'`, `rule_id`) and emits them; it never re-enters the HTTP handler, so the manual transition is captured exactly once.

### Fail-safe boundary (satisfies AC-ERROR-1 / AC-ERROR-3)
The engine is **internally fail-safe**: it catches per-pass persistence errors and cycle-guard trips, logs the structured events (`rules.execution_failed` / `rules.cycle_detected`), and returns the last-successfully-applied card. Hops already committed before an error **stay committed** (AC-ASYNC-2 — no cross-hop transaction, consistent with the codebase having no unit-of-work pattern). The route's outer try/catch is defense-in-depth so that even a defect in the engine cannot fail the caller's PATCH.

---

## Evaluation Matrix

**Condition storage** (1 = worst … 5 = best):
| Criteria | Opt 1: Normalized columns | Opt 2: JSONB | Opt 3: Serialized TEXT |
|----------|:-:|:-:|:-:|
| Fit with existing patterns | 5 | 2 | 1 |
| DB-level shape enforcement | 5 | 2 | 1 |
| Simplicity-first compliance | 5 | 2 | 2 |
| Maintainability | 4 | 4 | 2 |
| Future compound-condition headroom | 2 | 5 | 3 |
| Implementation cost (lower = better) | 5 | 4 | 3 |
| **Verdict** | **Chosen** | Rejected | Rejected |

**Evaluation timing**:
| Criteria | Opt A: Synchronous | Opt B: Deferred |
|----------|:-:|:-:|
| Contract fidelity (final status in response) | 5 | 1 |
| Simplicity / no new infra | 5 | 2 |
| Fail-safe liveness | 5 | 2 |
| Testability (Supertest) | 5 | 2 |
| Latency headroom | 4 (bounded) | 5 |
| **Verdict** | **Chosen** | Rejected |

---

## Observability Architecture

> **Deviation from the methodology's OTEL template — flagged and justified.** This codebase has **no OpenTelemetry SDK, metrics, or distributed tracing wired in** (the `## Observability Standards` in CLAUDE.md is an aspirational standard; the concrete implementation is the minimal `log(level, msg, meta)` JSON logger). Introducing OTEL/Prometheus for this feature would violate simplicity-first and exceed the task's "no new OTEL/env vars" directive. This feature therefore reuses the existing structured logger only; a full OTEL rollout is a separate, API-wide concern.

### Logging (reuse `src/config/logger.ts`)
Structured JSON events, matching the existing `activity.captured` / `activity.capture.error` style:
| Event | Level | When | Fields |
|-------|-------|------|--------|
| `rules.applied` | info | An auto-move hop is applied | `card_id, board_id, rule_id, from_status, to_status, activity_id` |
| `rules.cycle_detected` | error | Bounded cycle/hop guard trips | `code:'RULE_CYCLE_DETECTED', card_id, board_id, hops, last_status` |
| `rules.execution_failed` | error | Engine persistence/evaluation throws mid-pass | `code:'RULE_EXECUTION_FAILED', card_id, board_id, rule_id, message` |
| `rule created` / updated / deleted | info | Rule CRUD (mirrors `card created`) | `ruleId, boardId` |

No secrets/PII are logged (rule names and statuses only). Log level is already governed by the existing `LOG_LEVEL` env var — **no new env vars**.

### Tracing / Metrics
Not implemented in-repo; out of scope (see deviation note). If/when OTEL is adopted API-wide, the natural spans would be `rules.evaluate` (per pass) wrapping child spans per hop, and a `rule_auto_moves_total{board_id-free}` counter — deferred.

### Configuration Variables
| Variable | Purpose | Default | New? |
|----------|---------|---------|------|
| `LOG_LEVEL` | Log verbosity | info | No (existing) |
| `LOG_FORMAT` / `LOG_OUTPUT` | (existing logger knobs) | json / stdout | No |

No new configuration is introduced by this feature. The hop bound is a **compile-time constant** in `rules.engine.ts` (Algorithm phase owns the value), deliberately not env-configurable — per AC-ERROR-1 it must be a small fixed constant to protect the latency budget.

---

## Decision Summary (the three owned decisions)

1. **Condition storage** — **Chosen**: Normalized typed columns `condition_field` / `condition_operator` / `condition_value` (`VARCHAR` + `CHECK`), exposed on the wire as a nested `condition: {field, operator, value}` object via a `toRule()` mapper. **Not JSONB** (premature per simplicity-first; compound conditions out of scope).
2. **Evaluation timing** — **Chosen**: Synchronous, in-request evaluation inside `PATCH /cards/:id` (CONFIRMS the spec assumption). Keeps the final-status-in-response contract; p95 protected by the small fixed hop bound + one per-pass rules read; no new async infra.
3. **Module placement** — **Chosen**: `src/rules/` mirrors `boards`/`cards`/`activity`. The engine is an injected `RuleEngine` seam (mirroring `ActivityEmitter`), constructed in `server.ts` with the same repo/emitter instances, added to `AppDeps`, and passed as a new param into `createCardsRouter`; invoked inside the existing real-transition gate immediately after the FEAT-005 capture block; internally fail-safe.

---

## Implementation Guidelines

1. **`db/init/004_automation_rules.sql`** — create `automation_rules` **before** the `card_activity` ALTER that FK-references it (same file, correct order):
   ```sql
   CREATE TABLE IF NOT EXISTS automation_rules (
     id                 INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     board_id           INTEGER      NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     name               VARCHAR(120) NOT NULL,
     condition_field    VARCHAR(20)  NOT NULL CHECK (condition_field    IN ('status')),
     condition_operator VARCHAR(10)  NOT NULL CHECK (condition_operator IN ('eq')),
     condition_value    VARCHAR(20)  NOT NULL CHECK (condition_value    IN ('todo','in_progress','done')),
     target_status      VARCHAR(20)  NOT NULL CHECK (target_status      IN ('todo','in_progress','done')),
     enabled            BOOLEAN      NOT NULL DEFAULT true,
     created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS automation_rules_board_id_idx ON automation_rules (board_id);

   ALTER TABLE card_activity
     ADD COLUMN IF NOT EXISTS triggered_by VARCHAR(10) NOT NULL DEFAULT 'manual'
       CHECK (triggered_by IN ('manual','rule')),
     ADD COLUMN IF NOT EXISTS rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL;
   ```
   (`name VARCHAR(120)` matches `boards.name`; `ON DELETE SET NULL` on `rule_id` keeps activity history after a rule is deleted, mirroring `card_activity.card_id`.)
2. **`rules.repository.ts`** — `RulesRepository` interface + `PostgresRulesRepository`; parameterized SQL only; a `toRule()` mapper that folds the flat `condition_*` columns into the nested `condition` object. Add `findEnabledByBoard(boardId): Promise<AutomationRule[]>` returning `enabled = true` rules for the engine (single read per pass).
3. **`rules.validation.ts`** — hand-rolled, coded `INVALID_RULE` envelope `{ code, message, details:[{field,error}] }`. Validate `condition` as an object with `field ∈ {'status'}`, `operator ∈ {'eq'}`, `value ∈ CARD_STATUSES`; emit `{field:'condition.field', error:...}` / `condition.operator` / `condition.value` style messages once the Algorithm phase confirms the enum (the shape is frozen here). Reuse the `checkStatus` message for `target_status` and `condition.value`.
4. **`rules.routes.ts`** — `createRulesRouter(rulesRepo, boardsRepo)`; `board_id` in the POST body + optional `?board_id=` filter (mirror `cards`); FK-existence via `boardsRepo.findById` → `BOARD_NOT_FOUND`; `board_id` immutable on PATCH; `RULE_NOT_FOUND` 404s.
5. **`rules.engine.ts`** — `RuleEngine` interface + `CardRuleEngine`; fetch enabled rules **once**, evaluate in memory across hops, apply via `cardsRepo.update`, record `triggered_by:'rule'`+`rule_id` activity and `emit` per hop; internally fail-safe (log + return last-applied card). **Leave the hop bound, cycle-detection strategy, and multi-match policy as TODO seams for the Algorithm phase** — expose the condition-match predicate (`card.status === rule.condition.value`) it will build on.
6. **`activity.types.ts` / `activity.repository.ts`** — extend `RecordActivityInput` + `CardActivity`/`ActivityEvent` with optional `triggered_by?: 'manual'|'rule'` and `rule_id?: number|null`; extend the `record` INSERT + `COLUMNS` projection; update the manual call site in `cards.routes.ts` to pass `triggered_by:'manual'` explicitly (or rely on the column default).
7. **`app.ts` / `server.ts`** — add `rulesRepo` + `ruleEngine` to `AppDeps`; construct both in `server.ts`; mount `createRulesRouter`; thread `ruleEngine` into `createCardsRouter`.
8. **Tests** — per Test Strategy: stub `RuleEngine` in `cards.routes.test.ts`; unit-test `CardRuleEngine` (match/no-match/disabled/bounded-cycle/fail-safe) in `rules.engine.test.ts` with stub repos.

---

## Validation Checklist

- [x] Meets all system requirements (rule persistence, sync auto-move, final-status response, distinguishable activity, fail-safe)
- [x] Respects technical constraints (no external validator, no JSONB precedent introduced, no cross-repo txn, no async infra)
- [x] Addresses NFRs (p95 latency via bounded synchronous pass; fail-safe liveness via internally-guarded engine)
- [x] Technically feasible with the current stack (Express + `pg` + injected seams)
- [x] Risks identified and acceptable (below)
- [x] Complies with Guiding Principles in systemPatterns.md — **one flagged deviation**: the methodology's mandatory OTEL/metrics/tracing observability template is *not* adopted (codebase has no OTEL); justified under simplicity-first + the task's "no new OTEL/env vars" directive, reusing the existing `log()` structured logger instead. No deviation from the systemPatterns.md Guiding Principles themselves.
- [x] Respects established patterns (module layout, repository interface, enum-column CHECK idiom, FK-existence check, injected seam, fail-safe write-path side-effect)
- [x] Observability defined (structured log events; tracing/metrics explicitly out of scope with rationale)
- [ ] Trace context propagation across service boundaries — N/A (single in-process service; no OTEL in-repo)
- [x] Logging strategy consistent with the existing logger convention
- [x] Metrics naming — N/A (no metrics layer in-repo)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Long/cyclic rule chain breaches p95<200ms under synchronous eval | Low | High | Small fixed hop bound (Algorithm phase) + single per-pass rules read; bound is a compile-time constant, not per-rule configurable (AC-ERROR-1) |
| Engine failure converts a good PATCH into a 500 | Low | High | Engine internally fail-safe + defensive route try/catch mirroring the activity block (AC-ERROR-3) |
| Partial multi-hop progress on failure looks inconsistent | Medium | Low | Documented no-rollback / last-write-wins-per-hop decision (AC-ASYNC-2); codebase has no unit-of-work pattern — introducing one is out of scope |
| Normalized columns need a migration when compound conditions arrive | Medium | Low | Wire contract already uses the extensible nested `condition` object; migration to widen CHECKs (or move to JSONB) stays open and non-breaking for `status/eq` rows |
| Spurious auto-move on a non-status PATCH | Low | Medium | Engine invoked only inside the `previousStatus !== card.status` gate |

## Next Steps

1. **Algorithm phase** consumes the frozen condition model (`{field:'status', operator:'eq', value:CardStatus}`, transition graph over the three statuses) and decides: the hop bound constant, the cycle-detection strategy (visited-status set vs visited-rule-id set vs hop counter), and the multi-match ambiguity policy (first-match-wins vs validation-time conflict vs self-loop rejection).
2. **Build Phase 1** freezes `004_*.sql` + the `src/rules/` CRUD surface against this storage decision.
3. **Build Phase 2** implements `CardRuleEngine` per the Algorithm phase's bound/strategy and hooks it into `cards.routes.ts` per Decision 3.

---

## NEW_TERMS_INTRODUCED

- **automation rule** — a persisted, board-scoped `condition → target_status` mapping in `automation_rules`.
- **condition (RuleCondition)** — a single predicate `{field, operator, value}`; this iteration frozen to `field:'status'`, `operator:'eq'`, `value:CardStatus`.
- **ConditionField / ConditionOperator** — the enum domains for `condition.field` (`'status'`) and `condition.operator` (`'eq'`), stored as `condition_field` / `condition_operator` CHECK-constrained columns.
- **target_status** — the status a matched rule moves the card to (reuses the `CardStatus` enum + CHECK).
- **evaluation pass** — one synchronous run of the engine for a single triggering `PATCH /cards/:id`.
- **hop / auto-move** — one rule-driven status transition applied within a pass; each hop persists its own `card_activity` row.
- **RuleEngine (CardRuleEngine)** — the injected seam that runs an evaluation pass; internally fail-safe; mirrors the `ActivityEmitter` seam.
- **triggered_by / rule_id** — new `card_activity` columns distinguishing `'manual'` from `'rule'` moves and linking the driving rule.
- **cycle guard / hop bound** — the bounded-termination mechanism protecting AC-ERROR-1 (concrete value + strategy owned by the Algorithm phase).
