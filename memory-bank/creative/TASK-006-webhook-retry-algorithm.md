# Algorithm Decision: Webhook Delivery Retry (attempt / backoff state machine)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: Algorithm
**Task**: TASK-006 / FEAT-006 (Level 3)
**Consumes (frozen, do NOT re-litigate)**:
- Human-frozen delivery decisions (2026-07-15): `WEBHOOK_MAX_ATTEMPTS = 3` **total** attempts (1 initial + up to 2 retries); **fixed** 30s backoff between attempts (`WEBHOOK_RETRY_BACKOFF_MS` default 30000); in-process `setTimeout` scheduling; per-attempt `WEBHOOK_TIMEOUT_MS` default 5000 via `AbortController`; Node global `fetch` (no new dependency); lifecycle `pending → delivered | failed → exhausted` (`delivered`/`exhausted` terminal); coded `{code,message,details:[{field,error}]}` serialized into `webhook_deliveries.last_error`; logs `rules.webhook_failed` (per failed attempt) / `rules.webhook_exhausted` (terminal); fail-safe (dispatcher never throws out, never crashes, never rolls back the auto-move).
- `memory-bank/creative/TASK-006-card-workflow-automation-algorithm.md` — the sibling auto-move algorithm whose fail-safe, log-and-return posture this doc mirrors.
- `systemPatterns.md` § *Webhook Delivery Pattern* + *Fail-safe liveness* Guiding Principle.
- **Not yet written**: `TASK-006-webhook-architecture.md` (sibling architecture phase, in parallel). Where a decision is architecture's (module boundary, `payload` storage shape, `WebhookDispatcher` seam placement, restart-durability mechanism, SSRF policy) this doc defers to it explicitly and does not pre-empt it.

**Scope of this doc — the decisions this Algorithm phase OWNS:**
1. **The attempt/backoff delivery state machine** — as a transition **table** and as `deliver(deliveryId)` **pseudocode**, with attempt-counting made unambiguous so "3 total attempts" is exact.
2. **Response classification** — 2xx success, non-2xx, timeout/abort, network error, and unexpected-throw handling (all fail-safe).
3. **At-least-once / idempotency semantics** and the **no-rollback** stance for the delivery lifecycle.

Backoff *shape* (fixed 30s) and *mechanism* (`setTimeout`) are **FROZEN**; the *Options Explored* section documents the alternatives that were considered for completeness and future re-visit, then converges on the frozen choice — it does not re-open it.

---

## Problem Statement

When an enabled rule with a non-null `webhook_url` fires during `PATCH /cards/:id` (AC-HAPPY-3), the auto-move engine records a `trigger_executions` row and a linked `webhook_deliveries` row (`status:'pending'`, `attempts:0`) **synchronously** at fire time, then hands the delivery to the injected `WebhookDispatcher`. The dispatcher must perform the outbound `POST {webhook_url}` **asynchronously, off the request path**, and drive the delivery through a bounded retry lifecycle. The algorithm must:

