# Architecture Decision: Card Workflow Automation — Webhook Delivery (async mechanism + dispatcher seam + storage + SSRF)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: Architecture
**Task**: TASK-006 / FEAT-006 (Level 3)
**Scope of this doc**: The four decisions this (reopened) architecture sub-phase OWNS for the 2026-07-15 webhook product addition — (1) the **asynchronous delivery mechanism** (how outbound-POST work leaves the `PATCH /cards/:id` request path) and its **process-restart durability** posture, (2) the **`src/webhooks/` module boundary + the injected `WebhookDispatcher` seam** (interface, placement, wiring, engine invocation), (3) the **`webhook_deliveries.payload` storage shape**, and (4) the **`webhook_url` SSRF policy** (a security decision). It explicitly does NOT own the retry **schedule / backoff / lifecycle state-machine transitions** — those belong to the sibling *Webhook Retry Algorithm Design* (`creative-algorithm-agent`), which consumes the mechanism and seam frozen here. It also inherits, unchanged, every frozen decision from the auto-move architecture and algorithm docs (`CardRuleEngine` seam, synchronous evaluation, normalized `condition_*` columns, `MAX_HOPS=3`, first-match-wins).

---

## Context

### System Requirements
- A firing rule (an applied auto-move hop, AC-HAPPY-2) with a non-null `webhook_url` must **POST a JSON payload** to that URL and record the delivery (AC-HAPPY-3).
- The `trigger_executions` row (`status:'executed'`) and, when `webhook_url` is set, the linked `webhook_deliveries` row (`status:'pending'`, `attempts:0`) are created **synchronously at fire time** — both immediately queryable via `GET /trigger-executions` / `GET /webhook-deliveries` (AC-HAPPY-3).
- The outbound POST + bounded retries happen **asynchronously, off the request path**: the triggering `PATCH /cards/:id` response reflects the card's final auto-moved status within the `productBrief.md` p95<200ms budget **regardless** of how slow or unreachable the webhook endpoint is (AC-HAPPY-3, NFR implications).
- Delivery is fail-safe: a failing/exhausted webhook never crashes the process, never rolls back the auto-move, never converts the caller's `PATCH` into an error (AC-ERROR-4).
- Delivery status (`pending → delivered | failed → exhausted`) is tracked **separately from** `trigger_executions.status` (`executed`/`failed`) — the two live in distinct tables behind distinct read endpoints (AC-ASYNC-3).
- Failures surface as a **coded** `{ code, message, details }` object stored on `webhook_deliveries.last_error` and as structured logs — never returned to the (already-`200`) card PATCH caller (AC-ERROR-4, Error Code Catalog).
- Read-only surface: `GET /trigger-executions` (`?board_id=`/`?rule_id=`), `GET /webhook-deliveries` (`?rule_id=`/`?trigger_execution_id=`/`?status=`), `GET /webhook-deliveries/:id`.

### Frozen Product Decisions (handed down by the human — do NOT re-litigate)
- **Delivery is ASYNCHRONOUS / off the `PATCH /cards/:id` request path.** Webhook work must never add latency to the card PATCH (p95<200ms).
- **`WEBHOOK_MAX_ATTEMPTS = 3` TOTAL** (1 initial + 2 retries), then terminal `exhausted`. **Backoff 30s** (`WEBHOOK_RETRY_BACKOFF_MS` default `30000`); **per-attempt timeout** `WEBHOOK_TIMEOUT_MS` default `5000`. Use the Node global `fetch` + `AbortController` — **NO new dependency**.
- **`webhook_deliveries.payload` stored as `TEXT`** (serialized JSON). **JSONB is REJECTED** (consistent with the frozen `condition` decision).
- **New `src/webhooks/` module.** An injected `WebhookDispatcher` seam mirroring `ActivityEmitter`, constructed in `server.ts`, injected into `CardRuleEngine`.
- **Delivery lifecycle**: `pending → delivered | failed → exhausted` (`delivered`/`exhausted` terminal). `trigger_executions.status` (`executed`/`failed`) is tracked **separately** from `webhook_deliveries.status`.
- **SSRF policy**: validate `webhook_url` is an absolute `http(s)` URL **only**; do **NOT** block private/loopback ranges — a **documented ACCEPTED RISK** (internal-trusted-users MVP).
- **Reuse the minimal structured `log()`** (`src/config/logger.ts`); **no OTEL**.

### Technical Constraints
- **No queue / scheduler / background-worker / outbound-HTTP-client pattern exists in-repo.** The only "async seam" precedent is the in-process, fire-and-forget `InProcessActivityEmitter` (`Map<boardId, Set<handler>>`, synchronous `emit`, non-durable across restart — a documented scaling boundary, not built durable).
- **Node global `fetch` + `AbortController`** are available (Node 20); no `axios`/`node-fetch`/`undici` dependency may be added.
- **No JSONB anywhere in the codebase** — introduced by neither `condition` (rejected) nor this feature.
- **No cross-repository transaction / unit-of-work pattern** — each repository call commits atomically on its own (AC-ASYNC-2 no-rollback carries into the webhook path).
- **DI at the composition root** — side-effecting resources are constructed in `server.ts` and injected into a pure `createApp(deps)`; the factory reads no env, opens no sockets.
- **Observability today = the minimal `log(level, msg, meta)`** JSON-per-line logger. No OTEL/metrics/tracing wired in (the CLAUDE.md OTEL standard is aspirational; the concrete implementation is `log()`).

