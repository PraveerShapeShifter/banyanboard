# TASK-006: Card Workflow Automation

**Complexity**: Level 3 (inherited from FEAT-006)
**Status**: BUILD_COMPLETE (all 4 phases; backend 216/216 + frontend 100/100 tests; ready for /banyan-reflect)
**Roadmap**: FEAT-006
**Branch**: feature/FEAT-006-card-workflow-automation
**Worktree**: N/A

## Task Description

Introduce **rule-based workflow automation** for cards. A board owner defines
automation rules that automatically move a card to a different status/column when
a condition is satisfied (e.g., a card's due date passes, or a field changes). A
rules engine evaluates persisted `condition → action` rules against card lifecycle
events and applies auto-moves through the existing card status-change path —
reusing the FEAT-005 activity-capture hook so automated moves surface in the
realtime activity feed (distinguishable from manual moves).

Scope for this feature is the **rule-based auto-move** capability plus **optional
webhook delivery** and a **rule-management UI**: rule persistence model,
condition/action schema, an evaluation engine with cycle/loop prevention,
rule-management REST endpoints, an **asynchronous webhook dispatcher** (a rule may
optionally POST a JSON payload to a `webhook_url` when it fires, with bounded
retry), and a **Board Settings → Automation tab** in the existing React frontend
for creating rules and viewing execution/delivery history. Trigger→action macros
beyond a single `condition → target_status` action, and SLA/time-based
(clock-driven) automations, remain out of scope for this iteration unless a later
feature adds them.

> **Product addition (2026-07-15).** Webhook delivery and the settings UI were
> added to this task **after** the original creative phase completed. **Triggers
> must support webhook delivery**: when a trigger fires it can optionally POST a
> JSON payload to a `webhook_url` on the rule, retry **up to 3 times** on failure,
> with **delivery status tracked separately from trigger-execution status**. This
> addition (a) **reverses the original "no rule-builder UI" boundary** — Phase 4
> now builds a UI in the existing `frontend/`, and (b) **reopens creative** for the
> async delivery/retry mechanism (the codebase has no queue/scheduler/outbound-HTTP
> pattern today) and for the UI (see **Creative Exploration Needed** and **Creative
> Phases**). Phases 3–4 are gated on that new creative, exactly as Phase 1 was
> gated on the original creative.

**Dependencies**: FEAT-003 (Card CRUD API — card `status` is what rules auto-move,
and the `PATCH /cards/:id` path is the evaluation trigger); FEAT-002 (Board CRUD
API — rules are scoped per board); FEAT-005 (Realtime Activity Feed — automated
moves emit activity events). FEAT-001 (foundation — Express app factory, `pg` pool,
logger).

## Specification

**Feature Type**: End-User Feature
**Primary Persona**: Priya (Team Lead / Project Coordinator) — "keep cards flowing to Done" without babysitting every column; a board owner who defines the auto-move rules. (Secondary beneficiary: Marco/Sam, who observe automated moves land in the realtime activity feed alongside manual ones.)
**Creative Exploration Needed**: Yes — condition/action schema shape, loop-prevention algorithm and bound, and evaluation timing (synchronous vs deferred) are flagged LOW confidence below.

*Note (revised 2026-07-15): the rule-management API is consumed both by API clients (curl/Postman/automation) and — as of the product addition — by a new **Board Settings → Automation tab** in the existing React frontend (`frontend/src/`, alongside `BoardViewPage`/`ActivityFeed`). Phases 1–3 deliver the API + engine + webhook dispatcher; Phase 4 delivers the UI. (The original spec's "no React frontend" statement is superseded for this task.)*

### Invocation Method
- **Location**: New `src/rules/` module (`rules.types.ts`, `rules.validation.ts`, `rules.repository.ts`, `rules.routes.ts`, `rules.engine.ts`), mounted in `src/app.ts` alongside `createBoardsRouter`/`createCardsRouter`/`createActivityRouter`, and wired with a `PostgresRulesRepository` in `src/server.ts` — mirrors the existing `boards`/`cards`/`activity` module layout exactly.
- **Element**: REST endpoints, following the `cards` convention (board_id carried in the body on create, optional `?board_id=` filter on list — not a `/boards/:id/rules` nested path):
  - `POST /rules` — create a rule (`board_id`, `name`, `condition`, `target_status`, optional `enabled` default `true`, **optional `webhook_url`** — nullable; when set, the rule POSTs a JSON payload on each firing)
  - `GET /rules` (optional `?board_id=` filter, mirrors `GET /cards?board_id=`)
  - `GET /rules/:id`
  - `PATCH /rules/:id` — partial update; `board_id` immutable (mirrors `UpdateCardInput` — a rule cannot move boards); **`webhook_url` is updatable (settable to `null` to disable delivery)**
  - `DELETE /rules/:id`
  - **`GET /trigger-executions`** (optional `?board_id=` / `?rule_id=` filters) — the trigger-execution history (one row per rule firing), for the UI history view and API clients
  - **`GET /webhook-deliveries`** (optional `?rule_id=` / `?trigger_execution_id=` / `?status=` filters) and **`GET /webhook-deliveries/:id`** — the delivery records (status, attempts, last response code, coded error); read-only (delivery is created/advanced by the dispatcher, never by a client)
  - Plus **two** non-HTTP integration points:
    1. the evaluation engine is invoked from inside the existing `PATCH /cards/:id` handler in `src/cards/cards.routes.ts`, immediately after the existing FEAT-005 activity-capture block, via the injected `ruleEngine` dependency on `AppDeps` (mirrors how `activityRepo`/`activityEmitter` are injected into that same handler today);
    2. a new injected **`WebhookDispatcher`** seam (mirrors the `ActivityEmitter`/`RuleEngine` idiom) that the engine hands each webhook-bearing firing to. It creates the `webhook_deliveries` row synchronously (status `pending`) then performs the outbound POST + bounded retries **asynchronously, off the request path**, so webhook latency never enters the `PATCH /cards/:id` budget. Fail-safe: a dispatcher failure never crashes the process or fails the card write.
- **UI element (Phase 4)**: a new **Automation tab** reached from Board Settings on the existing `BoardViewPage` (React, `frontend/src/`): a rule-creation form (name, condition status, target status, optional `webhook_url`, enabled toggle), a per-board rule list with enable/disable and delete, and a read-only execution + delivery history view backed by `GET /trigger-executions` / `GET /webhook-deliveries`. Follows the existing frontend patterns (`ActivityFeed`, `EmptyState`/`ErrorState`/`Loading`).
- **Visibility**: Always available to any API caller / any UI user — this iteration implements no RBAC beyond what already exists (none; `productBrief.md`'s owner/member RBAC is not implemented anywhere in the current codebase, including boards/cards, so rules and the Automation tab follow the same posture).
- **Navigation**: API base URL as `/boards`, `/cards`, `/activity/stream`; UI via Board Settings → Automation tab on the board view.
- **Confidence**: HIGH for the rule CRUD REST surface and mount point (directly mirrors `boards.routes.ts`/`cards.routes.ts`); HIGH for the engine trigger point (the existing `PATCH /cards/:id` handler); LOW for the webhook async-delivery/retry mechanism and its storage (**no queue/scheduler/outbound-HTTP pattern exists in-repo — new creative required**); LOW for the Automation-tab UI/UX (new creative required); the condition/action schema and loop-prevention algorithm are now FROZEN (see Frozen Creative Decisions).

### Success Criteria
- **User sees**: `201` + the persisted rule JSON on `POST /rules`; `200` + array/object on `GET /rules`/`GET /rules/:id`; `200` + updated rule on `PATCH /rules/:id`; `204` on `DELETE /rules/:id`; a **coded** `400` (`{ code, message, details:[{field,error}] }`, codes `INVALID_RULE`/`BOARD_NOT_FOUND`) for a malformed rule body or a dangling `board_id`, and `404 { code: 'RULE_NOT_FOUND', ... }` for a missing rule — see the Error Code Catalog and AC-ERROR-2 (this coded envelope is a deliberate new pattern, not the `{error,details}` shape used by `cards`). For the auto-move behavior: the triggering `PATCH /cards/:id` response reflects the card's **final** status after any rule-driven auto-moves (not merely the client-requested status) — the caller does not need a second request to observe the automation's effect.
- **Verifiable at**: `GET /rules/:id` (rule state), `GET /cards/:id` (post-automation card status), `GET /activity/stream?board_id=` or the FEAT-005 backfill (`GET` via `findRecentByBoard`) for the resulting activity trail.
- **Data persisted**:
  - New `automation_rules` table (new `db/init/004_automation_rules.sql`, following the numbered-migration convention in `db/init/001_boards.sql`/`002_cards.sql`/`003_card_activity.sql`): `id` (identity PK), `board_id` (FK → `boards.id` `ON DELETE CASCADE`, mirrors `cards.board_id`), `name`, `condition` (normalized `condition_field`/`condition_operator`/`condition_value` columns — see Frozen Creative Decisions), `target_status` (`VARCHAR(20)` with the same `CHECK (... IN ('todo','in_progress','done'))` as `cards.status`), `enabled BOOLEAN NOT NULL DEFAULT true`, **`webhook_url VARCHAR(2048) NULL`** (nullable — an absolute `http(s)` URL when set; validated per AC-ERROR-4), `created_at`/`updated_at`.
  - Extends `card_activity` (via the same migration) with two nullable-with-default columns so automated moves are distinguishable per the roadmap AC: `triggered_by VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual','rule'))` and `rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL`. `RecordActivityInput` (`src/activity/activity.types.ts`) and `ActivityRepository.record` (`src/activity/activity.repository.ts`) gain the corresponding optional fields; the existing manual-move call site in `cards.routes.ts` is updated to pass `triggered_by: 'manual'` explicitly (or the column default covers it — an implementation-time decision, not a spec ambiguity).
  - **New `trigger_executions` table** (new `db/init/005_workflow_webhooks.sql`): one row per rule firing (auto-move hop) — `id` (identity PK), `rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL` (history survives rule deletion, mirrors `card_activity.rule_id`), `card_id`, `board_id`, `from_status`/`to_status` (`VARCHAR(20)` CHECK), `status VARCHAR(10) NOT NULL CHECK (status IN ('executed','failed'))` — the **trigger-execution** status (did the auto-move apply), `created_at`. This is the automation-scoped execution log for the UI history view; it complements (does not replace) the board-wide `card_activity` row already tagged `triggered_by:'rule'`.
  - **New `webhook_deliveries` table** (same migration): one row per webhook attempt-lifecycle — `id` (identity PK), `trigger_execution_id INTEGER NOT NULL REFERENCES trigger_executions(id) ON DELETE CASCADE`, `rule_id INTEGER REFERENCES automation_rules(id) ON DELETE SET NULL`, `url VARCHAR(2048) NOT NULL` (snapshot of `webhook_url` at fire time), `status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','exhausted'))` — the **delivery** status, tracked **separately** from `trigger_executions.status` per the product requirement, `attempts INTEGER NOT NULL DEFAULT 0`, `last_status_code INTEGER NULL`, `last_error TEXT NULL` (the coded `{code,message,details}` serialized — see AC-ERROR-4), `payload` (the POSTed JSON body — storage shape **pending webhook creative**: TEXT-serialized JSON vs re-derived; JSONB was rejected for `condition` and is not reintroduced here without a decision), `created_at`/`updated_at`/`delivered_at NULL`.
- **Observable within**: Immediate — rule CRUD is synchronous request/response; the auto-move (if the evaluation is synchronous per the Creative Exploration decision) completes within the same `PATCH /cards/:id` round-trip and is pushed to the FEAT-005 SSE feed with the same near-real-time latency as any other activity event (no new transport work needed — `activityEmitter.emit` is reused as-is).

### Acceptance Criteria

> **Error contract (NEW cross-cutting pattern — deliberate divergence).** Per an
> explicit product decision (planning audit, 2026-07-15), the `/rules` endpoints
> return a **coded** error body:
> ```json
> { "code": "INVALID_RULE", "message": "Validation failed",
>   "details": [ { "field": "target_status", "error": "must be one of: todo, in_progress, done" } ] }
> ```
> This is NOT the shape used elsewhere in the codebase today. `boards`, `cards`,
> and `activity` all return `{ "error": "...", "details": [ { "field", "message" } ] }`
> with **no** `code` field (see `src/cards/cards.routes.ts` / `src/cards/cards.validation.ts`).
> The rules module introduces `code` + `message` + `details:[{field,error}]` as a
> new contract. **Build agents: this mismatch is intentional — do not "fix" the
> rules error body to match cards.** Recommended (non-blocking) follow-up: a later
> feature rolls this coded shape out API-wide for consistency. The underlying
> field-check logic still mirrors `cards.validation.ts` (`checkTitle`/`checkStatus`
> style, hand-rolled, no external validator); only the envelope differs.
>
> **Error Code Catalog** (rules module):
> | Code | HTTP | When | Body |
> |------|------|------|------|
> | `INVALID_RULE` | 400 | Malformed `POST /rules` or `PATCH /rules/:id` body (bad/missing field, bad `condition` shape, `target_status` outside the enum, `board_id` cannot be changed) | `{ code, message: "Validation failed", details: [{field, error}] }` |
> | `BOARD_NOT_FOUND` | 400 | `POST /rules` with a well-formed `board_id` that references no board (app-level FK check via `boardsRepo.findById`, mirroring `POST /cards`) | `{ code, message: "board_id does not reference an existing board" }` (no `details`) |
> | `RULE_NOT_FOUND` | 404 | `GET`/`PATCH`/`DELETE /rules/:id` for a missing/malformed id | `{ code, message: "Rule not found" }` (no `details`) |
> | `RULE_CYCLE_DETECTED` | — (server log only; client still 200) | Bounded cycle/hop-limit guard trips during evaluation | Structured log event, not an HTTP body — see AC-ERROR-1 |
> | `RULE_EXECUTION_FAILED` | — (server log only; client still 200) | The engine's own persistence/evaluation throws mid-auto-move | Structured log event, fail-safe — see AC-ERROR-3 |
> | `WEBHOOK_NON_2XX` | — (delivery record + log; card PATCH still 200) | A webhook attempt gets a non-2xx response | `{ code, message, details:[{field:'status', error}] }` stored as `webhook_deliveries.last_error` + `rules.webhook_failed` log — see AC-ERROR-4 |
> | `WEBHOOK_TIMEOUT` | — (delivery record + log; card PATCH still 200) | A webhook attempt exceeds `WEBHOOK_TIMEOUT_MS` | `{ code, message, details:[{field:'timeout', error}] }` stored as `last_error` + `rules.webhook_failed` log — see AC-ERROR-4 |
> | `WEBHOOK_EXHAUSTED` | — (delivery record + log; card PATCH still 200) | All `WEBHOOK_MAX_ATTEMPTS` attempts failed (terminal) | `{ code, message, details:[{field:'attempts', error}] }` stored as `last_error`, `status='exhausted'` + `rules.webhook_exhausted` error log — see AC-ERROR-4 |
>
> **Webhook errors reuse the coded `{ code, message, details }` envelope but are NEVER returned to the `PATCH /cards/:id` caller** (delivery is asynchronous and fail-safe). They surface only (a) on the `webhook_deliveries` record via `GET /webhook-deliveries` (as the `error` projection of `last_error`) and (b) as structured logs. A malformed `webhook_url` on `POST`/`PATCH /rules`, by contrast, IS a synchronous `400 INVALID_RULE` (`details:[{field:'webhook_url', error}]`) — a bad URL is rejected before it can ever reach the dispatcher.

#### AC-ENTRY-1: Board owner can discover a board's automation rules via the API
**Priority**: MUST
**Given** a board with one or more persisted automation rules
**When** a client issues `GET /rules?board_id={boardId}`
**Then** the response is `200` with a JSON array of rule objects (`id, board_id, name, condition, target_status, enabled, created_at, updated_at`); omitting `board_id` returns rules across all boards (mirrors the optional `?board_id=` filter on `GET /cards` in `src/cards/cards.routes.ts`)

#### AC-HAPPY-1: Board owner creates, lists, updates, and deletes an automation rule
**Priority**: MUST
**Given** a board owner with a `board_id` that references an existing board (per `boardsRepo.findById`, mirroring the `POST /cards` FK check)
**When** they:
  1. `POST /rules` with `{ board_id, name, condition: {...}, target_status: 'done' }`
  2. `GET /rules/:id` for the created rule
  3. `PATCH /rules/:id` with `{ enabled: false }`
  4. `DELETE /rules/:id`
**Then** step 1 returns `201` with the persisted rule (`enabled` defaults to `true` when omitted); step 2 returns `200` with the identical rule; step 3 returns `200` with `enabled: false` and an unchanged `condition`/`target_status`/`board_id`; step 4 returns `204`, and a subsequent `GET /rules/:id` returns `404`

#### AC-HAPPY-2: A satisfied rule condition automatically moves the card to the target status
**Priority**: MUST
**Given** an enabled rule on board B whose condition matches a card's status after an update, with a `target_status` different from that matched status
**When** a client issues `PATCH /cards/:id` on a card on board B such that the update satisfies the rule's condition (the existing FEAT-003 status-change path in `src/cards/cards.routes.ts`)
**Then** the manually-requested transition is persisted and captured as a `card_activity` row (`triggered_by: 'manual'`, existing FEAT-005 behavior); the engine then evaluates the card's new state against board B's enabled rules, finds the match, and issues a further status update to the rule's `target_status`; the `PATCH /cards/:id` HTTP response body reflects the card's **final** status (not merely the client-requested one); a second `card_activity` row is persisted for the rule-driven transition, tagged `triggered_by: 'rule'` with `rule_id` set to the matched rule

#### AC-ERROR-1: Cyclic or runaway rule chains are bounded and surfaced, not looped forever
**Priority**: MUST
**Given** a board whose enabled rules form a cycle (e.g. Rule A moves `in_progress → done`, Rule B moves `done → in_progress`)
**When** a `PATCH /cards/:id` transition satisfies Rule A's condition and the engine begins auto-moving the card
**Then** the evaluation engine detects the repeat within a single evaluation pass and halts after a bounded number of hops rather than looping indefinitely; the card is left at the last status the engine successfully applied (not rolled back, not left mid-transition); the halt is logged server-side as `log('error', 'rules.cycle_detected', { code: 'RULE_CYCLE_DETECTED', card_id, board_id, hops, last_status })` so the condition is surfaced in operational logs rather than silently dropped; the triggering `PATCH /cards/:id` still returns `200` with the card's last-applied state — one board's misconfigured rules never turn into a hung request or a `500` for the caller
**And** the concrete bound value and detection strategy (max-hop counter vs visited-status set vs visited-rule-id set) are the creative phase's decision (see Creative Exploration); the bound MUST be a small fixed constant, not per-rule configurable, to protect the `productBrief.md` p95<200ms budget under synchronous evaluation

#### AC-ERROR-2: Invalid rule definitions are rejected with coded validation errors
**Priority**: MUST
**Given** a client submitting `POST /rules` or `PATCH /rules/:id`
**When** the body is malformed
**Then** the response is `400` with body `{ code: 'INVALID_RULE', message: 'Validation failed', details: [{ field, error }] }` (the coded envelope defined in the Error Code Catalog above; the hand-rolled field checks mirror `cards.validation.ts`), with these **exact** field-level `error` strings:
  - non-object body → `details: [{ field: 'body', error: 'request body must be a JSON object' }]`
  - missing/blank/oversized `name` → `'name must be a string'` · `'name must not be blank'` · `'name must be at most 120 characters'` (120 matches `boards.name`)
  - bad `board_id` (POST only; positive-integer rule) → `'board_id must be a positive integer'`
  - `board_id` present on `PATCH /rules/:id` (immutable, mirrors `UpdateCardInput`) → `'board_id cannot be changed after creation'`
  - `target_status` missing or outside the enum → `'target_status must be one of: todo, in_progress, done'` (reuses the `CARD_STATUSES` list / same message style as `checkStatus`)
  - `enabled` present but non-boolean → `'enabled must be a boolean'`
  - `webhook_url` present but not a string / not an absolute `http(s)` URL / over 2048 chars → `'webhook_url must be a string'` · `'webhook_url must be an absolute http(s) URL'` · `'webhook_url must be at most 2048 characters'` (a `null` `webhook_url` is valid and disables delivery; SSRF hardening — whether to also reject private/loopback hosts — is flagged in Creative Exploration and MUST be decided before Phase 3 build)
  - missing/malformed `condition` → `'condition is required'` / `'condition must be a valid rule condition'` (**the per-operator/per-field `condition` `error` strings are pending the creative phase's schema decision — see Creative Exploration; they follow the same `{ field, error }` style once the schema is frozen, e.g. `condition.field`, `condition.operator`**)
**And** a well-formed `board_id` that references no board returns `400 { code: 'BOARD_NOT_FOUND', message: 'board_id does not reference an existing board' }` via the app-level FK check (`boardsRepo.findById`, mirroring `POST /cards`) — never a raw `500` from a Postgres FK violation
**And** `GET`/`PATCH`/`DELETE /rules/:id` for a missing or malformed id returns `404 { code: 'RULE_NOT_FOUND', message: 'Rule not found' }`

#### AC-ERROR-3: Rule-engine execution failures are fail-safe and never break the card write
**Priority**: MUST
**Given** an enabled rule matches during a `PATCH /cards/:id` auto-move, but the engine's own work throws (e.g. the rule-driven `cardsRepo.update` or `activityRepo.record` rejects because the DB is briefly unreachable)
**When** the engine runs inside the card PATCH handler (`src/cards/cards.routes.ts`, immediately after the FEAT-005 activity-capture block)
**Then** the failure is caught and logged as a structured event `log('error', 'rules.execution_failed', { code: 'RULE_EXECUTION_FAILED', card_id, board_id, rule_id, message })` — mirroring the existing `activity.capture.error` try/catch in the same handler — and the **originating** card update (the client-requested transition and its `triggered_by: 'manual'` activity row) is still persisted and returned as `200`; the automation's failure never converts the caller's successful PATCH into a `500`. Any auto-move hops already applied before the throw remain persisted (no rollback — consistent with AC-ERROR-1 / AC-ASYNC-2)

#### AC-ASYNC-1: An automated move is visible in the realtime activity feed, distinguishable from a manual move
**Priority**: MUST
**Given** a client connected to `GET /activity/stream?board_id=` (the FEAT-005 SSE feed, `src/activity/activity.routes.ts`)
**When** a rule auto-moves a card as in AC-HAPPY-2
**Then** the client receives the automated transition as a pushed activity event within the feed's existing latency/heartbeat envelope (no polling, no new transport); the event carries `triggered_by: 'rule'` and `rule_id` (absent or `'manual'` on ordinarily-captured events), so the feed — or any future consumer — can render or filter automated moves distinctly from manual ones

#### AC-ASYNC-2: Multi-hop auto-moves expose each intermediate state; partial progress is not rolled back
**Priority**: SHOULD
**Given** a chain of enabled rules on a board that legitimately moves a card through more than one hop in a single evaluation pass (e.g. Rule A: `todo → in_progress`, then Rule B: `in_progress → done`)
**When** the engine applies the chain synchronously inside `PATCH /cards/:id`
**Then** each hop is persisted and emitted as its **own** `card_activity`/`ActivityEvent` (`triggered_by: 'rule'`, `rule_id` set to the rule that drove that hop) via the reused `ActivityEmitter.emit` (FEAT-005) — so the intermediate status (`in_progress`) is observable in the feed as a distinct event, not swallowed into a single final transition — and the `PATCH /cards/:id` response reflects only the terminal status (`done`)
**And** there is **no rollback semantics**: this feature deliberately does NOT wrap the chain in a transaction — if a later hop fails or the cycle guard trips (AC-ERROR-1/AC-ERROR-3), the earlier hops that were already committed **stay committed** and their activity rows remain in the feed. (Rationale: the codebase has no cross-repository transaction/unit-of-work pattern today; `cards.repository.ts` commits each `update()` atomically on its own. Introducing distributed rollback across hops is explicitly out of scope — flagged here so the absence is a documented decision, not an oversight. The API contract is last-write-wins per hop.)

#### AC-HAPPY-3: A firing rule with a webhook URL delivers a JSON payload and records the delivery
**Priority**: MUST
**Given** an enabled rule on board B with a non-null `webhook_url` whose condition matches a card after an update (so the rule fires an auto-move per AC-HAPPY-2), and a webhook endpoint that responds `2xx`
**When** the rule fires during `PATCH /cards/:id`
**Then**:
  - a `trigger_executions` row (`status:'executed'`) and a linked `webhook_deliveries` row are created **synchronously** at fire time, the delivery in status `pending` (`attempts:0`) — both immediately queryable via `GET /trigger-executions` / `GET /webhook-deliveries`
  - the outbound `POST {webhook_url}` is dispatched **asynchronously, off the request path**, with header `Content-Type: application/json` and body:
    ```json
    { "event": "rule.triggered", "rule_id": 12, "board_id": 3, "card_id": 45,
      "card_title": "Ship v1", "from_status": "in_progress", "to_status": "done",
      "triggered_by": "rule", "occurred_at": "2026-07-15T10:04:12.512Z" }
    ```
  - on the `2xx` the delivery transitions to `delivered` with `attempts` incremented, `last_status_code` set, and `delivered_at` stamped
  - **latency**: the triggering `PATCH /cards/:id` response reflects the card's final auto-moved status within the `productBrief.md` p95<200ms budget **regardless** of how slow or unreachable the webhook endpoint is — webhook work is never on the request's critical path (only the two synchronous INSERTs are, bounded by `MAX_HOPS`)
  - the delivery record exposes `{ id, trigger_execution_id, rule_id, url, status, attempts, last_status_code, created_at, updated_at, delivered_at }` on the read endpoints
**And** a firing rule whose `webhook_url` is `null` records the `trigger_executions` row but creates **no** `webhook_deliveries` row (delivery is opt-in)

#### AC-ERROR-4: Webhook delivery failures (non-2xx, timeout, retry exhaustion) are coded, retried, and fail-safe
**Priority**: MUST
**Given** an enabled rule with a `webhook_url` fires, but the endpoint responds non-2xx, or does not respond within `WEBHOOK_TIMEOUT_MS`
**When** the asynchronous dispatcher attempts delivery
**Then**, using the coded `{ code, message, details }` shape — stored as `webhook_deliveries.last_error` and emitted as a structured log, **never** returned to the (already-`200`) `PATCH /cards/:id` caller:
  - a **non-2xx** response records `{ code: 'WEBHOOK_NON_2XX', message: 'Webhook returned a non-2xx status', details: [{ field: 'status', error: '<code> is not 2xx' }] }`, sets `last_status_code`, increments `attempts`; if attempts remain the delivery is left `failed` and a **retry is scheduled**
  - a **timeout** records `{ code: 'WEBHOOK_TIMEOUT', message: 'Webhook request timed out', details: [{ field: 'timeout', error: 'no response within {WEBHOOK_TIMEOUT_MS}ms' }] }`, increments `attempts`, and retries if attempts remain
  - the dispatcher retries **up to `WEBHOOK_MAX_ATTEMPTS` (default 3, configurable)** total attempts; when the final attempt still fails, the delivery transitions to `exhausted` with `{ code: 'WEBHOOK_EXHAUSTED', message: 'Webhook delivery exhausted after N attempts', details: [{ field: 'attempts', error: 'N of N attempts failed' }] }` and a `rules.webhook_exhausted` error log
  - throughout, delivery is **fail-safe** (mirrors the AC-ERROR-3 engine posture): a failing/exhausted webhook never crashes the process, never rolls back the auto-move (the card stays moved, the `trigger_executions` row stays `executed`), and never converts the caller's `PATCH /cards/:id` into an error
**And** a `POST`/`PATCH /rules` with a malformed `webhook_url` is rejected synchronously at validation with `400 { code: 'INVALID_RULE', ..., details: [{ field: 'webhook_url', error: 'webhook_url must be an absolute http(s) URL' }] }` — a bad URL never reaches the dispatcher
**And** the concrete **timeout value, retry backoff strategy, and the async retry mechanism** (in-process `setTimeout` fire-and-forget vs a re-drivable DB-backed sweep; behavior of in-flight `pending`/`failed` deliveries across a process restart) are the **webhook creative phase's** decision — the codebase has no queue/scheduler pattern to mirror (see Creative Exploration)

#### AC-ASYNC-3: A webhook delivery moves through a tracked `pending → delivered | failed → exhausted` lifecycle, separate from trigger-execution status
**Priority**: MUST
**Given** a `webhook_deliveries` row created when a rule with a `webhook_url` fires
**When** the dispatcher processes it
**Then** the delivery's `status` progresses through a well-defined lifecycle, tracked **separately from** `trigger_executions.status` (the product requirement):
  - initial `pending` (created synchronously at fire time, `attempts:0`)
  - on a `2xx`: `pending | failed → delivered` (terminal success; `delivered_at` set)
  - on a failed attempt with retries remaining: `pending → failed` (retry scheduled)
  - on the final failed attempt: `failed → exhausted` (terminal failure)
  - `delivered` and `exhausted` are **terminal** — no further attempts
**And** the trigger's execution status (`trigger_executions.status`) reflects only whether the auto-move applied (`executed`/`failed`) and is **not** mutated by the webhook outcome — a card can be `executed` while its webhook is still `pending`, `failed`, or `exhausted`; the two statuses are queryable via the two distinct read endpoints
**And** each terminal transition is observable via `GET /webhook-deliveries` (this iteration adds **no** realtime SSE push for deliveries — the FEAT-005 activity feed continues to carry only the auto-move events per AC-ASYNC-1; a live delivery feed is a possible future enhancement, out of scope here)

### Scope Boundaries
- **In scope**: Board-scoped automation-rule persistence (`automation_rules` table, incl. optional `webhook_url`); rule CRUD REST endpoints (`POST/GET/GET-by-id/PATCH/DELETE /rules`) with validation and the FK-existence check pattern; a synchronous-with-bound evaluation engine triggered from the existing `PATCH /cards/:id` path; cycle/loop prevention (bounded, terminating pass); tagging `card_activity` rows with `triggered_by`/`rule_id` so automated moves are distinguishable from manual ones in the existing FEAT-005 feed; **trigger-execution logging (`trigger_executions`)**; **optional asynchronous webhook delivery with bounded retry (`webhook_deliveries` + a `WebhookDispatcher` seam), delivery status tracked separately from trigger-execution status**; **read endpoints (`GET /trigger-executions`, `GET /webhook-deliveries`)**; **a Board Settings → Automation tab in the existing React frontend** (rule create/list/toggle/delete + execution/delivery history).
- **Out of scope**: trigger→action macros beyond a single condition → single target-status action; SLA/time-based (clock-driven/polling) automations — e.g. "due date passes" as a standalone trigger requires a scheduler and is NOT built here, even though the roadmap's illustrative description mentions it; compound/boolean (AND/OR) condition composition (a design question flagged below, not assumed available); **a realtime SSE push feed for webhook deliveries** (deliveries are polled via `GET /webhook-deliveries`; the FEAT-005 feed carries only auto-move events); **manual delivery re-send / retry endpoints** (retries are automatic and bounded only); any RBAC/permission gate on who may manage rules or view the Automation tab (matches the current no-RBAC posture of `boards`/`cards`).
  - **Previously out of scope, NOW IN scope (product addition 2026-07-15):** a rule-management UI (was "explicitly excluded per the task description" — now Phase 4) and webhook delivery (now Phases 1–3). This is a deliberate scope reversal, not an oversight — flagged so the change is traceable.
- **Dependencies**: FEAT-003 (Card CRUD API, complete — `PATCH /cards/:id` is the evaluation trigger; `cards.status` is the field rules act on); FEAT-002 (Board CRUD API — status is `planned` in the roadmap, but `src/boards/` is already implemented and used by FEAT-003, so this dependency is satisfied in practice, matching the same note already recorded against FEAT-003); FEAT-005 (Realtime Activity Feed, complete — `ActivityRepository`/`ActivityEmitter` are reused as-is for automated-move fan-out); FEAT-001 (foundation — app factory, `pg` pool, logger).
- **NFR implications**: Performance (`productBrief.md` — API p95 < 200ms, p99 < 500ms) directly constrains the loop-prevention bound: an unbounded or high-hop-count rule chain evaluated synchronously inside `PATCH /cards/:id` would blow the latency budget, so the bound must be small and fixed (not user-configurable per rule). **The same budget is why webhook delivery MUST be asynchronous/off-path** — a slow or unreachable endpoint must never be able to add its latency (up to `WEBHOOK_TIMEOUT_MS` × retries) to the card PATCH. Security/RBAC: no new RBAC exposure — but **`webhook_url` is a new outbound-request surface controlled by user input → SSRF risk** (a rule could point the server at internal/metadata endpoints). Validation MUST require an absolute `http(s)` URL; whether to additionally block private/loopback/link-local ranges (or use an allowlist) is a **security decision flagged for the webhook creative phase**, not silently deferred. Availability: rule evaluation AND webhook delivery failures must be fail-safe (logged, never crash the process or fail the underlying card PATCH), mirroring the existing activity-capture try/catch in `cards.routes.ts`. Config (12-factor): webhook timeout / max-attempts / backoff are configurable via **new env vars** (`WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_RETRY_BACKOFF_MS`) — a deliberate departure from the auto-move core's "no new env vars" directive, justified by the 12-factor "no hardcoded values" rule for timeouts/retries.

### Creative Exploration Needed

> The four **auto-move** items below are **RESOLVED** — see *Frozen Creative Decisions*
> and the two completed creative docs. The **webhook + UI** items are **OPEN** (product
> addition 2026-07-15) and gate Phases 3–4.

**OPEN (webhook delivery + UI — new creative required before Phases 3–4):**
- **Webhook async delivery + retry mechanism (LOW confidence)**: The codebase has **no queue, scheduler, background-worker, or outbound-HTTP-client pattern** to mirror (Node 20's global `fetch` + `AbortController` can serve the HTTP call with no new dependency). Open questions: in-process `setTimeout` fire-and-forget retries vs a re-drivable DB-backed sweep; the concrete `WEBHOOK_TIMEOUT_MS` / `WEBHOOK_MAX_ATTEMPTS` / backoff (fixed vs exponential) defaults; and **process-restart durability** — a `pending`/`failed` delivery held only in an in-memory timer is lost on restart unless re-driven from the `webhook_deliveries` table. Needs the creative-architecture-agent (delivery mechanism + `WebhookDispatcher` seam placement) and creative-algorithm-agent (retry/backoff schedule).
- **`webhook_deliveries.payload` storage shape (LOW confidence)**: TEXT-serialized JSON vs re-derived-on-read vs (rejected precedent) JSONB. JSONB was deliberately rejected for `condition`; do not reintroduce it for the payload blob without an explicit architecture decision.
- **Webhook `WebhookDispatcher` module boundary (LOW confidence)**: a new `src/webhooks/` module (owning `trigger_executions` + `webhook_deliveries` + the dispatcher + the two read routes) vs folding into `src/rules/`. Default proposal: `src/webhooks/` mirroring the `boards`/`cards`/`activity` layout; confirm in creative.
- **`webhook_url` SSRF hardening (SECURITY — LOW confidence)**: beyond "absolute `http(s)` URL", whether to block private/loopback/link-local/metadata ranges or use an allowlist. A security decision — MUST be made (even if the decision is "documented acceptance for an internal-only MVP") before Phase 3 build, not silently skipped.
- **Automation-tab UI/UX (LOW confidence)**: the Board Settings entry point, the rule-creation form, the rule list (enable/disable/delete affordances), and the execution/delivery history views (empty/error/loading states, how a `webhook_url` and its last delivery status are surfaced). Needs the creative-uiux-agent against `ux-patterns.md` and the existing `frontend/` components.

**RESOLVED (auto-move core — frozen; retained for context):**
- **Condition/action schema shape (LOW confidence)**: The roadmap AC only specifies "a condition and a target-status action." Open questions: which card fields are eligible in a condition (status only, or also `title`/`description`/`due_date`?), what operators are supported (equality only, or comparisons for `due_date`?), whether a rule supports a single predicate or a compound AND/OR set, and whether `condition` is stored as a single `JSONB` column (first use of JSONB in this codebase — no existing pattern to mirror) or normalized typed columns. Needs the creative-algorithm-agent (or architecture-agent, for the storage-shape half) before implementation.
- **Loop-prevention algorithm and bound (LOW confidence)**: Candidate approaches — a fixed max-hop counter per evaluation pass, a visited-rule-id set, or a visited-status set — each with different tradeoffs (a visited-status set is stricter but could falsely block a legitimate multi-hop chain that revisits a status via a different rule). The concrete bound value and detection strategy need design exploration; this is exactly the class of decision the creative-algorithm-agent should own.
- **Evaluation timing (MEDIUM/LOW confidence)**: This spec assumes synchronous evaluation inside the `PATCH /cards/:id` request/response cycle (so the response reflects the final post-automation status), consistent with the codebase's existing preference for atomic, race-free round-trips (see `cards.repository.ts`'s `update()`). A deferred/async model (evaluate after responding, push the final state only via the activity feed) is a viable alternative that would relax the latency coupling called out in NFR implications, but changes the Success Criteria's "user sees" contract — needs an explicit decision before Test Strategy is written.
- **Rule-match ambiguity (LOW confidence, not yet an AC)**: If more than one enabled rule on the same board matches a card's state simultaneously, is that a validation-time conflict (reject at `POST`/`PATCH /rules`), a runtime "first match wins" policy, or an error state? Not addressed by the roadmap AC; flagged for creative or an explicit human decision before build.

## User Journey Definition

**Feature Type**: End-User Feature
**Creative Phase Required**: Yes — see "Creative Exploration Needed" in the `## Specification` section above (condition/action schema, loop-prevention algorithm, evaluation timing).

### Acceptance Criteria (from FEAT-006 — refined during spec)
- AC: Automation rules can be created, listed, updated, and deleted, each scoped to a board, with a condition and a target-status action
- AC: When a card's state changes such that a rule's condition is satisfied, the engine automatically transitions the card to the rule's target status
- AC: The evaluation engine is guarded against infinite loops and cyclic rules (a bounded, terminating pass)
- AC: Automated moves are recorded in the activity feed (reusing FEAT-005) and are distinguishable from manual moves
- AC: Invalid rule definitions are rejected with clear validation errors (400)
- AC: Rules and the engine are covered by automated tests (condition matched / not matched, loop prevention, disabled-rule no-op)
- AC (product addition 2026-07-15): A trigger may optionally POST a JSON payload to a `webhook_url` when it fires, retrying up to 3 times on failure, with delivery status tracked separately from trigger-execution status
- AC (product addition 2026-07-15): A Board Settings → Automation tab lets a board owner create/list/toggle/delete rules and view execution + delivery history

*Refined into concrete Given/When/Then acceptance criteria in the `## Specification` section above (AC-ENTRY-1, AC-HAPPY-1/2/**3**, AC-ERROR-1/2/**4**, AC-ASYNC-1/2/**3**). **Note**: these two product-addition ACs are not yet reflected in `memory-bank/roadmap.md`'s FEAT-006 entry — updating the roadmap AC list is a recommended follow-up for full traceability.*

## Test Strategy

### Approach
- **Emphasis**: Integration-first via Supertest against `createApp(deps)` with injected stub repositories — matches the project convention (`systemPatterns.md` Testing Patterns; no live DB in tests). Pure-unit tests reserved for the pieces that are pure logic: `rules.validation`, the `rules.engine` evaluation/loop-prevention algorithm, and the `WebhookDispatcher` (retry/lifecycle state machine, with `fetch` stubbed — no real network in tests). Frontend (Phase 4) tests use the existing React Testing Library + Vitest setup (`frontend/`, mirroring `BoardListPage.test.tsx`/`ActivityFeed.test.tsx`).
- **Target test count**: ~55 total across all phases (up from ~30 for the auto-move core; the product addition roughly doubles the surface — webhook dispatcher + two new tables + two read endpoints + a UI panel). Justification for the upper end: the evaluation engine's loop/cycle guard **and** the webhook retry/lifecycle state machine are the two highest-risk pieces of logic and each warrants dedicated unit coverage; the async, fail-safe dispatcher especially needs deterministic (stubbed-`fetch`, stubbed-timer) tests.

### File Organization
- **New test files** (co-located, `<unit>.test.ts`):
  - `src/rules/rules.validation.test.ts` — create/update body validation, `target_status` enum, condition-shape validation, **`webhook_url` validation (valid absolute http(s) / `null` / non-string / bad-scheme / over-length)**, self-loop rejection
  - `src/rules/rules.repository.test.ts` — persistence mapping incl. `webhook_url` (against a stub/faked `pg` query layer, mirroring `cards.repository.test.ts`)
  - `src/rules/rules.routes.test.ts` — the 5 CRUD endpoints incl. FK-existence 400 and 404s and `webhook_url` create/update/null (Supertest)
  - `src/rules/rules.engine.test.ts` — condition matched / not matched, disabled-rule no-op, bounded loop/cycle prevention, fail-safe on evaluation error, **`trigger_executions` row recorded per firing, and the `WebhookDispatcher` seam invoked exactly when `webhook_url` is set (via a stub dispatcher)**
  - **`src/webhooks/webhooks.repository.test.ts`** — `trigger_executions` + `webhook_deliveries` persistence + lifecycle transitions (`pending → delivered`, `pending → failed → exhausted`), `last_error`/`last_status_code`/`delivered_at` mapping
  - **`src/webhooks/webhooks.routes.test.ts`** — `GET /trigger-executions` and `GET /webhook-deliveries` (filters, `error` projection of `last_error`, 404 on `/webhook-deliveries/:id`) (Supertest)
  - **`src/webhooks/webhooks.dispatcher.test.ts`** — the dispatcher state machine with **stubbed `fetch` + stubbed timers**: 2xx → `delivered`; non-2xx → `failed` + retry then `delivered`; timeout (`AbortController`) → `failed` + retry; all-attempts-fail → `exhausted` with `WEBHOOK_EXHAUSTED`; payload shape + `Content-Type`; **fail-safe** (a thrown `fetch`/DB call never rejects out of the dispatcher, never crashes); `null` `webhook_url` → no delivery row
  - **`frontend/src/pages/BoardViewPage/AutomationTab.test.tsx`** (Phase 4) — rule-creation form submit, rule list render + enable/disable/delete, execution/delivery history render, empty/error/loading states (RTL + Vitest, mirroring `ActivityFeed.test.tsx`)
- **Extend existing**:
  - `src/cards/cards.routes.test.ts` — auto-move integration on `PATCH /cards/:id` (response reflects final status; a `triggered_by:'rule'` activity row is recorded; misconfigured-cycle PATCH still returns 200; **a slow/failing webhook never delays or fails the PATCH response** — assert with a stub engine/dispatcher)
  - `src/activity/activity.repository.test.ts` — `triggered_by`/`rule_id` persist and default to `'manual'`/null
  - `src/app.test.ts` — `/rules`, **`/trigger-executions`, `/webhook-deliveries`** routers are mounted

### What NOT to Test
- `pg` driver / Express internals — framework responsibility (existing convention)
- SSE transport, heartbeat, per-board fan-out — already covered by FEAT-005 (`activity.routes.test.ts`); this feature only adds two fields to the payload
- The DB-level `CHECK`/FK constraints in `004_*.sql` / `005_*.sql` in isolation — behavior is asserted through validation + the app-level FK-existence check (same posture as cards)
- **Real outbound network** — `fetch` is always stubbed in `webhooks.dispatcher.test.ts`; do not hit a live URL. **Wall-clock waits** — retry backoff timers are stubbed (fake timers), never real `setTimeout` sleeps, so tests stay deterministic and fast.

### Per-Phase Test Guidance
- Phase 1 (Data model + CRUD API): ~22 tests — rules validation incl. `webhook_url` + self-loop (≈8), rules repository mapping (≈4), rules routes incl. FK-400/404/204 (≈6), `webhooks` repository (`trigger_executions`/`webhook_deliveries` persistence + read routes ≈4). Covers AC-ENTRY-1, AC-HAPPY-1, AC-ERROR-2.
- Phase 2 (Trigger evaluation engine + PATCH integration + activity distinguishability): ~13 tests — engine unit (match/no-match/disabled/bounded-cycle/fail-safe/`trigger_executions`-recorded/dispatcher-invoked-only-when-`webhook_url`-set ≈8) + cards.routes auto-move integration incl. webhook-never-delays-PATCH (≈5). Covers AC-HAPPY-2, AC-ERROR-1, AC-ASYNC-1/2 (folds the former "Phase 3 — Activity distinguishability" tests: `triggered_by`/`rule_id` persistence + presence on the emitted/streamed event).
- Phase 3 (Webhook delivery + retry): ~12 tests — dispatcher state machine with stubbed `fetch`/timers: success/non-2xx-retry/timeout-retry/exhaustion/payload-shape/fail-safe/lifecycle-transitions + delivery read endpoints. Covers AC-HAPPY-3, AC-ERROR-4, AC-ASYNC-3.
- Phase 4 (UI settings panel): ~8 tests — `AutomationTab` rule form + list toggle/delete + execution/delivery history + empty/error/loading states (RTL). Covers the UI product-addition AC end-to-end.

## Implementation Roadmap

> Phases map to the specification's ACs. **Restructured 2026-07-15** into the four
> product-mandated phases; the original three auto-move phases are **preserved, not
> removed** — the old "Phase 1 Rules CRUD" and "Phase 2 Engine" map onto the new
> Phases 1–2, and the old "Phase 3 Activity distinguishability" is folded into the new
> Phase 2 (the engine is what emits the distinguishable activity). **Phase 1 remains
> gated on the (complete) auto-move creative**; **Phase 3 is gated on the new webhook
> creative** and **Phase 4 on the new UI/UX creative** (see Creative Phases).

- [x] **Phase 1 — Data model + CRUD API** (`automation_rules`, `trigger_executions`, `webhook_deliveries`) — AC-ENTRY-1, AC-HAPPY-1, AC-ERROR-2 ✅ COMPLETE (2026-07-15): migrations 004/005 + src/rules/ + src/webhooks/ read routes; 181/181 tests pass, tsc clean
  - `db/init/004_automation_rules.sql`: `automation_rules` table (board-scoped FK `ON DELETE CASCADE`, normalized `condition_field/operator/value` CHECKs, `target_status` CHECK matching `cards.status`, `enabled` default true, **`webhook_url VARCHAR(2048) NULL`**, timestamps); + the `card_activity` `triggered_by`/`rule_id` ALTER (kept here since the table is created here)
  - `db/init/005_workflow_webhooks.sql`: **`trigger_executions`** table (rule/card/board, from/to status, `status ('executed'|'failed')`) and **`webhook_deliveries`** table (`trigger_execution_id` FK, `rule_id`, `url`, `status ('pending'|'delivered'|'failed'|'exhausted')` default `pending`, `attempts`, `last_status_code`, `last_error`, `payload`, timestamps + `delivered_at`)
  - `src/rules/`: `rules.types.ts`, `rules.validation.ts` (incl. `webhook_url` + self-loop checks), `rules.repository.ts` (`PostgresRulesRepository` + interface, incl. `findEnabledByBoard` ordered `id ASC`), `rules.routes.ts` (`createRulesRouter`, board_id in body, `?board_id=` filter, FK-existence check via `boardsRepo.findById`)
  - `src/webhooks/`: `webhooks.types.ts`, `webhooks.repository.ts` (`TriggerExecutionsRepository` + `WebhookDeliveriesRepository`, or a combined `WebhooksRepository` — boundary confirmed in webhook creative), `webhooks.routes.ts` (`GET /trigger-executions`, `GET /webhook-deliveries`, `GET /webhook-deliveries/:id`)
  - Mount `createRulesRouter` + the webhooks read router in `src/app.ts`; wire repos in `src/server.ts`
- [x] **Phase 2 — Trigger evaluation engine + card PATCH integration + activity distinguishability** (AC-HAPPY-2, AC-ERROR-1, AC-ERROR-3, AC-ASYNC-1, AC-ASYNC-2) ✅ COMPLETE (2026-07-15): CardRuleEngine (visited-status Set, MAX_HOPS=3, first-match, fail-safe), per-hop trigger_executions + activity triggered_by/rule_id, PATCH integration, NoopWebhookDispatcher seam; 203/203 tests, tsc clean
  - `src/rules/rules.engine.ts`: evaluate a card's post-update state against the board's enabled rules; apply the target-status move; **bounded, terminating** pass (visited-status `Set` + `MAX_HOPS=3`, first-match-wins by `id`, per frozen algorithm); fail-safe (log + never crash/500 the card PATCH, mirroring the activity try/catch); **record a `trigger_executions` row per firing**, and **hand each `webhook_url`-bearing firing to the injected `WebhookDispatcher`** (the dispatcher creates the `pending` delivery row synchronously; the POST is Phase 3)
  - `RecordActivityInput` + `ActivityRepository.record` gain `triggered_by`/`rule_id`; manual call site tags `'manual'`; ensure `triggered_by`/`rule_id` flow through `ActivityEmitter` → SSE payload (folds the former Phase 3 — activity distinguishability, verified end-to-end)
  - Hook `ruleEngine` into `PATCH /cards/:id` (`src/cards/cards.routes.ts`) after the FEAT-005 capture block; response reflects final status; a slow/failing webhook must not delay it
- [x] **Phase 3 — Webhook delivery + retry** (AC-HAPPY-3, AC-ERROR-4, AC-ASYNC-3) ✅ COMPLETE (2026-07-15): HttpWebhookDispatcher (fetch + AbortController, 3 attempts, 30s backoff, pending→delivered|failed→exhausted, coded errors, fully fail-safe), env config, wired into engine; +13 dispatcher tests (216/216), tsc clean
  - `src/webhooks/webhooks.dispatcher.ts`: the injected **`WebhookDispatcher`** seam (mirrors `ActivityEmitter`/`RuleEngine`) — creates the `pending` `webhook_deliveries` row synchronously, then performs the outbound `POST` (Node `fetch` + `AbortController` timeout, no new dependency) + bounded retries **asynchronously, off the request path**; drives the `pending → delivered | failed → exhausted` lifecycle; internally fail-safe (never throws out, never crashes the process, never fails the card write)
  - Retry/backoff schedule + `WEBHOOK_TIMEOUT_MS`/`WEBHOOK_MAX_ATTEMPTS`/`WEBHOOK_RETRY_BACKOFF_MS` env config (`src/config/env.ts`); structured logs `rules.webhook_failed` / `rules.webhook_exhausted`
  - Construct the dispatcher in `server.ts`, add to `AppDeps`, inject into `CardRuleEngine`
- [x] **Phase 4 — UI settings panel** (Board Settings → Automation tab) ✅ COMPLETE (2026-07-15): route /boards/:id/automation, mutation seam in api/client.ts, RuleForm w/ coded-error mapping, role="switch" optimistic toggle, role="alertdialog" ConfirmDialog, master-detail history w/ delivery badges; +65 frontend tests (100/100), tsc --noEmit clean, vite build OK
  - `frontend/src/`: an Automation tab reached from Board Settings on `BoardViewPage` — rule-creation form (name, condition status, target status, optional `webhook_url`, enabled toggle), per-board rule list (enable/disable/delete), and read-only execution + delivery history (`GET /trigger-executions` / `GET /webhook-deliveries`)
  - Reuse existing frontend patterns/components (`ActivityFeed`, `EmptyState`/`ErrorState`/`Loading`); wire an API client alongside the existing board/card/activity fetches
- [ ] **Test coverage** woven into each phase per the Test Strategy above (not a trailing phase)

### Observability
- **Applies**: Yes (service code on the request path + the async dispatcher). Reuse the existing structured `logger` (`src/config/logger.ts`). Auto-move: `rules.applied` (info), `rules.cycle_detected` / `rules.execution_failed` (error). Webhook: `rules.webhook_failed` (per failed attempt) and `rules.webhook_exhausted` (terminal) as error events carrying the coded `{code,...}`. **New env vars** for webhook config: `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_RETRY_BACKOFF_MS` (the auto-move core adds none). No OTEL beyond the existing `LOG_*` set. **Do not log the webhook payload body or full URL query if it could carry secrets** — log `rule_id`/`delivery_id`/`status_code` only.

### API Requirements — REST
- **Involves REST API**: Yes. New endpoints: `POST /rules`, `GET /rules` (`?board_id=`), `GET /rules/:id`, `PATCH /rules/:id`, `DELETE /rules/:id` (all supporting the optional `webhook_url`), plus read-only `GET /trigger-executions` (`?board_id=`/`?rule_id=`) and `GET /webhook-deliveries` (`?rule_id=`/`?trigger_execution_id=`/`?status=`) + `GET /webhook-deliveries/:id`. Behavior/response conventions mirror `src/cards/cards.routes.ts`. No OpenAPI spec exists in-repo today; document endpoints in `README.md` (matches how boards/cards/activity are documented).

### Dependencies & Risks
- **Risk**: synchronous in-request evaluation could breach the p95<200ms budget on long rule chains → **Mitigation**: small fixed hop bound (not per-rule configurable); decided in creative (FROZEN: `MAX_HOPS=3`).
- **Risk (RESOLVED)**: `JSONB` had no in-repo pattern → **Resolved**: normalized `condition_*` columns (frozen); do NOT reintroduce JSONB for `webhook_deliveries.payload` without a fresh decision.
- **Risk (RESOLVED)**: multiple rules matching the same card state → **Resolved**: first-match-wins by lowest `id` (frozen).
- **Risk (NEW)**: webhook delivery on the request path would blow the latency budget → **Mitigation**: asynchronous off-path dispatcher; only two synchronous INSERTs remain on-path (bounded by `MAX_HOPS`). Decide the async mechanism in webhook creative.
- **Risk (NEW)**: no queue/scheduler/outbound-HTTP pattern exists → an in-memory `setTimeout` retry loses `pending`/`failed` deliveries on process restart → **Mitigation**: webhook creative decides durability (accept-and-document vs a DB-backed re-drive sweep).
- **Risk (NEW, SECURITY)**: user-supplied `webhook_url` is an SSRF vector → **Mitigation**: validate absolute `http(s)`; decide private/loopback/metadata blocking (or documented acceptance) in webhook creative before Phase 3.
- **Risk (NEW)**: Phase 4 UI reverses the prior "no UI" boundary and depends on `frontend/` conventions → **Mitigation**: UI/UX creative against `ux-patterns.md` + existing components before Phase 4.

## Creative Phases

Level 3 with LOW-confidence spec fields → **creative REQUIRED**. All FIVE creative
sub-phases are COMPLETE (2026-07-15): the two auto-move phases, plus the three added
by the 2026-07-15 webhook+UI product addition. Build gate is unblocked for all phases.

Auto-move core (COMPLETE):
- [x] **Architecture Design** (`creative-architecture-agent`) → COMPLETE — `memory-bank/creative/TASK-006-card-workflow-automation-architecture.md`
- [x] **Algorithm Design** (`creative-algorithm-agent`) → COMPLETE — `memory-bank/creative/TASK-006-card-workflow-automation-algorithm.md`

Webhook + UI addition (COMPLETE 2026-07-15):
- [x] **Webhook Architecture Design** (`creative-architecture-agent`) → COMPLETE — `memory-bank/creative/TASK-006-webhook-architecture.md`
- [x] **Webhook Retry Algorithm Design** (`creative-algorithm-agent`) → COMPLETE — `memory-bank/creative/TASK-006-webhook-retry-algorithm.md`
- [x] **Automation-tab UI/UX Design** (`creative-uiux-agent`) → COMPLETE — `memory-bank/creative/TASK-006-automation-ui-uiux.md`

### Frozen Webhook + UI Decisions (build against these)
- **Async mechanism**: engine synchronously records the `trigger_executions` row per firing (on-path, bounded by `MAX_HOPS`) and, only when `webhook_url` is set, creates the `pending` `webhook_deliveries` row; then a **fire-and-forget `WebhookDispatcher.dispatch()` (returns `void`)** runs the POST + `setTimeout(30s)` retries OFF-path. DB row is source of truth; zero network latency on the card PATCH.
- **Retry state machine**: re-entrant `deliver(deliveryId)` — 1 `fetch` per call, `attempts := attempts+1`; 2xx→`delivered`; failure with `attempts<3`→`failed`+arm 30s retry; `attempts==3`→`exhausted`. **3 total attempts (1+2 retries)**; timeline t=0/30s/60s. `AbortController` 5s timeout; non-2xx→`WEBHOOK_NON_2XX`, timeout/network→`WEBHOOK_TIMEOUT`, terminal→`WEBHOOK_EXHAUSTED`. Payload built ONCE at fire time, byte-stable across attempts (`occurred_at` never drifts); at-least-once, receivers dedupe.
- **Storage**: `payload TEXT NOT NULL` (`JSON.stringify` snapshot); JSONB rejected. Migration `db/init/005_workflow_webhooks.sql`.
- **Module/seam**: new `src/webhooks/` (`webhooks.types.ts`, `webhooks.repository.ts` = combined `WebhooksRepository`, `webhooks.dispatcher.ts`, `webhooks.routes.ts` — read-only, no validation file). `WebhookDispatcher` mirrors `ActivityEmitter`, constructed in `server.ts`, injected into `CardRuleEngine` (which also gains `webhooksRepo`). `webhooksRepo` in `AppDeps`; dispatcher is engine-internal.
- **SSRF**: absolute `http(s)` only (`400 INVALID_RULE`); private/loopback/metadata ranges NOT blocked — **documented ACCEPTED RISK** (internal-trusted-users MVP); range-block is a non-breaking future path.
- **Restart durability**: in-flight retry timers lost on restart — accepted MVP limitation; startup re-drive of non-terminal deliveries provisioned (`webhook_deliveries_status_idx` + `findNonTerminalDeliveries`) but NOT built.
- **Config (new env vars)**: `WEBHOOK_TIMEOUT_MS`=5000, `WEBHOOK_MAX_ATTEMPTS`=3, `WEBHOOK_RETRY_BACKOFF_MS`=30000; Node global `fetch` + `AbortController`, no new dependency; timers `.unref()`; logs `rules.webhook_delivered`/`webhook_failed`/`webhook_exhausted` (never log payload body/URL query).
- **UI**: route `/boards/:id/automation` via a Board/Automation nav on `BoardHeader`; new mutation seam `mutateJson`/`MutationResult`/`CodedError` in `frontend/src/api/client.ts` (SPA is GET-only today); `RuleForm` mirrors coded errors inline; `role="switch"` optimistic toggle; hand-rolled `role="alertdialog"` `ConfirmDialog` (NOT `window.confirm`); master-detail history via `useApiResource` + manual Refresh (no delivery SSE); `useRules(boardId)` hook mirrors `useActivityStream` discipline.

### Frozen Creative Decisions (build against these)
- **Condition storage**: normalized typed columns `condition_field` / `condition_operator` / `condition_value` (each `VARCHAR` + `CHECK`), exposed on the wire as nested `condition: { field, operator, value }` via a `toRule()` projection. **Not JSONB** (rejected as a premature first-in-codebase precedent; simplicity-first).
- **Canonical condition model (FROZEN)**: `{ field: 'status', operator: 'eq', value: <'todo'|'in_progress'|'done'> }`. Match: `card.status === condition.value`; applied move sets card to `rule.target_status`. `field`/`operator` are single-value enums now, additively wideable later.
- **Evaluation timing**: **synchronous**, in the `PATCH /cards/:id` request/response cycle — the response reflects the card's FINAL post-automation status (confirms the spec).
- **Engine placement**: injected `CardRuleEngine` seam (mirrors the `ActivityEmitter` idiom), constructed in `server.ts`, added to `AppDeps`, threaded into `createCardsRouter`, invoked inside the existing `previousStatus !== card.status` gate after the FEAT-005 capture block. Reuses the repository layer directly (no HTTP re-entrancy); internally fail-safe — never throws, logs and returns last-applied card.
- **Cycle detection**: **visited-status `Set<CardStatus>`** (seed with the card's post-update status; refuse a `target_status` already visited — trips BEFORE applying the looping hop, so no bogus activity row), backed by a defensive **`MAX_HOPS = CARD_STATUSES.length = 3`** compile-time ceiling. On trip: log `rules.cycle_detected` (code `RULE_CYCLE_DETECTED`), return last-applied, still 200.
- **Match ambiguity**: **first-match-wins by lowest `id`** (`findEnabledByBoard` returns `ORDER BY id ASC`); runtime policy, no cross-row validation pattern introduced.
- **Self-loop** (`condition.value === target_status`): rejected at rule validation (`INVALID_RULE`, single-rule static check); runtime visited-status detector no-ops it as a backstop.
- **Deviation flagged**: no OTEL/metrics/tracing section adopted (codebase has only the minimal `log()` structured logger; consistent with the plan's "no new OTEL/env vars" directive). No deviation from systemPatterns.md Guiding Principles.

---

## Execution State

**Build Status**: COMPLETE (all 4 phases)
**Current Phase**: BUILD_COMPLETE — 4 of 4 phases done
**Current Step**: Phase 4 (Automation-tab UI) done & verified (frontend 100/100, tsc --noEmit clean, vite build OK, committed). ALL PHASES COMPLETE.
**Last Completed**: BUILD Phase 4 — Automation tab (route, mutation seam, RuleForm, optimistic toggle, ConfirmDialog, history + delivery badges); +65 frontend tests
**Can Resume**: NO (build finished)
**Totals**: backend 216/216 tests + frontend 100/100 tests all passing; backend tsc clean; frontend tsc --noEmit clean + vite build OK.
**Next**: /banyan-reflect TASK-006, then /banyan-archive TASK-006.
**Deferred / accepted (documented)**: SSRF = http(s)-only (accepted risk); webhook retry durability across process restart not built (re-drive provisioned via status index + findNonTerminalDeliveries); trigger_executions 'failed' status path not produced by the engine this build; DB-level CHECK/FK constraints exercised via app-level validation, not against a live DB in tests (repo tests stub pg).
**Run parameters (user-decided 2026-07-15)**: autonomous run committing each phase; SSRF = http(s)-validation-only (accepted risk); WEBHOOK_MAX_ATTEMPTS = 3 total.
**Phase 1 note (for Phase 2/3)**: WebhooksRepository method names as implemented — `recordExecution`, `createDelivery`, `updateDelivery`/`markDelivered`/`markFailed`/`markExhausted`, `listTriggerExecutions`, `listDeliveries`, `findDeliveryById`, `findNonTerminalDeliveries`. Engine/dispatcher must consume these exact names.
**Run parameters (user-decided 2026-07-15)**: autonomous run committing each phase; SSRF = http(s)-validation-only (accepted risk); WEBHOOK_MAX_ATTEMPTS = 3 total.

### Active Sub-Agents
- Architecture Design (condition storage + evaluation timing): COMPLETE → memory-bank/creative/TASK-006-card-workflow-automation-architecture.md
- Algorithm Design (loop-prevention + match policy): COMPLETE → memory-bank/creative/TASK-006-card-workflow-automation-algorithm.md

### Completed Steps
- PLAN: spec approved, taxonomy CLEAN, test strategy + roadmap documented
- AC audit: coded error envelope + AC-ERROR-3/AC-ASYNC-2 added
- CREATIVE: Architecture (normalized columns, sync eval, CardRuleEngine seam) + Algorithm (visited-status set, MAX_HOPS=3, first-match-wins, self-loop reject) — both frozen

### Completed Steps
- PLAN: Spec Writer Agent (Sonnet) drafted spec; taxonomy lint CLEAN; human approved as-is; Test Strategy + Implementation Roadmap + Creative Phases documented