- **Never** add webhook latency to the `PATCH /cards/:id` critical path — the card response reflects the final auto-moved status within p95 < 200ms **regardless** of how slow or unreachable the endpoint is (`productBrief.md`; AC-HAPPY-3 latency clause). Only the two synchronous INSERTs are on-path.
- Attempt delivery **up to `WEBHOOK_MAX_ATTEMPTS` = 3 total** times (1 initial + up to 2 retries), separated by a **fixed 30s** backoff, then terminate at `exhausted` (AC-ERROR-4, AC-ASYNC-3).
- Bound each attempt by `WEBHOOK_TIMEOUT_MS` (5000ms) via `AbortController` so a hanging endpoint cannot pin a worker indefinitely.
- **Classify** every outcome into the frozen coded-error vocabulary (`WEBHOOK_NON_2XX` / `WEBHOOK_TIMEOUT` / `WEBHOOK_EXHAUSTED`) stored as `last_error`, and advance `status` / `attempts` / `last_status_code` / `delivered_at` per the lifecycle.
- Be **fail-safe** (mirrors the auto-move engine's AC-ERROR-3 posture): never throw out of the dispatcher, never crash the process on a rejected `fetch` or a rejected repository write, and never roll back the already-committed auto-move — a card stays moved and its `trigger_executions` row stays `executed` no matter what the webhook does.
- Track the **delivery** status **separately** from the **trigger-execution** status (the product requirement, AC-ASYNC-3): the dispatcher mutates `webhook_deliveries` only, never `trigger_executions`.

### The bounded-graph reality (the key lever)

Like the auto-move pass, this is a **tiny, terminating state machine**, not an open-ended queue. There are exactly **4 states** (`pending`, `failed`, `delivered`, `exhausted`, the last two terminal) and a hard ceiling of **3 attempts** and therefore **at most 2 backoff waits**. Total wall-clock from fire to a terminal state is bounded at `2 × WEBHOOK_RETRY_BACKOFF_MS + 3 × WEBHOOK_TIMEOUT_MS ≈ 60s + 15s = 75s` worst case — all of it off the request path. This lets us pick the simplest correct mechanism (a single re-entrant `deliver()` function scheduled by `setTimeout`) rather than any durable-queue machinery.

## Inputs & Outputs

### Inputs
| Name | Type | Size/Range | Source |
|------|------|------------|--------|
| `deliveryId` | `number` | one row id | passed to `deliver()` by `dispatch()` (first attempt) and by the retry `setTimeout` (subsequent) |
| delivery row | `WebhookDelivery` | one row (`id, trigger_execution_id, rule_id, url, status, attempts, last_status_code, last_error, payload, delivered_at`) | `deliveriesRepo.findById(deliveryId)` — **re-read at the top of every attempt** so a concurrently-terminalised row is honoured |
| `payload` | serialized JSON string (snapshot) | one body, built **once** at fire time, byte-identical across all attempts | stored on / derived for the delivery row (exact storage = architecture's call) |
| `WEBHOOK_TIMEOUT_MS` | `number` (env) | default 5000 | `src/config/env.ts` |
| `WEBHOOK_MAX_ATTEMPTS` | `number` (env) | default 3 | `src/config/env.ts` |
| `WEBHOOK_RETRY_BACKOFF_MS` | `number` (env) | default 30000 | `src/config/env.ts` |

### Outputs
| Name | Type | Description |
|------|------|-------------|
| advanced delivery row | side effect | `status` / `attempts` / `last_status_code` / `last_error` / `delivered_at` mutated per the lifecycle; queryable via `GET /webhook-deliveries`. |
| scheduled retry | side effect | on a non-terminal failure with attempts remaining, a single `setTimeout(deliver, BACKOFF_MS)` is armed. |
| structured logs | side effect | `rules.webhook_delivered` (info), `rules.webhook_failed` (per failed attempt), `rules.webhook_exhausted` (terminal error). Never logs the payload body or full URL (per Observability note). |
| **no** return value the caller depends on | — | `deliver()` resolves `void`; nothing on the `PATCH` path awaits it. |

### Edge Cases
1. **2xx on first attempt** — `pending → delivered`, `attempts:1`, `delivered_at` stamped, `last_error:null`. One `fetch`, no retry (AC-HAPPY-3).
2. **Endpoint flaps then succeeds on a retry** — e.g. attempt 1 non-2xx → `failed` (retry armed); after 30s attempt 2 → 2xx → `delivered` (`attempts:2`, `delivered_at` set). No 3rd attempt. `delivered` is reachable on any attempt, including the last.
3. **All 3 attempts fail → `exhausted`** — attempt 1 fail → `failed` (+30s), attempt 2 fail → `failed` (+30s), attempt 3 fail → `exhausted` with `WEBHOOK_EXHAUSTED`; `rules.webhook_exhausted` logged; **no 4th** `fetch` ever (AC-ERROR-4, AC-ASYNC-3).
4. **Timeout / abort** — no response within `WEBHOOK_TIMEOUT_MS`; `AbortController` fires; classified `WEBHOOK_TIMEOUT` (`details.field:'timeout'`), `last_status_code` stays null, `attempts` incremented, retry if attempts remain.
5. **Network error** (DNS failure, `ECONNREFUSED`, TLS error) — `fetch` rejects; classified `WEBHOOK_TIMEOUT` (frozen rule: "timeout/network error → `WEBHOOK_TIMEOUT`"); same handling as timeout.
6. **DB update throws mid-lifecycle** — a `markFailed`/`markDelivered`/`markExhausted` write rejects (DB briefly unreachable); caught by the outer fail-safe guard, logged, swallowed. The row may be left non-terminal and, absent an architecture-owned re-drive sweep, will not auto-advance — a documented limitation deferred to the architecture phase (restart-durability question).
7. **Delivery row already terminal** — a `deliver()` invocation (e.g. a late/duplicate retry, or a manual re-drive) that finds `status ∈ {delivered, exhausted}` is a **no-op**: no `fetch`, no mutation, no log-spam.
8. **Delivery row missing** — `findById` returns null (row deleted via `ON DELETE CASCADE` when its `trigger_execution` went away): no-op, return.
9. **`webhook_url` was null at fire time** — no `webhook_deliveries` row was ever created (delivery is opt-in, AC-HAPPY-3 "And" clause); `deliver()` is never scheduled. (Enforced at `dispatch()`, shown below.)
10. **Unexpected throw anywhere** (`fetch` throws synchronously, serializer throws, logger throws) — the outer `try/catch` swallows it; `deliver()` still resolves; the process never crashes.

### Invariants
- **Bounded attempts**: `attempts` monotonically increases `0 → 1 → 2 → 3`; a `fetch` is issued **at most `WEBHOOK_MAX_ATTEMPTS` (3)** times per delivery. Retries armed = at most `WEBHOOK_MAX_ATTEMPTS − 1 = 2`.
- **Terminal is final**: once `delivered` or `exhausted`, no further `fetch`, mutation, or retry — enforced by the terminal-guard re-read at the top of `deliver()`.
- **Off-path**: no code awaited by `PATCH /cards/:id` ever blocks on `fetch` or on a backoff wait.
- **Separation of statuses**: `deliver()` mutates `webhook_deliveries` only; `trigger_executions.status` (`executed`/`failed`) is never touched by the dispatcher (AC-ASYNC-3).
- **Fail-safe**: `deliver()` never rejects and never throws; a webhook fault never converts the caller's already-`200` `PATCH` into an error and never rolls back the auto-move.
- **Byte-stable body**: the POST body is identical across all attempts of one delivery (idempotency — see below).

## Constraints

### Performance Requirements
- **On-path budget**: **zero** webhook work on the `PATCH /cards/:id` critical path beyond the two synchronous INSERTs (`trigger_executions` + `webhook_deliveries`) done by the engine/`dispatch()`. p95 < 200ms / p99 < 500ms must hold with an unreachable endpoint.
- **Per-attempt ceiling**: `WEBHOOK_TIMEOUT_MS` (5000ms) hard cap per `fetch`, so a stuck endpoint frees its worker deterministically.
- **Worst-case wall time to terminal**: `2 × 30000 + 3 × 5000 ≈ 75s`, entirely off-path.

### Scale Requirements
- **Current data size**: tens of webhook-bearing firings at low frequency (internal small-team tool; `productBrief.md` "modest, small-team concurrency").
- **Expected growth**: bounded by design — attempts-per-delivery is a fixed constant (3); concurrency scales with firing rate, not with retry depth.
- **Peak load**: low peak-to-average; no high-volume outbound path.

### Other Constraints
- No queue/scheduler/background-worker infra exists in-repo (LOW-confidence flag in the task); the mechanism must be in-process with **no new dependency** (Node `fetch` + `AbortController` + `setTimeout`).
- No cross-repository transaction / unit-of-work — each delivery-row mutation commits atomically on its own; no rollback across the lifecycle (consistent with AC-ASYNC-2).
- Fail-safe liveness (`systemPatterns.md` Guiding Principle) — the dispatcher must never crash the process.
- **Test determinism** (Test Strategy): backoff waits MUST be driveable by fake timers (`vi.useFakeTimers`) and `fetch` MUST be stubbable — no real network, no real wall-clock sleeps.

---

## Options Explored

> The retry **count** (3 total), backoff **shape** (fixed 30s), and **mechanism** (in-process `setTimeout`) are **FROZEN** by the human. Options B–D are documented for completeness and as the explicit re-visit triggers, then rejected/deferred in favour of the frozen Option A.

### Option A: Fixed backoff + in-process `setTimeout`, single re-entrant `deliver()` (CHOSEN / FROZEN)

- **Approach**: One re-entrant `async deliver(deliveryId)` performs a single attempt: re-read row → terminal-guard → `POST` with `AbortController` timeout → classify → advance status/attempts → on a retriable failure, arm exactly one `setTimeout(() => deliver(deliveryId), WEBHOOK_RETRY_BACKOFF_MS)`. First attempt is scheduled off the request path (`setTimeout(…, 0)` / `setImmediate`) by `dispatch()`. Backoff is a **constant** 30s between every attempt.
- **Time Complexity**: `O(WEBHOOK_MAX_ATTEMPTS)` = `O(1)` (fixed 3). Per attempt: 1 `findById` + 1 `fetch` + 1 status-write.
- **Space Complexity**: `O(1)` per in-flight delivery (one pending timer handle + `AbortController`).
- **Data Structures**: an `AbortController` per attempt; a `Map<deliveryId, Timeout>` of armed retry handles (for graceful shutdown + test flushing).
- **Pros**:
  - Simplest correct mechanism; no new dependency, no queue, no poller.
  - Trivially bounded and terminating (fixed attempt ceiling).
  - Fully deterministic under fake timers — fixed backoff means one timer value, no jitter to stub.
  - Off-path by construction (nothing awaits `deliver()`).
- **Cons**:
  - **Not restart-durable**: a `pending`/`failed` delivery whose retry lives only in a `setTimeout` is lost if the process restarts before it fires. **Deferred to the architecture phase** (accept-and-document for an internal MVP vs a DB-backed re-drive sweep that re-loads non-terminal rows on boot). This algorithm is agnostic to that choice — the same `deliver(deliveryId)` is the re-drive entry point either way.
  - Fixed 30s (no jitter) can synchronise retries if many deliveries fail at once ("thundering herd") — a non-issue at this tool's scale.
- **Best For**: a low-volume, bounded-attempt, fail-safe outbound webhook on a codebase with no queue infra — exactly this feature.
- **Worst For**: high-volume fan-out to many flaky endpoints (would want jitter + a durable queue) — out of scope.

### Option B: Exponential backoff (± jitter) + `setTimeout`

- **Approach**: As A, but backoff grows (e.g. `BASE × 2^(attempt−1)`, optionally with random jitter).
- **Pros**: Kinder to a recovering endpoint; jitter avoids herd synchronisation at scale.
- **Cons**: More knobs (base, factor, cap, jitter seed) for **zero** benefit at 2 retries; jitter makes fake-timer tests non-deterministic unless the RNG is also injected/stubbed. The human chose fixed 30s — simplicity over a scale concern this tool does not have.
- **Verdict**: **Rejected** (over-engineered for a 3-attempt ceiling). Documented as the natural future upgrade if volume grows.

### Option C: DB-backed re-drivable sweep (poller)

- **Approach**: No in-memory timers; a periodic worker `SELECT`s non-terminal `webhook_deliveries` whose next-attempt time has passed and calls `deliver()`.
- **Pros**: **Restart-durable** — survives process crashes; the source of truth is the row.
- **Cons**: Introduces a scheduler/worker loop the codebase does not have (new infra + a polling cadence + "claim" concurrency control to avoid double-send). This is squarely the **architecture phase's durability decision**, not the retry algorithm's. Even if architecture picks a sweep, it *re-drives the same `deliver(deliveryId)`* defined here.
- **Verdict**: **Deferred to architecture** as the durability half; the state machine below is identical under either mechanism.

### Option D: Immediate retries (no backoff)

- **Approach**: Retry instantly on failure, up to the attempt cap.
- **Cons**: Hammers a struggling endpoint, provides no recovery window, and would put retry latency close to the request path if not carefully deferred. The frozen 30s window exists precisely to give a flapping endpoint time to recover.
- **Verdict**: **Rejected.**

---

## Complexity Comparison

| Metric | A: Fixed + setTimeout (chosen) | B: Exponential + setTimeout | C: DB sweep | D: Immediate |
|--------|:-:|:-:|:-:|:-:|
| Attempts (total) | 3 (fixed) | 3 (fixed) | 3 (fixed) | 3 (fixed) |
| Backoff shape | constant 30s | growing (+jitter) | constant/growing | none |
| `fetch` calls (worst) | 3 | 3 | 3 | 3 |
| Worst wall time to terminal | ~75s | grows w/ factor | ~75s+cadence | ~15s |
| Restart-durable | ✘ (arch. defers) | ✘ | ✔ | ✘ |
| Process-crash-safe delivery | ✘ | ✘ | ✔ | ✘ |
| New infra / dependency | none | none | **scheduler + claim** | none |
| Fake-timer deterministic | ✔✔ (one value) | ✔ (needs RNG stub) | ✔ | ✔ |
| Herd-safe at scale | ✘ (fine here) | ✔ | depends | ✘ |
| Implementation | Simple | Medium | Medium/High | Simple |

## Performance Projection

At expected scale (tens of webhook-bearing firings, low frequency):

| Scenario | On-path cost (PATCH budget) | Off-path cost | Memory |
|----------|-----------------------------|---------------|--------|
| Success on attempt 1 | 2 INSERTs only (engine/`dispatch()`) | 1 `fetch` (≤5s), 1 status-write | O(1) — 1 `AbortController` |
| Flap → success on retry | unchanged (2 INSERTs) | 2 `fetch`, 1×30s timer, 2 writes | O(1) — 1 timer handle |
| Full exhaustion | unchanged (2 INSERTs) | 3 `fetch`, 2×30s timers, 3 writes, ~75s total | O(1) |

The `PATCH /cards/:id` p95 < 200ms budget is **structurally protected**: an unreachable endpoint's up-to-75s lifecycle is entirely off the request path. This is exactly why the architecture phase can keep the card write synchronous while delivery is asynchronous.

---

## Decision

### Decision 1 — The delivery state machine (attempt/backoff)

**Chosen**: **Option A — a single re-entrant `deliver(deliveryId)` with a fixed 30s `setTimeout` backoff**, honouring the frozen decisions. `deliver()` is the sole state-transition function; it is invoked once by `dispatch()` (first attempt, off-path) and re-invoked by an armed `setTimeout` for each retry.

**State transition TABLE** (`A` = `attempts` value **after** this attempt's increment; `MAX` = `WEBHOOK_MAX_ATTEMPTS` = 3):

| # | Current state | Trigger (this attempt's outcome) | Guard | Next state | Persisted side effects | Retry armed? |
|---|---------------|----------------------------------|-------|-----------|------------------------|--------------|
| 1 | `pending` | *(none — created by engine/`dispatch()`)* | `url != null` | `pending` | row inserted `attempts:0` | first `deliver` scheduled `setTimeout(…,0)` |
| 2 | `pending` \| `failed` | **2xx** | — | **`delivered`** (terminal) | `attempts:=A`, `last_status_code:=code`, `last_error:=null`, `delivered_at:=now()` | no |
| 3 | `pending` \| `failed` | **non-2xx** | `A < MAX` | `failed` | `attempts:=A`, `last_status_code:=code`, `last_error:=WEBHOOK_NON_2XX` | **yes** (`+BACKOFF_MS`) |
| 4 | `pending` \| `failed` | **timeout / network error** | `A < MAX` | `failed` | `attempts:=A`, `last_status_code:=null`, `last_error:=WEBHOOK_TIMEOUT` | **yes** (`+BACKOFF_MS`) |
| 5 | `pending` \| `failed` | **non-2xx** OR **timeout/network** | `A == MAX` | **`exhausted`** (terminal) | `attempts:=A`, `last_status_code` set if HTTP, `last_error:=WEBHOOK_EXHAUSTED` | no |
| 6 | `delivered` \| `exhausted` | *(any `deliver()` re-entry)* | terminal | *(unchanged)* | **none** (no-op) | no |
| 7 | *(row missing)* | `findById → null` | — | *(none)* | **none** (no-op) | no |
| 8 | *any* | **DB write throws** / **unexpected throw** | — | *(unchanged; may stay non-terminal)* | none (logged, swallowed) | no |

**Attempt-counting is unambiguous** (this is the crux of "3 total"):
- The row is created with `attempts: 0`.
- Each `deliver()` invocation performs **exactly one** `fetch` and sets `attempts := row.attempts + 1` for that attempt (call it `A`).
- On success → `delivered` (rows 2). On failure: **`A < MAX` → `failed` + arm retry** (rows 3/4); **`A == MAX` → `exhausted`** (row 5).
- Therefore `fetch` runs for `A = 1, 2, 3` and **stops at 3**: 1 initial + 2 retries. Retries are armed after `A=1` and `A=2` only. A 4th `fetch` is impossible.

Timeline of a full exhaustion (all fail): `t=0` A=1→`failed` → `t=30s` A=2→`failed` → `t=60s` A=3→`exhausted`. (`delivered` short-circuits at any A.)

### Decision 2 — Response classification

**Chosen** (matches the frozen coded vocabulary exactly):

| Outcome | Detection | Coded `last_error` |
|---------|-----------|--------------------|
| **Success** | `res.status` in `[200,299]` | `null` — row `delivered` |
| **Non-2xx** | `fetch` resolved, `res.status` outside 2xx | `{ code:'WEBHOOK_NON_2XX', message:'Webhook returned a non-2xx status', details:[{ field:'status', error:'<code> is not 2xx' }] }`; `last_status_code := res.status` |
| **Timeout** | `AbortController` fired at `WEBHOOK_TIMEOUT_MS` (`fetch` rejects `AbortError`) | `{ code:'WEBHOOK_TIMEOUT', message:'Webhook request timed out', details:[{ field:'timeout', error:'no response within {WEBHOOK_TIMEOUT_MS}ms' }] }`; `last_status_code := null` |
| **Network error** | `fetch` rejects for any non-abort reason (DNS/`ECONNREFUSED`/TLS) | **same as timeout** (`WEBHOOK_TIMEOUT`) — frozen rule "timeout/network error → `WEBHOOK_TIMEOUT`" |
| **Exhaustion** (terminal after last failed attempt) | `A == MAX` on any failure | `{ code:'WEBHOOK_EXHAUSTED', message:'Webhook delivery exhausted after {MAX} attempts', details:[{ field:'attempts', error:'{MAX} of {MAX} attempts failed' }] }` |

Non-2xx and timeout/network are treated **identically for retry purposes** — both are "failure with attempts-remaining logic." They differ only in the coded `last_error` and whether `last_status_code` is set. `WEBHOOK_EXHAUSTED` **replaces** the per-attempt code as the row's final `last_error` (the operator sees "exhausted," and `last_status_code` still carries the last HTTP code if the final attempt was a non-2xx).

### Decision 3 — At-least-once / idempotency + no-rollback

**At-least-once semantics.** Delivery is **at-least-once, not exactly-once**: a receiver may see the same POST more than once (a retry after a response that was actually processed but whose reply was lost/slow) or late (up to ~75s after the event). To let receivers **dedupe**, the payload is an `event` + stable ids envelope (the frozen AC-HAPPY-3 body):

```json
{ "event": "rule.triggered", "rule_id": 12, "board_id": 3, "card_id": 45,
  "card_title": "Ship v1", "from_status": "in_progress", "to_status": "done",
  "triggered_by": "rule", "occurred_at": "2026-07-15T10:04:12.512Z" }
```

- The receiver's **idempotency key** is the tuple `{ event, rule_id, card_id, from_status, to_status, occurred_at }` — `occurred_at` is the fire-time instant, unique per firing hop.
- **Requirement this algorithm imposes**: the POST **body is built once at fire time and reused byte-for-byte across all 3 attempts** — retries MUST NOT re-derive `occurred_at` (or any field), or the dedupe key would drift and defeat dedup. (Whether the snapshot lives as TEXT on the row or is re-derived deterministically is the architecture phase's `payload`-storage decision; either way the *bytes must be identical across attempts*.)

**No-rollback stance.** Consistent with AC-ASYNC-2/AC-ERROR-3/AC-ERROR-4 and the codebase's lack of a unit-of-work pattern: a failed or `exhausted` webhook **never** rolls back or mutates anything upstream. The auto-move stays committed, the `trigger_executions` row stays `executed`, and `card_activity` is untouched. The webhook lifecycle is a **strictly downstream, side-channel** record; `trigger_executions.status` and `webhook_deliveries.status` are independent (AC-ASYNC-3) — a card can be `executed` while its delivery is `pending`/`failed`/`exhausted`.

### Trade-offs Accepted
- **Not restart-durable (Option A).** An in-memory `setTimeout` retry is lost on process restart. Accepted for the MVP and **flagged to the architecture phase** as the durability decision (accept-and-document vs a DB re-drive sweep that calls the same `deliver()`); this doc's state machine is unchanged either way.
- **Fixed backoff, no jitter.** Retries can synchronise under mass failure. Accepted — a non-issue at small-team scale; exponential/jitter (Option B) is the documented future upgrade.
- **At-least-once, not exactly-once.** Receivers must dedupe on the provided idempotency key. Accepted — exactly-once outbound delivery is not achievable without receiver cooperation and is out of scope.
- **A DB write that throws mid-lifecycle can strand a row non-terminal.** Accepted, fail-safe (logged, never crashes); its recovery is the architecture durability decision.

---

## Implementation Details

### Data Structures
| Structure | Purpose | Operations |
|-----------|---------|------------|
| `AbortController` (per attempt) | enforce `WEBHOOK_TIMEOUT_MS` on one `fetch` | `abort()` from a `setTimeout`; `signal` passed to `fetch`; `clearTimeout` in `finally` |
| `Map<number, NodeJS.Timeout>` (`pendingRetries`) | track armed retry timers by `deliveryId` | `set`/`get`/`delete` — for graceful shutdown (`clear all`) and deterministic tests |
| coded-error object | frozen `{code,message,details:[{field,error}]}` | serialized to `last_error` (JSON string) |

### Algorithm Steps

```
// ── Constants from src/config/env.ts (12-factor; defaults shown) ──
WEBHOOK_MAX_ATTEMPTS   = 3       // TOTAL attempts (1 initial + 2 retries)
WEBHOOK_RETRY_BACKOFF_MS = 30000 // FIXED backoff between attempts
WEBHOOK_TIMEOUT_MS     = 5000    // per-attempt hard cap

// ── Entry from the engine (SYNCHRONOUS part — on the PATCH path) ──
// (row creation belongs to the engine/architecture seam; shown for context)
function dispatch(firing):                       // firing carries the webhook-bearing rule fire
    if firing.rule.webhook_url == null:
        return                                    // opt-in: NO delivery row, NO fetch (edge 9)
    payload = buildPayloadOnce(firing)            // built ONCE — reused byte-identical on every retry
    delivery = deliveriesRepo.createPending({ ...ids, url: firing.rule.webhook_url,
                                              payload, status:'pending', attempts:0 })
    scheduleAttempt(delivery.id, 0)               // OFF the request path (setTimeout 0 / setImmediate)
    // dispatch() returns immediately; nothing on the PATCH path awaits delivery

function scheduleAttempt(deliveryId, delayMs):
    handle = setTimeout(() => { pendingRetries.delete(deliveryId); void deliver(deliveryId) }, delayMs)
    pendingRetries.set(deliveryId, handle)        // tracked for shutdown + fake-timer tests

// ── The single re-entrant state-transition function. NEVER throws / rejects. ──
async function deliver(deliveryId):
    try:
        row = await deliveriesRepo.findById(deliveryId)
        if row == null: return                    // edge 8 — row gone (cascade delete), no-op
        if row.status == 'delivered' or row.status == 'exhausted':
            return                                // edge 7 — terminal, idempotent no-op (row 6)

        attempt = row.attempts + 1                // THIS attempt's number: 1..MAX (unambiguous)
        outcome = await postWithTimeout(row.url, row.payload)   // never throws (see below)

        if outcome.kind == 'ok':                  // ── 2xx → delivered (row 2) ──
            await deliveriesRepo.markDelivered(deliveryId,
                { attempts: attempt, last_status_code: outcome.status,
                  last_error: null, delivered_at: now() })
            log('info', 'rules.webhook_delivered',
                { delivery_id: deliveryId, rule_id: row.rule_id, status_code: outcome.status, attempt })
            return

        // ── failure branch: classify (rows 3/4/5) ──
        coded = classify(outcome)                 // WEBHOOK_NON_2XX | WEBHOOK_TIMEOUT
        statusCode = (outcome.kind == 'non_2xx') ? outcome.status : null

        if attempt < WEBHOOK_MAX_ATTEMPTS:        // attempts remain → failed + retry (rows 3/4)
            await deliveriesRepo.markFailed(deliveryId,
                { attempts: attempt, last_status_code: statusCode, last_error: serialize(coded) })
            log('error', 'rules.webhook_failed',
                { delivery_id: deliveryId, rule_id: row.rule_id, code: coded.code,
                  attempt, status_code: statusCode })
            scheduleAttempt(deliveryId, WEBHOOK_RETRY_BACKOFF_MS)   // fixed 30s, off-path
        else:                                     // A == MAX → exhausted (row 5, terminal)
            exhausted = { code:'WEBHOOK_EXHAUSTED',
                          message: `Webhook delivery exhausted after ${WEBHOOK_MAX_ATTEMPTS} attempts`,
                          details: [{ field:'attempts',
                                      error: `${WEBHOOK_MAX_ATTEMPTS} of ${WEBHOOK_MAX_ATTEMPTS} attempts failed` }] }
            await deliveriesRepo.markExhausted(deliveryId,
                { attempts: attempt, last_status_code: statusCode, last_error: serialize(exhausted) })
            log('error', 'rules.webhook_exhausted',
                { delivery_id: deliveryId, rule_id: row.rule_id, code:'WEBHOOK_EXHAUSTED',
                  attempts: attempt })
    catch err:                                    // ── FAIL-SAFE (rows 6/8, edges 6/10) ──
        // reached if a repo write rejected, serialize threw, etc. Swallow — never crash, never rethrow.
        try:
            log('error', 'rules.webhook_failed',
                { delivery_id: deliveryId, code:'WEBHOOK_DISPATCH_ERROR', message: str(err) })
        catch: /* even the logger must not throw out of deliver() */
        return                                    // row may be left non-terminal (edge 6) — arch. durability decides recovery

// ── One attempt's HTTP call, timeout-bounded. NEVER throws — returns a tagged outcome. ──
async function postWithTimeout(url, payloadJsonString):
    controller = new AbortController()
    timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
    try:
        res = await fetch(url, { method:'POST',
                                 headers: { 'Content-Type': 'application/json' },
                                 body: payloadJsonString,       // the byte-stable snapshot
                                 signal: controller.signal })
        if res.status >= 200 and res.status <= 299:
            return { kind:'ok', status: res.status }
        return { kind:'non_2xx', status: res.status }
    catch err:
        // AbortError (timeout) OR any network/DNS/TLS error — frozen: both → WEBHOOK_TIMEOUT
        return { kind:'timeout_or_network', message: str(err) }
    finally:
        clearTimeout(timer)                        // release the abort timer regardless of outcome

function classify(outcome):
    if outcome.kind == 'non_2xx':
        return { code:'WEBHOOK_NON_2XX', message:'Webhook returned a non-2xx status',
                 details: [{ field:'status', error: `${outcome.status} is not 2xx` }] }
    else:  // timeout_or_network
        return { code:'WEBHOOK_TIMEOUT', message:'Webhook request timed out',
                 details: [{ field:'timeout', error: `no response within ${WEBHOOK_TIMEOUT_MS}ms` }] }
```

**Where the ceiling is enforced**: the `attempt < WEBHOOK_MAX_ATTEMPTS` branch is the only place a retry is armed; once `attempt == MAX` the row goes `exhausted` and no `setTimeout` is scheduled — a 4th `fetch` is structurally impossible.

**How it stays off-path**: `dispatch()` does the two synchronous INSERTs, then `scheduleAttempt(id, 0)` and returns; the `PATCH` handler never `await`s `deliver()`. Every retry is likewise a fresh `setTimeout` tick.

**How it degrades fail-safe**: `postWithTimeout` converts every `fetch` rejection into a tagged outcome (never throws); the outer `try/catch` in `deliver()` swallows anything else (a rejected repo write, a serializer error). `deliver()` resolves `void` in every path — mirroring the auto-move engine's "log-and-return, never rethrow" posture and the `activity.capture.error` try/catch in `cards.routes.ts`.

### Edge Case Handling
| Edge Case | Handling |
|-----------|----------|
| 2xx first attempt | row 2 → `delivered`, `attempts:1`, `delivered_at` set, one `fetch` |
| Flap then success on retry | fail → `failed` + 30s retry; next attempt 2xx → `delivered` (rows 3/4 then 2) |
| All 3 fail | rows 3/4 twice, then row 5 → `exhausted`; exactly 3 `fetch`; `rules.webhook_exhausted` logged once |
| Timeout | `AbortController` → `timeout_or_network` → `WEBHOOK_TIMEOUT`, `last_status_code:null`, retry if `A<MAX` |
| Network error | `fetch` rejects → `timeout_or_network` → `WEBHOOK_TIMEOUT` (same as timeout) |
| DB write throws mid-lifecycle | outer `catch` → `rules.webhook_failed` (`WEBHOOK_DISPATCH_ERROR`) logged, swallowed; row left as-is (durability = arch.) |
| Row already terminal | terminal-guard → no-op (no `fetch`, no mutation, no log) |
| Row missing | `findById → null` → no-op |
| `webhook_url == null` | `dispatch()` creates **no** delivery row and never schedules `deliver()` |
| Unexpected throw | outer `catch` swallows; `deliver()` still resolves; process never crashes |

### Error Handling
| Error Condition | Response |
|-----------------|----------|
| `fetch` non-2xx | classify `WEBHOOK_NON_2XX`, set `last_status_code`, `failed`+retry or `exhausted` |
| `fetch` timeout (`AbortError`) | classify `WEBHOOK_TIMEOUT`, `last_status_code:null`, `failed`+retry or `exhausted` |
| `fetch` network/DNS/TLS reject | classify `WEBHOOK_TIMEOUT` (frozen), same as timeout |
| final attempt fails (`A==MAX`) | `exhausted`, `last_error:WEBHOOK_EXHAUSTED`, `rules.webhook_exhausted` error log |
| `markFailed`/`markDelivered`/`markExhausted` rejects | outer `catch`, logged, swallowed; no rethrow, no crash; no retry armed if the throw pre-empted `scheduleAttempt` |
| `deliver()` called on terminal/missing row | no-op |

## Performance Expectations

### At Current Scale
- On-path: 2 INSERTs only; webhook latency never enters the PATCH budget.
- Off-path per delivery: 1–3 `fetch` (≤5s each) + 0–2 × 30s timers + 1–3 status-writes.
- Memory: O(1) per in-flight delivery (one timer handle + one `AbortController`).

### At 10x Scale
- Latency/attempts unchanged (attempt ceiling is a fixed constant).
- Concurrency scales with firing rate; a burst of failing deliveries arms many independent 30s timers (each O(1)). Fixed backoff could synchronise them — acceptable at this scale; jitter (Option B) is the upgrade path.
- Bottleneck (only at large scale): outbound socket pressure from many simultaneous `fetch`es — would motivate a bounded concurrency pool + a durable queue (out of scope).

### Optimization Opportunities
- **Restart durability**: a DB re-drive sweep on boot re-schedules non-terminal rows through the same `deliver()` (architecture's call).
- **Exponential backoff + jitter**: swap the fixed `WEBHOOK_RETRY_BACKOFF_MS` for a computed delay if volume grows.
- **Bounded outbound concurrency**: a semaphore around `fetch` if many deliveries fire at once.

## Validation Checklist
- [x] Meets latency requirements (zero webhook work on the PATCH critical path; p95<200ms structurally protected)
- [x] Meets memory requirements (O(1) per in-flight delivery)
- [x] Handles all edge cases (2xx / non-2xx / timeout / network / DB-throw / terminal-noop / missing-row / null-url / unexpected-throw)
- [x] Bounded & terminating (fixed 3-attempt ceiling; at most 2 retries; `delivered`/`exhausted` terminal)
- [x] Delivery status tracked separately from trigger-execution status (AC-ASYNC-3)
- [x] Fail-safe (never throws out, never crashes, never rolls back the auto-move)
- [x] Deterministic under fake timers + stubbed `fetch` (Test Strategy)
- [x] Respects Guiding Principles (simplicity-first; fail-safe liveness; injected seam; no new dependency; 12-factor env config)

## Testing Strategy

### `src/webhooks/webhooks.dispatcher.test.ts` — stubbed global `fetch` + `vi.useFakeTimers()`

Setup per test: `vi.useFakeTimers()`; `vi.stubGlobal('fetch', fakeFetch)`; inject a stub `deliveriesRepo` (in-memory row + spy `markDelivered`/`markFailed`/`markExhausted`) and a spy `log`. Advance backoff with `await vi.advanceTimersByTimeAsync(ms)` (interleaves the 30s timer **and** the awaited microtasks inside `deliver()`), so no real network and no real wall-clock sleep. `afterEach`: `vi.useRealTimers()`, `vi.unstubAllGlobals()`.

| # | Test case | Drives | Asserts | AC |
|---|-----------|--------|---------|-----|
| 1 | **2xx on first attempt → `delivered`** | `fetch` → `{status:200}` | `fetch` called **once**; `markDelivered` with `attempts:1`, `last_status_code:200`, `last_error:null`, `delivered_at` set; row terminal `delivered`; no retry timer armed | AC-HAPPY-3, AC-ASYNC-3 |
| 2 | **Payload + headers contract** | `fetch` → `{status:204}` | `fetch` called with `method:'POST'`, header `Content-Type: application/json`, and body **exactly** `{event:'rule.triggered', rule_id, board_id, card_id, card_title, from_status, to_status, triggered_by:'rule', occurred_at}` (2xx incl. 204 counts as success) | AC-HAPPY-3 |
| 3 | **Flap: non-2xx then success on retry** | attempt1 `{status:500}`; advance `30000ms`; attempt2 `{status:200}` | after attempt1: `markFailed` `attempts:1`, `last_status_code:500`, `last_error` code `WEBHOOK_NON_2XX` (`details[0]={field:'status',error:'500 is not 2xx'}`), retry armed; **no** 2nd `fetch` before advancing; after `30000ms`: 2nd `fetch`, `markDelivered` `attempts:2`; **no** 3rd `fetch` | AC-ERROR-4, AC-ASYNC-3 |
| 4 | **Timeout via `AbortController` → `failed` + retry** | `fetch` returns a promise that rejects `AbortError` when `signal` aborts; advance `WEBHOOK_TIMEOUT_MS` (5000ms) | outcome classified `WEBHOOK_TIMEOUT` (`details[0]={field:'timeout',error:'no response within 5000ms'}`), `last_status_code:null`, `attempts:1`, `failed`, retry armed | AC-ERROR-4 |
| 5 | **Network error → `WEBHOOK_TIMEOUT` + retry** | `fetch` rejects `TypeError('ECONNREFUSED')` | classified `WEBHOOK_TIMEOUT` (not a distinct code), `last_status_code:null`, `failed`, retry armed — proves timeout/network share the code | AC-ERROR-4 |
| 6 | **All 3 attempts fail → `exhausted`** | `fetch` always `{status:503}`; advance `30000ms` twice | `fetch` called **exactly 3 times**; sequence `markFailed`(A=1)→`markFailed`(A=2)→`markExhausted`(A=3); final `last_error` code `WEBHOOK_EXHAUSTED` (`details[0]={field:'attempts',error:'3 of 3 attempts failed'}`); `rules.webhook_exhausted` error log **once**; advancing timers further triggers **no 4th** `fetch` | AC-ERROR-4, AC-ASYNC-3 |
| 7 | **Lifecycle separate from trigger-execution** | any run from #3/#6 | the dispatcher **never** calls any `trigger_executions` mutator — only `webhook_deliveries` transitions; assert status path `pending→failed→…→(delivered\|exhausted)` via `markX` call order | AC-ASYNC-3 |
| 8 | **Terminal row → no-op** | seed row `status:'delivered'` (and a 2nd run with `'exhausted'`), call `deliver()` | `fetch` **not** called; no `markX` mutation; no log; resolves cleanly (idempotent re-drive) | AC-ASYNC-3 |
| 9 | **Fail-safe: `fetch` throws unexpectedly** | `fetch` throws synchronously / rejects with a non-abort error mid-run | `await expect(deliver(id)).resolves.toBeUndefined()` — no rejection; error handled (classified as timeout/network, or swallowed by outer catch); process not crashed | AC-ERROR-4 (fail-safe) |
| 10 | **Fail-safe: DB write throws mid-lifecycle** | `fetch` → `{status:500}` but `markFailed` rejects (DB down) | `deliver()` **resolves** (no rethrow, no unhandled rejection); `rules.webhook_failed`/`WEBHOOK_DISPATCH_ERROR` logged; no crash (edge case 6) | AC-ERROR-4 (fail-safe) |
| 11 | **`null` webhook_url → no delivery** | `dispatch()` a firing whose rule has `webhook_url:null` | **no** `webhook_deliveries` row created; `fetch` never called; `deliver()` never scheduled | AC-HAPPY-3 ("And" clause) |
| 12 | **Fixed 30s backoff is exact** | attempt1 fails; advance `29999ms` then `1ms` | at `29999ms` **no** retry `fetch`; at the full `30000ms` the retry fires — confirms fixed `WEBHOOK_RETRY_BACKOFF_MS`, no jitter | AC-ERROR-4 |
| 13 | **Attempt counting = 1 initial + 2 retries** | `fetch` always fails; run to terminal | `attempts` observed `1,2,3` across `markFailed`/`markExhausted`; exactly **2** retry timers armed; exactly **3** `fetch` calls — the unambiguous "3 total" assertion | AC-ERROR-4, AC-ASYNC-3 |

### Related tests (placed per Test Strategy, not in `webhooks.dispatcher.test.ts`)
- `src/webhooks/webhooks.repository.test.ts` — persistence of the lifecycle transitions (`pending→delivered`, `pending→failed→exhausted`), `last_error`/`last_status_code`/`delivered_at` mapping.
- `src/rules/rules.engine.test.ts` — the engine invokes the injected `WebhookDispatcher.dispatch` **exactly when** the fired rule has a non-null `webhook_url` (via a stub dispatcher), and creates the `trigger_executions` row regardless.
- `src/cards/cards.routes.test.ts` — a **slow/failing** stub dispatcher never delays or fails the `PATCH /cards/:id` response (off-path proof).

### What NOT to test (per Test Strategy)
- Real outbound network — `fetch` is always stubbed.
- Real wall-clock waits — backoff timers are fake (`vi.useFakeTimers`).
- `pg`/Express internals; the SSE feed (no delivery push this iteration, AC-ASYNC-3).

## Next Steps
1. **Build Phase 3** implements `src/webhooks/webhooks.dispatcher.ts` per the pseudocode: `deliver(deliveryId)` re-entrant state machine, `postWithTimeout` (`fetch` + `AbortController`), `classify`, fixed `setTimeout` retry, `pendingRetries` map for shutdown/tests.
2. Add `WEBHOOK_TIMEOUT_MS` / `WEBHOOK_MAX_ATTEMPTS` / `WEBHOOK_RETRY_BACKOFF_MS` to `src/config/env.ts` (12-factor).
3. Ensure the delivery `payload` body is built **once** at fire time and reused byte-identical on every attempt (idempotency); coordinate the storage shape with the webhook architecture doc.
4. Wire per Test Strategy: `webhooks.dispatcher.test.ts` asserts cases 1–13 with stubbed `fetch` + fake timers.
5. **Defer to the webhook architecture phase**: restart-durability (accept-and-document vs DB re-drive sweep calling the same `deliver()`), `payload` storage shape, module boundary, `WebhookDispatcher` seam placement, and SSRF policy.

---

## NEW_TERMS_INTRODUCED

- **delivery attempt** — one execution of `deliver()` = one `fetch`; `attempts` counts them `0→1→2→3`. `WEBHOOK_MAX_ATTEMPTS` (3) is the **total** ceiling: 1 initial + 2 retries.
- **`deliver(deliveryId)`** — the single re-entrant state-transition function; the sole entry point invoked by `dispatch()` (first attempt) and by each retry `setTimeout`, and the re-drive point for any future durability sweep.
- **`postWithTimeout`** — the timeout-bounded HTTP helper: `fetch` + `AbortController(WEBHOOK_TIMEOUT_MS)`; never throws — returns a tagged outcome (`ok` / `non_2xx` / `timeout_or_network`).
- **fixed backoff** — the frozen constant 30s wait (`WEBHOOK_RETRY_BACKOFF_MS`) between attempts, scheduled in-process via `setTimeout` (no exponential growth, no jitter).
- **delivery lifecycle / terminal state** — `pending → delivered | failed → exhausted`; `delivered` and `exhausted` are terminal (no further attempts). Distinct from the `trigger_executions` status (AC-ASYNC-3).
- **payload snapshot** — the POST body built **once** at fire time and reused byte-identical across all attempts, so `occurred_at` (and the receiver's idempotency key) never drift on retry.
- **at-least-once delivery** — the guarantee model: a receiver may see duplicate/late POSTs and MUST dedupe on `{ event, rule_id, card_id, from_status, to_status, occurred_at }`.
- **`pendingRetries` map** — `Map<deliveryId, Timeout>` of armed retry timers, for graceful shutdown and deterministic fake-timer tests.
- **`WEBHOOK_DISPATCH_ERROR`** — an internal (non-catalog) log-only marker used by the outer fail-safe `catch` when an unexpected throw (e.g. a rejected repo write) is swallowed; never a stored `last_error` code and never returned to any caller.