### Non-Functional Requirements
- **Latency**: API p95 < 200ms, p99 < 500ms (`productBrief.md`). Only the two synchronous INSERTs (trigger-execution + pending delivery), bounded by `MAX_HOPS=3`, may sit on the request path — the network POST and its `WEBHOOK_TIMEOUT_MS × attempts` cost must not.
- **Availability / fail-safe liveness** (systemPatterns Guiding Principle): the dispatcher must never crash the process or fail the underlying card write — even on a thrown `fetch`, a DNS error, or a repository rejection.
- **Simplicity-first clean architecture** (systemPatterns Guiding Principle #1): shallow layers; add infrastructure only when a concrete need appears; favor direct, readable code over indirection. This directly shapes the "no external queue" and "no durable re-drive at MVP" calls below.
- **Security**: `webhook_url` is a new **user-controlled outbound-request surface → SSRF risk**. The policy MUST be an explicit decision (even if "documented acceptance"), never a silent skip.
- **12-factor config**: webhook timeout / max-attempts / backoff via **new env vars** — a deliberate, justified departure from the auto-move core's "no new env vars" directive (12-factor "no hardcoded values" for timeouts/retries).
- **Testability by construction**: the dispatcher's state machine must be exercisable with **stubbed `fetch` + stubbed timers** — no real network, no wall-clock sleeps.

### Existing Patterns That MUST Be Respected
- **Module layout**: `types` / `validation` / `repository` / `routes` (+ co-located `*.test.ts`), mirrored across `boards`/`cards`/`activity`. `src/webhooks/` follows it (dropping `validation` — the read routes take no writable body; `webhook_url` validation lives in `rules.validation.ts`).
- **Repository as an interface** with a `Postgres*` implementation; parameterized SQL only; a `to<Entity>()` row-mapper (`toActivity`/`toCard`).
- **`VARCHAR(20) CHECK (... IN ('todo','in_progress','done'))`** as the status-enum persistence idiom; `VARCHAR(10) CHECK (...)` for small lifecycle enums.
- **FK `ON DELETE SET NULL`** to preserve history after a parent is deleted (`card_activity.card_id`/`rule_id`); **`ON DELETE CASCADE`** for board-owned rows.
- **The injected seam idiom**: `ActivityEmitter` is a purpose-built interface injected via the composition root as the single swap-point (systemPatterns "In-process event fan-out seam"). `WebhookDispatcher` is the direct analogue.
- **Fail-safe side-effect on the write path**: the `PATCH /cards/:id` activity-capture block is persist-first, wrapped in try/catch that logs and never fails the response. The webhook hand-off extends this exact posture.
- **Identity PK as read cursor / natural ordering** (`ORDER BY id`); `id`-ordered reads for the history endpoints.

---

## Component Analysis

### Core Components
| Component | Purpose | Responsibilities |
|-----------|---------|------------------|
| `src/webhooks/webhooks.types.ts` | Domain shapes | `TriggerExecution`, `WebhookDelivery`, `WebhookDeliveryStatus` (`'pending'\|'delivered'\|'failed'\|'exhausted'`), `TriggerExecutionStatus` (`'executed'\|'failed'`), `WebhookPayload` (the POSTed body), `WebhookError` (the coded `{code,message,details}` stored in `last_error`), the create/patch input shapes |
| `src/webhooks/webhooks.repository.ts` | Data access (both tables) | `WebhooksRepository` interface + `PostgresWebhooksRepository`: `recordTriggerExecution`, `createDelivery` (writes on the request path); `updateDeliveryOutcome` (the dispatcher's lifecycle advance, off-path); read methods for the routes; optional `findNonTerminalDeliveries` for a future re-drive |
| `src/webhooks/webhooks.dispatcher.ts` | The async delivery seam | `WebhookDispatcher` interface + `HttpWebhookDispatcher`: `dispatch(delivery, payload)` — fire-and-forget async POST (global `fetch` + `AbortController`) + bounded retries via `setTimeout`; drives the delivery lifecycle through `updateDeliveryOutcome`; internally fail-safe |
| `src/webhooks/webhooks.routes.ts` | Read-only REST surface | `createWebhooksRouter(webhooksRepo)` — `GET /trigger-executions`, `GET /webhook-deliveries`, `GET /webhook-deliveries/:id`; projects `last_error` as a parsed `error` object; no write endpoints |
| `db/init/005_workflow_webhooks.sql` | Schema | `trigger_executions` + `webhook_deliveries` tables (see Implementation Guidelines) |
| `src/rules/rules.engine.ts` (extended) | Fire-time integration | Per applied hop: records a `trigger_executions` row; when `rule.webhook_url` is set, creates the `pending` `webhook_deliveries` row and hands it to the injected `WebhookDispatcher` |

### Component Interactions
```
        PATCH /cards/:id  (existing FEAT-003 + auto-move path — SYNCHRONOUS)
client ─────────────────────────────────────────────▶ createCardsRouter(..., ruleEngine)
                                                          │  real transition → ruleEngine.evaluate(card)
                                                          ▼
     CardRuleEngine.evaluate(card):  (per applied auto-move hop, ON the request path)
        cardsRepo.update / activityRepo.record / activityEmitter.emit    (frozen auto-move hop)
        exec = await webhooksRepo.recordTriggerExecution({..., status:'executed'})   ── INSERT
        if (rule.webhook_url):                                             ◀── ONLY when set
            payload  = buildPayload(rule, card, from, to)                  // {event:'rule.triggered', ...}
            delivery = await webhooksRepo.createDelivery(                   ── INSERT (status 'pending', attempts 0)
                         { trigger_execution_id: exec.id, rule_id, url, payload: JSON.stringify(payload) })
            webhookDispatcher.dispatch(delivery, payload)                  ── FIRE-AND-FORGET, returns void
        ── engine returns; PATCH responds 200 with final card ── (network POST NOT awaited)

     HttpWebhookDispatcher.dispatch(delivery, payload):  (OFF the request path — never awaited by the engine)
        void (async () => {                                                // fully guarded — no unhandled rejection
            for attempt in 1..WEBHOOK_MAX_ATTEMPTS:
                res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'},
                                         body: JSON.stringify(payload), signal: AbortController(WEBHOOK_TIMEOUT_MS) })
                2xx  → updateDeliveryOutcome(id, {status:'delivered', attempts, last_status_code, delivered_at})  ; return
                fail → updateDeliveryOutcome(id, {status:'failed'|'exhausted', attempts, last_status_code, last_error})
                       if attempts remain: setTimeout(nextAttempt, WEBHOOK_RETRY_BACKOFF_MS).unref()   ── the retry timer
        })().catch(swallow-and-log)                                        // belt-and-suspenders fail-safe

        GET /trigger-executions          GET /webhook-deliveries[/:id]
client ────────────────────────────────────────────────────────▶ createWebhooksRouter(webhooksRepo) ──▶ SELECT
```

The engine reaches the two tables **through the injected `WebhooksRepository`** (not raw SQL, not the dispatcher) so the synchronous fire-time writes stay on the request path and are guaranteed persisted before the PATCH responds. The dispatcher is handed the already-persisted `pending` row and owns only the **off-path** POST + lifecycle advance. The **DB row is the single source of truth / audit trail**; the `setTimeout` retry timer is transient scheduling state on top of it.

---

## Decision 1 — Asynchronous delivery mechanism + restart durability

### The split: synchronous create (on-path), asynchronous POST (off-path)
Two facts must both hold (AC-HAPPY-3): the delivery row is queryable **synchronously at fire time**, and the network POST is **never on the request path**. The design splits accordingly:

- **On the request path (synchronous, awaited by the engine, bounded by `MAX_HOPS`)**: `recordTriggerExecution` (one INSERT) and, when `webhook_url` is set, `createDelivery` (one INSERT, `status:'pending'`). These are single-row parameterized INSERTs on a pooled connection — sub-ms to low-single-digit ms — the only webhook cost the p95 budget ever sees.
- **Off the request path (asynchronous, fire-and-forget)**: `webhookDispatcher.dispatch(delivery, payload)` returns `void` immediately; the actual `fetch` + retries run in a self-scheduled async task the engine never awaits.

### Options Explored

#### Option A: Synchronous on the request path (POST inside `PATCH /cards/:id`)
- **Description**: `await fetch(webhook_url)` inside the engine hop, before responding.
- **Pros**: Trivial; no async surface; delivery outcome known before the response.
- **Cons**: **Directly violates the frozen "off-path" decision and the p95<200ms NFR** — a slow/unreachable endpoint adds up to `WEBHOOK_TIMEOUT_MS × WEBHOOK_MAX_ATTEMPTS` (5s × 3 = 15s) to the card PATCH. Non-starter.
- **Technical Fit**: Low. **Complexity**: Low. **Scalability**: Low. **(Rejected — frozen against.)**

#### Option B: In-process synchronous-create + `setTimeout`-scheduled async dispatch (CHOSEN)
- **Description**: The engine synchronously persists the `pending` row, then calls a fire-and-forget `dispatcher.dispatch()`. The dispatcher runs the POST in a self-scheduled async task; on a retryable failure it schedules the next attempt with `setTimeout(fn, WEBHOOK_RETRY_BACKOFF_MS)`. The `webhook_deliveries` row is the durable source of truth; the timer is transient.
- **Components**: `HttpWebhookDispatcher` (global `fetch` + `AbortController` + `setTimeout`), the `WebhooksRepository` for lifecycle writes. **No new dependency, no new process.**
- **Pros**:
  - **Zero network latency on the request path** — satisfies the frozen off-path decision and the p95 budget with only the two INSERTs remaining synchronous.
  - **Mirrors the sole existing async precedent** (`InProcessActivityEmitter`: in-process, fire-and-forget, non-durable) — no new mental model, honors simplicity-first.
  - **No new infrastructure** (no Redis/BullMQ/SQS, no cron, no worker container) — a fit for the single-instance `docker compose` deployment and "modest small-team concurrency."
  - Fully testable with **stubbed `fetch` + fake timers** — deterministic, no real network, no wall-clock waits.
  - The DB row is a complete audit record independent of the timer, so every outcome (incl. a stuck `pending`/`failed`) is observable via `GET /webhook-deliveries`.
- **Cons**:
  - **Process-restart limitation** — an in-flight retry timer is lost on restart; a `pending`/`failed` delivery held only in memory is never re-driven unless a re-drive is added (see below). Accepted for MVP; mitigation path documented.
  - A bare fire-and-forget async task risks an unhandled rejection crashing the process — **mitigated** by wrapping the entire dispatch body in a guard (fail-safe boundary, Decision-agnostic requirement #5).
  - `setTimeout` timers can hold the event loop open at shutdown — **mitigated** with `.unref()` on retry timers.
- **Technical Fit**: High (direct analogue of the `ActivityEmitter` seam). **Complexity**: Low. **Scalability**: Medium (single-instance; bounded retry; the documented promotion path is the same as the emitter's).

#### Option C: DB-backed durable queue with a startup/periodic re-drive sweep
- **Description**: Treat `webhook_deliveries` (status + `next_attempt_at`) as a durable work queue; a sweeper (`setInterval` or on-boot scan) claims non-terminal rows and dispatches them, surviving restart.
- **Pros**: **Restart-durable** — no delivery is stranded by a crash/redeploy; at-least-once delivery semantics.
- **Cons**: Introduces a **scheduler/worker pattern the codebase does not have** (sweep interval, claim/lease to avoid double-send, `next_attempt_at` column, idempotency concerns) — more infrastructure than "optional webhook delivery for an internal MVP" warrants, in tension with simplicity-first. Its **durable core (the `webhook_deliveries` row + the `findNonTerminalDeliveries` query) is already present in Option B**, so C can be added later **non-breakingly** as an enhancement without reshaping the schema or the seam.
- **Technical Fit**: Medium. **Complexity**: Medium/High. **Scalability**: High. **(Rejected for MVP; retained as the documented enhancement path — see below.)**

#### Option D: External queue / broker (BullMQ + Redis, SQS, etc.)
- **Description**: Enqueue a delivery job to an external broker; a worker consumes it.
- **Pros**: Battle-tested retries/backoff/durability; horizontally scalable.
- **Cons**: **New runtime dependency + new infrastructure container** (Redis/broker) — squarely against the frozen "no new dependency" constraint, the single-instance deployment model, and simplicity-first. Massive over-engineering for the throughput profile.
- **Technical Fit**: Low. **Complexity**: High. **Scalability**: High. **(Rejected.)**

### **Chosen**: Option B — in-process synchronous-create + `setTimeout`-scheduled async dispatch

**Rationale**: Option B is the only choice that satisfies the frozen off-path/latency requirement **and** the "no new dependency / no new infra" constraint **and** the simplicity-first principle simultaneously, while directly reusing the codebase's one established async idiom (the in-process, fire-and-forget `ActivityEmitter`). The synchronous INSERT pair keeps AC-HAPPY-3's "queryable at fire time" guarantee; the fire-and-forget POST keeps the p95 budget; the durable `webhook_deliveries` row makes every outcome auditable. The retry schedule and lifecycle transitions layered on this mechanism are the sibling Algorithm doc's to fix.

### Process-restart durability (explicitly documented limitation)
Because retries are held in in-memory `setTimeout` timers, **a process restart (crash, redeploy, `docker compose` recreate) loses every in-flight timer.** A delivery left `pending` (never attempted) or `failed` (mid-retry) at restart is **stranded in a non-terminal state** — it is never automatically retried and never reaches `exhausted`.

This is an **accepted MVP limitation**, justified by:
- **Precedent**: the `InProcessActivityEmitter` is likewise non-durable across restart (its `Map` is lost) — a documented scaling boundary the project already accepts for the same single-instance deployment.
- **Simplicity-first**: a durable sweep is real scheduler infrastructure the codebase has no pattern for; adding it now is the premature generality the Guiding Principles caution against.
- **Observability, not silence**: the stranded row remains in `webhook_deliveries` with its last `status`/`attempts`/`last_error` and is fully visible via `GET /webhook-deliveries?status=pending|failed` — the failure mode is inspectable, not lost.

**RECOMMENDED-BUT-OPTIONAL enhancement (NOT required for MVP)**: a **startup re-drive**. On boot, `server.ts` calls a `webhookDispatcher.redriveNonTerminal()` that queries `webhooksRepo.findNonTerminalDeliveries(limit)` (`status IN ('pending','failed')`) and re-schedules each through the normal dispatch path (respecting `attempts` already recorded so the total stays bounded by `WEBHOOK_MAX_ATTEMPTS`). This is the minimal, non-breaking step from Option B toward Option C's durability — it reuses the existing schema and seam, adds no scheduler, and is idempotent enough for at-least-once semantics. **The `webhook_deliveries.status` index (below) and the `findNonTerminalDeliveries` repository method are provisioned now so this enhancement needs no migration or interface change later.** Deferred as a conscious scope decision, not an oversight.

---

## Decision 2 — `src/webhooks/` module boundary + `WebhookDispatcher` seam

### Module boundary
**Chosen**: a **new `src/webhooks/` module** owning `trigger_executions` + `webhook_deliveries` + the dispatcher + the two read routes — rather than folding into `src/rules/`.

- **Why a separate module**: `trigger_executions`/`webhook_deliveries` are a **distinct concern** (delivery + execution audit) with their own tables, lifecycle, and read endpoints; `src/rules/` already owns rule CRUD + the engine. Co-locating everything in `rules/` would make it the largest, least-cohesive module and blur the seam. A `src/webhooks/` module mirrors the `boards`/`cards`/`activity` split exactly (the house layout) and keeps each module's surface small.
- **The `validation` file is omitted** from `webhooks/` — its routes are read-only (no writable body to validate), and `webhook_url` validation already lives in `rules.validation.ts` where the URL is submitted. Adding an empty `webhooks.validation.ts` would be indirection with no concrete need (simplicity-first).
- **A single combined `WebhooksRepository`** (over both tables) rather than two repositories: the tables are tightly coupled (`webhook_deliveries.trigger_execution_id` FK → `trigger_executions.id`), always written together at fire time, and read by the same router — one repository per module is the established house style (`ActivityRepository`, `CardsRepository`). Splitting into two repos would be premature.

### The `WebhookDispatcher` seam (mirrors `ActivityEmitter`)
```ts
// src/webhooks/webhooks.dispatcher.ts
import type { WebhookDelivery, WebhookPayload } from './webhooks.types';

/**
 * Off-request-path delivery seam for rule-triggered webhooks (TASK-006 Phase 3).
 * A purpose-built interface (like `ActivityEmitter`, not raw async plumbing) —
 * the single swap-point for a future durable/queue-backed promotion; the engine,
 * repository, and routes never change, only the injected implementation.
 */
export interface WebhookDispatcher {
  /**
   * Hand off an already-persisted `pending` delivery for asynchronous POST +
   * bounded retry, OFF the request path. Returns `void` IMMEDIATELY (fire-and-
   * forget) — the caller (the engine, on the synchronous PATCH /cards/:id path)
   * never awaits the network, so webhook latency can never enter the card-PATCH
   * budget. INTERNALLY FAIL-SAFE: never throws, never rejects, never crashes the
   * process; every outcome is recorded on the `webhook_deliveries` row and as a
   * structured log.
   */
  dispatch(delivery: WebhookDelivery, payload: WebhookPayload): void;
}
```
- **`dispatch` returns `void`, not `Promise<void>`** — deliberately, so the engine's call site is a plain statement with no floating promise. The implementation kicks off its own guarded async task internally. (The retry schedule / state-machine that task runs is the Algorithm doc's.)
- **`HttpWebhookDispatcher`** is the MVP implementation: global `fetch` + `AbortController(WEBHOOK_TIMEOUT_MS)` for the POST, `setTimeout(..., WEBHOOK_RETRY_BACKOFF_MS).unref()` for retries, advancing the row via `webhooksRepo.updateDeliveryOutcome`. Constructed with a `{ timeoutMs, maxAttempts, retryBackoffMs }` config object (mirroring how `activityStreamConfig` carries knobs).

### Wiring (composition root)
```ts
// server.ts  (additions)
const webhooksRepo = new PostgresWebhooksRepository(pool);
const webhookDispatcher = new HttpWebhookDispatcher(webhooksRepo, {
  timeoutMs:      env.webhookTimeoutMs,      // WEBHOOK_TIMEOUT_MS      (default 5000)
  maxAttempts:    env.webhookMaxAttempts,    // WEBHOOK_MAX_ATTEMPTS    (default 3)
  retryBackoffMs: env.webhookRetryBackoffMs, // WEBHOOK_RETRY_BACKOFF_MS(default 30000)
});
const ruleEngine = new CardRuleEngine({
  rulesRepo, cardsRepo, activityRepo, activityEmitter,
  webhooksRepo, webhookDispatcher,           // ← engine gains BOTH: repo (sync writes) + dispatcher (async hand-off)
});
const app = createApp({
  checkDb, boardsRepo, cardsRepo, activityRepo, activityEmitter, activityStreamConfig,
  rulesRepo, ruleEngine,                     // (from auto-move phase)
  webhooksRepo,                              // ← for the read routes
});
```
- **`AppDeps` gains `webhooksRepo: WebhooksRepository`** (backs the read router) and — from the auto-move phase — `rulesRepo` + `ruleEngine`.
- **`WebhookDispatcher` is NOT in `AppDeps`** — it is a dependency of the *engine*, not of the routes, so it is constructed at the composition root and injected into `CardRuleEngine` directly (the same way the engine composes its own repo/emitter instances). This keeps `createApp` unaware of the dispatcher and keeps the routes decoupled from delivery internals.
- **`createApp` mounts the read router**: `app.use(createWebhooksRouter(deps.webhooksRepo));`.

### Engine invocation (per firing; delivery hand-off ONLY when `webhook_url` is set)
Inside `CardRuleEngine.evaluate`, after a hop is applied (the frozen auto-move `cardsRepo.update` + `activityRepo.record` + `emit`):
```ts
// per applied hop — trigger_executions is recorded ALWAYS; the dispatcher is invoked ONLY when webhook_url is set
const exec = await this.webhooksRepo.recordTriggerExecution({
  rule_id: rule.id, card_id: current.id, board_id: current.board_id,
  from_status: fromStatus, to_status: target, status: 'executed',
});

if (rule.webhook_url) {                                   // ← delivery is opt-in (AC-HAPPY-3)
  const payload: WebhookPayload = {
    event: 'rule.triggered', rule_id: rule.id, board_id: current.board_id,
    card_id: current.id, card_title: current.title,
    from_status: fromStatus, to_status: target,
    triggered_by: 'rule', occurred_at: new Date().toISOString(),
  };
  const delivery = await this.webhooksRepo.createDelivery({
    trigger_execution_id: exec.id, rule_id: rule.id,
    url: rule.webhook_url, payload: JSON.stringify(payload),  // TEXT snapshot (Decision 3)
  });                                                     // row persisted 'pending', attempts 0 — queryable NOW
  this.webhookDispatcher.dispatch(delivery, payload);     // fire-and-forget async POST — NOT awaited
}
```
- **`trigger_executions` is recorded for every firing** (even `webhook_url === null`) — satisfies AC-HAPPY-3's "a null-`webhook_url` firing records the `trigger_executions` row but creates no `webhook_deliveries` row." The `if (rule.webhook_url)` gate wraps only the delivery-row creation + the dispatcher hand-off.
- Both repository writes are **inside the engine's existing fail-safe try/catch** (auto-move algorithm): a throw is caught, logged `rules.execution_failed`, and the engine returns the last-applied card — the card PATCH still `200`s (AC-ERROR-3). The already-applied hop stays committed (AC-ASYNC-2).
- **The `dispatch` call is a plain fire-and-forget statement** — even if the dispatcher had a defect, it returns `void` synchronously and cannot delay or fail the engine.

---

## Decision 3 — `webhook_deliveries.payload` storage shape

### Options Explored

#### Option 1: `TEXT`, serialized JSON (`JSON.stringify` at fire time) — CHOSEN
- **Description**: The exact payload POSTed is `JSON.stringify`'d into a `payload TEXT NOT NULL` column at fire time; the dispatcher re-uses the in-memory `payload` object for the POST body (no re-parse needed to send).
- **Pros**:
  - **Exact audit fidelity** — the row records the precise bytes that were (or will be) sent, including the `occurred_at` timestamp captured at fire time. A later change to `buildPayload` never retroactively alters history.
  - **No JSONB precedent** — consistent with the frozen `condition` rejection of JSONB; no first-in-codebase persistence pattern.
  - Trivial: one `JSON.stringify` on write; the read routes need not project `payload` at all (it is audit-only, not in the AC-HAPPY-3 read shape), so no `JSON.parse` on the hot read path.
- **Cons**: Not queryable/indexable by inner fields (irrelevant — no requirement filters on payload contents). A malformed stored string is a theoretical concern, but the writer is the only producer and `JSON.stringify` of a typed `WebhookPayload` cannot fail.
- **Technical Fit**: High. **Complexity**: Low. **Scalability**: High (for the requirement).

#### Option 2: `JSONB`
- **Description**: Store the payload object; `pg` round-trips JSONB as a parsed object.
- **Cons**: **First use of JSONB in the codebase** — explicitly rejected for `condition` on simplicity-first grounds and **frozen against** reintroducing here without a decision (which this decision declines to make). Buys queryability the feature never uses.
- **Technical Fit**: Low. **(Rejected — frozen against.)**

#### Option 3: Re-derive on read (store nothing; rebuild from `trigger_executions` + the card/rule)
- **Description**: Don't persist the payload; reconstruct it when needed.
- **Cons**: **Loses audit fidelity** — cannot show what was actually sent; a since-renamed card or since-deleted rule would reconstruct a *different* payload than the one delivered. Also requires cross-table joins on read for no benefit.
- **Technical Fit**: Low. **(Rejected.)**

### **Chosen**: Option 1 — `payload TEXT NOT NULL`, `JSON.stringify` at fire time
**Rationale**: An audit trail must record what was actually sent; a `TEXT` snapshot does that with zero new precedent, consistent with the frozen anti-JSONB stance, and the read endpoints don't project it, so there is no parse cost on the common path. JSONB is frozen against; re-derivation defeats the audit purpose.

---

## Decision 4 — `webhook_url` SSRF policy (Security)

### Security context
`webhook_url` is **user-supplied input that the server will make an outbound HTTP request to.** This is a classic **SSRF (Server-Side Request Forgery)** surface: a rule author could point the URL at an internal service, a loopback admin port, or a cloud metadata endpoint (e.g. `http://169.254.169.254/…`), and the server would dutifully POST to it.

### Options Explored
| Option | Description | Verdict |
|--------|-------------|---------|
| **A: absolute `http(s)` URL only (CHOSEN)** | Validate the URL parses as an absolute URL with an `http`/`https` scheme and ≤2048 chars; **do not** inspect the host. | **Chosen — frozen.** |
| B: A + block private/loopback/link-local/metadata ranges | Additionally reject `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, etc., ideally with DNS-resolution + re-check to defeat rebinding. | Deferred (documented). |
| C: A + host allowlist | Only permit URLs whose host is on an operator-configured allowlist. | Deferred (documented). |

### **Chosen**: Option A — absolute `http(s)` URL only; private/loopback ranges NOT blocked — **ACCEPTED RISK**

**This is a documented, deliberate risk acceptance for the internal-trusted-users MVP**, per the frozen product decision:

- **Threat model / justification**: BanyanBoard at MVP is a **single-tenant, self-hosted, internal team tool** (`productBrief.md`: "small teams," "own-your-data deployment," no multi-tenant isolation). Rule authors are **trusted members of the deploying team** — the same people who could already reach internal services directly. There is no untrusted-tenant boundary for an SSRF payload to cross that the user doesn't already sit inside. Blocking private ranges would also break the plausible **legitimate** use case of POSTing to another service on the same `docker compose` network.
- **What IS enforced** (synchronous `400 INVALID_RULE` at `POST`/`PATCH /rules`, in `rules.validation.ts`, per AC-ERROR-4): `webhook_url` must be a **string**, parse as an **absolute URL** whose scheme is `http:` or `https:`, and be **≤ 2048 chars** (`'webhook_url must be an absolute http(s) URL'`). A bad URL is rejected before it can ever reach the dispatcher. A `null` `webhook_url` is valid and disables delivery.
- **Residual risk ACCEPTED**: a trusted author can cause the server to POST the (fixed-shape, non-secret) `rule.triggered` payload to an internal/loopback/metadata address. Impact is bounded — the request is a **fixed POST body the attacker already knows**, the **response is never surfaced** back to the author (only `last_status_code` is recorded), and delivery is **fail-safe** (a hang is bounded by `WEBHOOK_TIMEOUT_MS`).
- **Hardening path (future, non-breaking)**: Option B/C can be added later as an additional check in `rules.validation.ts` (+ optionally a DNS re-resolve guard in the dispatcher) **without any schema or seam change** — flagged here as the explicit re-review trigger if BanyanBoard ever becomes multi-tenant or hosts untrusted rule authors.

---

## Evaluation Matrix

**Async delivery mechanism** (1 = worst … 5 = best):
| Criteria | A: Sync on-path | B: In-proc `setTimeout` | C: DB re-drive sweep | D: External broker |
|----------|:-:|:-:|:-:|:-:|
| Off-path / p95<200ms compliance | 1 | 5 | 5 | 5 |
| No new dependency / infra | 5 | 5 | 4 | 1 |
| Simplicity-first compliance | 4 | 5 | 3 | 1 |
| Fits single-instance deploy | 5 | 5 | 4 | 2 |
| Restart durability | 5 | 2 | 5 | 5 |
| Testability (stub fetch + timers) | 4 | 5 | 3 | 2 |
| **Verdict** | Rejected (frozen) | **Chosen** | Deferred (enhancement) | Rejected |

**Payload storage**:
| Criteria | 1: TEXT (JSON) | 2: JSONB | 3: Re-derive |
|----------|:-:|:-:|:-:|
| Audit fidelity (bytes actually sent) | 5 | 5 | 1 |
| No JSONB precedent (frozen) | 5 | 1 | 5 |
| Simplicity / read-path cost | 5 | 4 | 2 |
| **Verdict** | **Chosen** | Rejected (frozen) | Rejected |

**SSRF policy**:
| Criteria | A: http(s) only | B: + block ranges | C: allowlist |
|----------|:-:|:-:|:-:|
| Fit for internal-trusted MVP | 5 | 3 | 2 |
| Simplicity | 5 | 2 | 2 |
| Blocks legitimate same-network hooks | 5 (allows) | 2 (breaks) | 3 |
| Untrusted-tenant safety (future) | 2 | 5 | 5 |
| **Verdict** | **Chosen (accepted risk)** | Deferred | Deferred |

---

## Fail-safe Boundaries (satisfies AC-ERROR-4 / AC-ASYNC-3)

The dispatcher extends the codebase's fail-safe write-path posture (the `activity.capture.error` try/catch, the `emit` per-handler isolation) to the off-path async task. **Concretely:**

1. **`dispatch()` returns `void` synchronously** and starts a **single fully-guarded async task**. The entire task body is wrapped so **no rejection can escape** — the outer form is `void (async () => { … })().catch((err) => log('error', 'rules.webhook_failed', {…}))`, and each per-attempt block additionally try/catches. **No unhandled promise rejection can crash the process.**
2. **`fetch` failure modes are all caught and mapped to a delivery failure, never a throw out**:
   - **timeout** — `AbortController` aborts at `WEBHOOK_TIMEOUT_MS`; the resulting `AbortError` is caught and recorded as `WEBHOOK_TIMEOUT`.
   - **network/DNS/connection error** — caught and recorded as `WEBHOOK_TIMEOUT`-style failure (no status code).
   - **non-2xx response** — recorded as `WEBHOOK_NON_2XX` with `last_status_code`.
3. **The dispatcher never touches the card write.** It runs after the engine has already responded-bound the PATCH; it holds only `webhooksRepo` + `fetch`. A repository rejection inside the dispatcher is caught and logged — it cannot fail a request that has already returned.
4. **Retry timers use `.unref()`** so a pending retry never blocks process shutdown, and are bounded by `WEBHOOK_MAX_ATTEMPTS` so the async task always terminates.
5. **Coded-error surfacing**: on each failed attempt the dispatcher builds a `WebhookError` `{ code, message, details:[{field,error}] }` and stores it **serialized (`JSON.stringify`) in `webhook_deliveries.last_error`**; the read routes project it back as a parsed `error` object. Logs: **`rules.webhook_failed`** (level `error`, per failed attempt, carrying `code`/`delivery_id`/`rule_id`/`last_status_code`) and, on the terminal failure, **`rules.webhook_exhausted`** (level `error`, `code:'WEBHOOK_EXHAUSTED'`). **Never** logged: the payload body or any URL query string that could carry a secret — only `rule_id`/`delivery_id`/`status_code` (per the Observability note in the task).

> The precise **when** of each transition (attempt counting = 3 total, 30s fixed backoff, which failure keeps the row `failed` vs flips it to `exhausted`) is the sibling *Webhook Retry Algorithm Design*'s to fix. This doc fixes only the **boundaries**: `void` return, no escaped rejection, no process crash, no card-write impact, coded `last_error`, the two log events.

---

## Observability Architecture

> **Deviation from the methodology's OTEL template — flagged and justified (identical stance to the auto-move architecture doc).** No OpenTelemetry SDK, metrics, or tracing is wired in-repo; the concrete logger is the minimal `log(level, msg, meta)` JSON writer. Introducing OTEL/Prometheus for this feature would violate simplicity-first and the task's "reuse `log()`, no OTEL" directive. This feature reuses the structured logger only.

### Logging (reuse `src/config/logger.ts`)
| Event | Level | When | Fields |
|-------|-------|------|--------|
| `rules.webhook_failed` | error | A single webhook attempt fails (non-2xx or timeout) with attempts remaining or not | `code` (`WEBHOOK_NON_2XX`/`WEBHOOK_TIMEOUT`), `delivery_id`, `rule_id`, `attempt`, `last_status_code` |
| `rules.webhook_exhausted` | error | All `WEBHOOK_MAX_ATTEMPTS` attempts failed (terminal) | `code:'WEBHOOK_EXHAUSTED'`, `delivery_id`, `rule_id`, `attempts` |
| `rules.webhook_delivered` | info | A `2xx` terminates delivery successfully | `delivery_id`, `rule_id`, `last_status_code`, `attempts` |

**Never logged**: the webhook payload body, the full URL (query string may carry secrets) — only `rule_id` / `delivery_id` / `status_code`. No secrets/PII in logs.

### Tracing / Metrics
Not implemented in-repo; out of scope (see deviation). If OTEL is ever adopted API-wide, natural spans would be `webhook.dispatch` (per attempt) and a `webhook_deliveries_total{status}` counter — deferred.

### Configuration Variables (12-factor — new for this feature)
| Variable | Purpose | Default | New? |
|----------|---------|---------|------|
| `WEBHOOK_TIMEOUT_MS` | Per-attempt `AbortController` timeout | `5000` | **Yes** |
| `WEBHOOK_MAX_ATTEMPTS` | Total attempts (1 initial + 2 retries) before `exhausted` | `3` | **Yes** |
| `WEBHOOK_RETRY_BACKOFF_MS` | Fixed delay between attempts | `30000` | **Yes** |
| `LOG_LEVEL` | Log verbosity | `info` | No (existing) |

Added to `Env` + `loadEnv()` in `src/config/env.ts` (mirroring the `activityBackfillLimit`/`activityHeartbeatMs` knobs); defaults live in code + `docker-compose.yml`, never hardcoded at the call site. **Justified departure** from the auto-move core's "no new env vars" — timeouts/retries are exactly the 12-factor "no hardcoded values" case.

---

## Decision Summary (the four owned decisions)

1. **Async mechanism** — **Chosen**: in-process synchronous-create (`recordTriggerExecution` + `createDelivery` awaited on the request path, bounded by `MAX_HOPS`) + fire-and-forget `WebhookDispatcher.dispatch()` running the POST + `setTimeout`-scheduled retries **off-path**. The `webhook_deliveries` row is the durable source of truth. **Restart limitation** (in-flight timers lost) is an **accepted MVP risk**, mirroring the non-durable `ActivityEmitter`; a **startup re-drive of non-terminal deliveries is RECOMMENDED-BUT-OPTIONAL** (provisioned via the `status` index + `findNonTerminalDeliveries`, not built).
2. **Module + seam** — **Chosen**: new `src/webhooks/` module (types + combined `WebhooksRepository` + `WebhookDispatcher` + read routes; no `validation` file). `WebhookDispatcher` is an injected seam mirroring `ActivityEmitter`, constructed in `server.ts`, injected into `CardRuleEngine` (which also gains `webhooksRepo`). The engine records `trigger_executions` per firing **always**, and creates the `pending` delivery + calls `dispatch()` **only when `rule.webhook_url` is set**. `webhooksRepo` is in `AppDeps` (read routes); the dispatcher is not (engine-internal).
3. **Payload storage** — **Chosen**: `payload TEXT NOT NULL`, `JSON.stringify`'d at fire time (exact audit snapshot). **Not JSONB** (frozen), not re-derived (loses fidelity).
4. **SSRF policy** — **Chosen**: validate absolute `http(s)` URL only (`400 INVALID_RULE` on failure, in `rules.validation.ts`); private/loopback/metadata ranges **NOT blocked** — a **documented ACCEPTED RISK** for the internal-trusted-users MVP; hardening (range-block/allowlist) is a non-breaking future path.

---

## Implementation Guidelines

1. **`db/init/005_workflow_webhooks.sql`** — create `trigger_executions` **before** `webhook_deliveries` (the latter FK-references the former). `automation_rules`/`cards`/`boards` already exist from `004`/`002`/`001`.
   ```sql
   -- One row per rule firing (auto-move hop). rule_id ON DELETE SET NULL so history
   -- survives rule deletion (mirrors card_activity.rule_id); card_id likewise.
   CREATE TABLE IF NOT EXISTS trigger_executions (
     id           INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     rule_id      INTEGER      REFERENCES automation_rules(id) ON DELETE SET NULL,
     card_id      INTEGER      REFERENCES cards(id)            ON DELETE SET NULL,
     board_id     INTEGER      NOT NULL REFERENCES boards(id)  ON DELETE CASCADE,
     from_status  VARCHAR(20)  NOT NULL CHECK (from_status IN ('todo','in_progress','done')),
     to_status    VARCHAR(20)  NOT NULL CHECK (to_status   IN ('todo','in_progress','done')),
     status       VARCHAR(10)  NOT NULL CHECK (status IN ('executed','failed')),
     created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS trigger_executions_board_id_idx ON trigger_executions (board_id);
   CREATE INDEX IF NOT EXISTS trigger_executions_rule_id_idx  ON trigger_executions (rule_id);

   -- One row per webhook attempt-lifecycle. status tracked SEPARATELY from
   -- trigger_executions.status. payload is a TEXT JSON snapshot (NOT JSONB).
   -- last_error stores the serialized coded {code,message,details}.
   CREATE TABLE IF NOT EXISTS webhook_deliveries (
     id                   INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     trigger_execution_id INTEGER       NOT NULL REFERENCES trigger_executions(id) ON DELETE CASCADE,
     rule_id              INTEGER       REFERENCES automation_rules(id) ON DELETE SET NULL,
     url                  VARCHAR(2048) NOT NULL,
     status               VARCHAR(10)   NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','delivered','failed','exhausted')),
     attempts             INTEGER       NOT NULL DEFAULT 0,
     last_status_code     INTEGER,
     last_error           TEXT,
     payload              TEXT          NOT NULL,
     created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
     updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
     delivered_at         TIMESTAMPTZ
   );
   CREATE INDEX IF NOT EXISTS webhook_deliveries_trigger_execution_id_idx ON webhook_deliveries (trigger_execution_id);
   CREATE INDEX IF NOT EXISTS webhook_deliveries_rule_id_idx              ON webhook_deliveries (rule_id);
   -- status index supports the ?status= read filter AND the optional startup re-drive
   -- (findNonTerminalDeliveries: WHERE status IN ('pending','failed')).
   CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx               ON webhook_deliveries (status);
   ```

2. **`src/webhooks/webhooks.types.ts`** — domain + input/event/error shapes:
   ```ts
   import type { CardStatus } from '../cards/cards.types';

   export type TriggerExecutionStatus = 'executed' | 'failed';
   export type WebhookDeliveryStatus  = 'pending' | 'delivered' | 'failed' | 'exhausted';

   export interface TriggerExecution {
     id: number; rule_id: number | null; card_id: number | null; board_id: number;
     from_status: CardStatus; to_status: CardStatus;
     status: TriggerExecutionStatus; created_at: Date;
   }

   export interface WebhookDelivery {
     id: number; trigger_execution_id: number; rule_id: number | null; url: string;
     status: WebhookDeliveryStatus; attempts: number;
     last_status_code: number | null; last_error: string | null;   // serialized WebhookError
     created_at: Date; updated_at: Date; delivered_at: Date | null;
     // `payload` (TEXT) is persisted but NOT projected on the read routes (audit-only).
   }

   /** The POSTed JSON body (AC-HAPPY-3). */
   export interface WebhookPayload {
     event: 'rule.triggered'; rule_id: number; board_id: number; card_id: number;
     card_title: string; from_status: CardStatus; to_status: CardStatus;
     triggered_by: 'rule'; occurred_at: string;   // ISO-8601, captured at fire time
   }

   /** Coded failure stored (JSON.stringify) in webhook_deliveries.last_error. */
   export interface WebhookError {
     code: 'WEBHOOK_NON_2XX' | 'WEBHOOK_TIMEOUT' | 'WEBHOOK_EXHAUSTED';
     message: string;
     details: { field: string; error: string }[];
   }

   export interface RecordTriggerExecutionInput {
     rule_id: number; card_id: number; board_id: number;
     from_status: CardStatus; to_status: CardStatus; status: TriggerExecutionStatus;
   }
   export interface CreateDeliveryInput {
     trigger_execution_id: number; rule_id: number; url: string; payload: string;
   }
   ```

3. **`src/webhooks/webhooks.repository.ts`** — a single combined `WebhooksRepository` interface + `PostgresWebhooksRepository`; parameterized SQL only; `toTriggerExecution()` / `toWebhookDelivery()` row-mappers (stable `COLUMNS` projection per the `activity.repository.ts` house style, `delivered_at` bumped/`updated_at = now()` on outcome updates). Methods:
   - `recordTriggerExecution(input): Promise<TriggerExecution>` (engine, on-path)
   - `createDelivery(input): Promise<WebhookDelivery>` (engine, on-path; `status:'pending'`, `attempts:0`)
   - `updateDeliveryOutcome(id, { status, attempts, last_status_code?, last_error?, delivered_at? }): Promise<WebhookDelivery | null>` (dispatcher, off-path)
   - `findTriggerExecutions({ board_id?, rule_id? }): Promise<TriggerExecution[]>` (`ORDER BY id DESC`)
   - `findDeliveries({ rule_id?, trigger_execution_id?, status? }): Promise<WebhookDelivery[]>` (`ORDER BY id DESC`)
   - `findDeliveryById(id): Promise<WebhookDelivery | null>`
   - `findNonTerminalDeliveries(limit): Promise<WebhookDelivery[]>` (`WHERE status IN ('pending','failed') ORDER BY id ASC LIMIT $1`) — provisioned for the optional re-drive; unused at MVP.

4. **`src/webhooks/webhooks.dispatcher.ts`** — `WebhookDispatcher` interface (above) + `HttpWebhookDispatcher(webhooksRepo, config)`. `dispatch()` returns `void`, starts one guarded async task: loop up to `config.maxAttempts`, each attempt `fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload), signal })` with `AbortController` + `setTimeout(config.timeoutMs)` (clear on settle); advance via `updateDeliveryOutcome`; schedule the next attempt with `setTimeout(fn, config.retryBackoffMs)` (call `.unref()`). **The retry/lifecycle transition logic is implemented per the sibling Algorithm doc.** Whole body fail-safe (never rethrows, never rejects out). Build coded `WebhookError` and store via `JSON.stringify` in `last_error`; log `rules.webhook_failed` / `rules.webhook_exhausted` / `rules.webhook_delivered`.

5. **`src/webhooks/webhooks.routes.ts`** — `createWebhooksRouter(webhooksRepo)`; three read-only routes. Reuse `parseId` (positive-integer) for `:id` and query filters (`board_id`/`rule_id`/`trigger_execution_id` positive integers; `status` validated against the enum → else `400`). Project each delivery with `last_error` **parsed** into an `error: WebhookError | null` field (per AC-ERROR-4 "error projection of last_error"); omit `payload`. `GET /webhook-deliveries/:id` → `404 { error: 'Webhook delivery not found' }` on miss. Delivery reads follow the `cards`/`activity` `{error,...}` envelope (these are not the `/rules` coded surface).

6. **`src/config/env.ts`** — add `webhookTimeoutMs`/`webhookMaxAttempts`/`webhookRetryBackoffMs` to `Env` + `loadEnv()` (`Number(process.env.WEBHOOK_* ?? default)`), defaults `5000`/`3`/`30000`.

7. **`src/rules/rules.engine.ts`** — `CardRuleEngine` constructor deps grow by `webhooksRepo: WebhooksRepository` + `webhookDispatcher: WebhookDispatcher`. Per applied hop: `recordTriggerExecution({..., status:'executed'})` always; `if (rule.webhook_url)` → `createDelivery` + `dispatch` (see Decision 2 snippet). Keep all inside the existing fail-safe try/catch. Requires `AutomationRule.webhook_url: string | null` on the rule type (from the `004` frozen decision).

8. **`src/rules/rules.validation.ts`** — the `webhook_url` check (absolute `http(s)`, ≤2048, nullable) is the SSRF enforcement point (Decision 4). No host-range blocking.

9. **`src/app.ts` / `src/server.ts`** — `AppDeps` gains `webhooksRepo`; construct `PostgresWebhooksRepository` + `HttpWebhookDispatcher` in `server.ts`; inject `webhooksRepo` + `webhookDispatcher` into `CardRuleEngine`; mount `createWebhooksRouter(deps.webhooksRepo)`. (Optional, deferred: `webhookDispatcher.redriveNonTerminal()` after `app.listen`.)

10. **Tests** — per Test Strategy: `webhooks.repository.test.ts` (persistence + lifecycle transitions + `last_error`/`last_status_code`/`delivered_at` mapping over a mocked `pg`), `webhooks.routes.test.ts` (filters, `error` projection, 404), `webhooks.dispatcher.test.ts` (**stubbed `fetch` + fake timers**: 2xx→`delivered`; non-2xx→`failed`+retry→`delivered`; timeout via `AbortController`→`failed`+retry; all-fail→`exhausted` + `WEBHOOK_EXHAUSTED`; payload shape + `Content-Type`; **fail-safe**: a thrown `fetch`/repo call never rejects out; `null` `webhook_url` → no delivery row). `rules.engine.test.ts` extends to assert `trigger_executions` recorded per firing and the dispatcher invoked exactly when `webhook_url` is set (stub dispatcher). `cards.routes.test.ts` asserts a slow/failing webhook never delays or fails the PATCH (stub engine/dispatcher).

---

## Validation Checklist

- [x] Meets all system requirements (sync fire-time rows queryable; off-path async POST; separate delivery vs trigger-execution status; coded `last_error`; read endpoints)
- [x] Respects technical constraints (no new dependency — global `fetch`/`AbortController`; no JSONB; no cross-repo txn; reuses the in-process fire-and-forget async idiom)
- [x] Addresses NFRs (p95<200ms — only two bounded INSERTs on-path, POST off-path; fail-safe liveness — guarded async task, no escaped rejection, no card-write impact; 12-factor — new env knobs)
- [x] Technically feasible with the current stack (Express + `pg` + Node 20 `fetch` + injected seams)
- [x] Risks identified and acceptable (below) — restart-durability limitation documented with an optional mitigation; SSRF explicitly accepted for the internal MVP
- [x] Complies with Guiding Principles in systemPatterns.md — **one flagged deviation** (no OTEL/metrics/tracing; reuse `log()`), identical to the auto-move doc; matches the documented "Webhook Delivery Pattern" (max 3, 30s backoff, `pending→delivered|failed→exhausted`). No deviation from the Guiding Principles themselves.
- [x] Respects established patterns (module layout, repository interface, enum-CHECK idiom, FK `ON DELETE SET NULL`/`CASCADE`, injected seam mirroring `ActivityEmitter`, fail-safe write-path side-effect, `id`-ordered reads)
- [x] Observability defined (three structured log events; payload/URL never logged; tracing/metrics out of scope with rationale)
- [ ] Trace context propagation across service boundaries — N/A (single in-process service; no OTEL in-repo)
- [x] Logging strategy consistent with the existing `log()` convention
- [x] Metrics naming — N/A (no metrics layer in-repo)
- [x] **SSRF policy explicitly decided** (absolute `http(s)` only; private-range block declined as documented accepted risk) — the security decision the task required before Phase 3 build

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Process restart strands `pending`/`failed` deliveries (in-flight `setTimeout` timers lost) | Medium | Low/Medium | Accepted MVP limitation (mirrors non-durable `ActivityEmitter`); row stays visible via `GET /webhook-deliveries?status=`; optional startup re-drive provisioned (status index + `findNonTerminalDeliveries`) as a non-breaking enhancement |
| SSRF — a trusted author points `webhook_url` at an internal/loopback/metadata host | Medium | Low | Accepted risk for the internal single-tenant MVP (fixed non-secret payload, response never surfaced, bounded by `WEBHOOK_TIMEOUT_MS`); range-block/allowlist is a documented non-breaking future path |
| Fire-and-forget async task throws an unhandled rejection and crashes the process | Low | High | `dispatch()` wraps the entire task in a guard (`.catch`) + per-attempt try/catch; all `fetch` failure modes (timeout/network/non-2xx) mapped to a recorded delivery failure, never rethrown |
| Webhook work sneaks onto the request path and breaches p95<200ms | Low | High | Only `recordTriggerExecution` + `createDelivery` (two bounded INSERTs) are awaited; `dispatch()` returns `void` synchronously and is never awaited |
| Retry timers keep the process alive at shutdown | Low | Low | `.unref()` on every retry `setTimeout`; attempts bounded by `WEBHOOK_MAX_ATTEMPTS` so the task always terminates |
| `payload` TEXT drifts from the real POST body | Low | Low | The same in-memory `payload` object is both `JSON.stringify`'d to the column and used as the `fetch` body — single source, snapshotted at fire time |

## Next Steps

1. **Webhook Retry Algorithm phase** consumes this mechanism/seam and fixes: the concrete retry schedule (fixed 30s backoff), the attempt-count interpretation (3 total = 1 + 2 retries), and the exact `pending → delivered | failed → exhausted` state-machine transitions the `HttpWebhookDispatcher` implements.
2. **Automation-tab UI/UX phase** designs how a `webhook_url` and its last delivery status (`GET /webhook-deliveries`) surface in the Board Settings panel (Phase 4).
3. **Build Phase 1** freezes `005_workflow_webhooks.sql` + `src/webhooks/` types/repository/read-routes against this doc; wires `webhooksRepo` into `AppDeps`/`server.ts`.
4. **Build Phase 2** extends `CardRuleEngine` to record `trigger_executions` per firing and create the `pending` delivery + `dispatch()` when `webhook_url` is set.
5. **Build Phase 3** implements `HttpWebhookDispatcher` per this mechanism + the Algorithm doc's schedule; adds the env knobs.

---

## NEW_TERMS_INTRODUCED

- **trigger execution** — one persisted row per rule firing (an applied auto-move hop) in `trigger_executions`, with `status ∈ {executed, failed}` reflecting whether the auto-move applied. Recorded for every firing, webhook or not.
- **webhook delivery** — one persisted row per webhook attempt-lifecycle in `webhook_deliveries`, with `status ∈ {pending, delivered, failed, exhausted}` tracked **separately** from the trigger-execution status.
- **WebhookDispatcher (HttpWebhookDispatcher)** — the injected seam (mirroring `ActivityEmitter`) whose `dispatch()` performs the outbound POST + bounded retries **off the request path**, fire-and-forget, internally fail-safe.
- **fire-and-forget dispatch** — `dispatch()` returns `void` synchronously and runs the network work in a guarded async task the engine never awaits, so webhook latency never enters the card-PATCH budget.
- **delivery lifecycle** — `pending → delivered | failed → exhausted`; `delivered`/`exhausted` terminal. Advanced only by the dispatcher via `updateDeliveryOutcome`.
- **WebhookPayload** — the fixed-shape `rule.triggered` JSON body POSTed to the `webhook_url` and snapshotted (as TEXT) in `webhook_deliveries.payload`.
- **WebhookError** — the coded `{ code, message, details }` object (`WEBHOOK_NON_2XX`/`WEBHOOK_TIMEOUT`/`WEBHOOK_EXHAUSTED`) serialized into `last_error` and projected as `error` on the read routes.
- **startup re-drive** — the RECOMMENDED-BUT-OPTIONAL (not-built) enhancement that re-schedules non-terminal (`pending`/`failed`) deliveries on boot to survive process restart, provisioned via the `status` index + `findNonTerminalDeliveries`.
- **accepted SSRF risk** — the documented decision to validate `webhook_url` as an absolute `http(s)` URL only and NOT block private/loopback/metadata ranges, justified by the internal-trusted-users single-tenant MVP threat model.
