# Algorithm Decision: Card Workflow Automation (rule-evaluation pass)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: Algorithm
**Task**: TASK-006 / FEAT-006 (Level 3)
**Consumes (frozen, do NOT re-litigate)**: `memory-bank/creative/TASK-006-card-workflow-automation-architecture.md` — normalized `condition_field/operator/value` storage; SYNCHRONOUS in-request evaluation inside `PATCH /cards/:id`; canonical condition model `{ field:'status', operator:'eq', value:CardStatus }`; injected fail-safe `CardRuleEngine` seam invoked after the FEAT-005 capture block.

**Scope of this doc — the three decisions this Algorithm phase OWNS:**
1. **Loop-prevention / cycle-detection strategy.**
2. **The concrete hop bound** (a small fixed constant, per AC-ERROR-1).
3. **Rule-match ambiguity policy + self-loop handling.**

---

## Problem Statement

On a real status transition during `PATCH /cards/:id`, the engine must evaluate the card's post-update status against its board's **enabled** rules and apply zero or more rule-driven auto-move "hops," synchronously, before the handler responds. Each rule is a single status-equality predicate mapped to a target status: `condition.value === card.status ⇒ move card to target_status`. Because both the matched value and the target are drawn from the same three-status enum `CARD_STATUSES = {todo, in_progress, done}`, **the engine is walking a directed transition graph over exactly 3 nodes**. The algorithm must:

- Terminate **always** (never loop forever) — AC-ERROR-1.
- Never **falsely block** a legitimate acyclic multi-hop chain (e.g. `todo → in_progress → done`) — AC-ASYNC-2.
- Deterministically resolve which rule fires when **multiple enabled rules match** the same status.
- Handle a **self-loop** rule (`condition.value === target_status`) sanely.
- Be **fail-safe**: on a cycle trip or a thrown repository call, log a structured event and return the **last-applied** card; never throw; never roll back already-committed hops (AC-ERROR-1 / AC-ERROR-3 / AC-ASYNC-2).
- Stay inside the p95 < 200ms budget under synchronous evaluation (`productBrief.md`).

### The finite-state reality (the key lever)

With only **3 statuses**, the maximum number of *distinct* statuses a card can pass through in one pass is 3, so any legitimate **acyclic** chain is at most **|CARD_STATUSES| − 1 = 2 hops** (`todo → in_progress → done`). Any 3rd distinct hop is impossible — it must revisit an already-occupied status. In the frozen model, conditions depend **only** on `status` and are **deterministic** (the same status always fires the same rule), therefore **re-entering a status is, by definition, the start of an infinite loop** — a re-visit *is* a cycle, with no false-positive ambiguity in this model. This single fact lets us pick a tight, provably-correct detector and a small constant bound rather than an arbitrary large number.

## Inputs & Outputs

### Inputs
| Name | Type | Size/Range | Source |
|------|------|------------|--------|
| `card` | `Card` (post-manual-update) | one row; `status ∈ CARD_STATUSES` | `cardsRepo.update()` result in `PATCH /cards/:id` |
| enabled rules | `AutomationRule[]` | small N per board (tens at most, MVP) | `rulesRepo.findEnabledByBoard(card.board_id)` — **one read per pass**, ordered `id ASC` |
| `MAX_HOPS` | `number` (compile-time const) | `CARD_STATUSES.length` = 3 | `rules.engine.ts` constant (not env-configurable) |

### Outputs
| Name | Type | Description |
|------|------|-------------|
| final card | `Card` | The last-successfully-applied card state; the `PATCH` response body reflects this. |
| per-hop `card_activity` | side effect | One `triggered_by:'rule'` + `rule_id` row per applied hop, emitted via `ActivityEmitter`. |
| structured logs | side effect | `rules.applied` (info per hop), `rules.cycle_detected` / `rules.execution_failed` (error). |

### Edge Cases
1. **No rule matches the post-update status** — natural termination, zero hops, return the input card unchanged. No activity, no logs beyond none.
2. **Single match, target differs** — one hop; return moved card (AC-HAPPY-2).
3. **Legitimate 2-hop chain** (`todo → in_progress → done`) — two hops, two activity rows, final = `done`, no cycle log (AC-ASYNC-2).
4. **Cycle** (A: `in_progress → done`, B: `done → in_progress`) — apply A, detect revisit on B, halt; card left at `done`; `rules.cycle_detected` logged; still 200 (AC-ERROR-1).
5. **Multiple enabled rules match the same status** — first-match-wins by lowest `id`; only that rule fires this hop; re-evaluate from the new status.
6. **Self-loop rule** (`status=done → done`) — rejected at rule validation time; at runtime the visited-status detector no-ops it (target already visited) and logs a cycle, never applying it.
7. **Thrown repository call mid-pass** — caught, `rules.execution_failed` logged, return last-applied card; committed hops stay committed (AC-ERROR-3 / AC-ASYNC-2).
8. **`findEnabledByBoard` throws** — caught, `rules.execution_failed`, return the input (manual) card unchanged.
9. **Disabled rules** — never fetched (`findEnabledByBoard` filters `enabled = true`); engine never considers them.

### Invariants
- **Termination**: every pass halts in ≤ `MAX_HOPS` hop-attempts.
- **No false block**: a legitimate acyclic chain (distinct statuses) is never interrupted.
- **No spurious write**: the hop that would form a cycle is detected **before** it is applied, so no bogus revisit `card_activity` row is emitted.
- **Fail-safe**: `evaluate()` never throws and never turns the caller's PATCH into a 500.
- **No rollback**: hops committed before a fault remain committed.

## Constraints

### Performance Requirements
- **Maximum Latency**: engine adds work to the synchronous `PATCH /cards/:id` path; must stay well within API p95 < 200ms / p99 < 500ms (`productBrief.md`).
- **Query budget per pass**: 1 `SELECT` (rules, once) + per applied hop 1 `UPDATE` + 1 `INSERT`. Worst legitimate case = `1 + 2·2 = 5` single-row indexed queries.
- **Throughput**: modest small-team concurrency (`productBrief.md`); no high-volume path.

### Scale Requirements
- **Current data size**: tens of enabled rules per board at most; thousands of cards per board (`productBrief.md`) but the pass touches exactly one card.
- **Expected growth**: bounded by design — the hop count does **not** grow with rule count or card count; it is capped by the status-enum size.
- **Peak load**: low peak-to-average (internal team tool).

### Other Constraints
- No async/queue/scheduler infra; the pass is in-process and synchronous.
- No cross-repository transaction / unit-of-work — each hop's `update` commits atomically on its own (AC-ASYNC-2 no-rollback).
- Bound MUST be a **small fixed constant, not per-rule configurable** (AC-ERROR-1) to protect the latency budget.
- Fail-safe liveness (systemPatterns Guiding Principle) — the engine must never crash the process.

---

## Options Explored

### Option 1: Max-hop counter only

- **Approach**: Count applied hops; loop while `hops < H`; on hitting `H` with a rule still matching, declare a cycle and halt. No memory of which statuses were visited.
- **Pseudocode**:
  ```
  hops = 0
  while hops < H:
      rule = firstMatch(rules, current.status)
      if rule is null: break            // natural end
      apply(rule); current = moved; hops++
  if hops == H and firstMatch(rules, current.status): log cycle
  return current
  ```
- **Time Complexity**: Best `O(N)` (one scan, no match). Average `O(N·h)`. Worst `O(N·H)`, `N` = enabled rules, `H` = bound.
- **Query count per pass**: `1 SELECT + 2·hops` writes; worst `1 + 2H`.
- **Space Complexity**: `O(1)` (just a counter).
- **Data Structures**: an integer counter.
- **Pros**:
  - Trivially simple; guaranteed termination.
  - With `H = |CARD_STATUSES| − 1 = 2`, never falsely blocks a legitimate chain.
- **Cons**:
  - **Applies the cycle-forming hop before halting** — it moves the card into the revisit and emits a bogus `card_activity` row, *then* notices. On the AC-ERROR-1 example it leaves the card at `in_progress` after a spurious `done → in_progress` write.
  - Cannot distinguish "stopped because genuinely done" from "stopped because of a cycle" as cleanly — it must re-probe `firstMatch` after the loop.
  - The constant is an *external* guess, not derived from the graph's structure.
- **Best For**: models where "revisit" is not necessarily a cycle (richer, non-deterministic conditions).
- **Worst For**: our deterministic status-only model, where it wastes a hop and emits a spurious event before halting.

### Option 2: Visited-status set (chosen core)

- **Approach**: Track the set of statuses the card has occupied this pass (seeded with the post-update status). Before applying a hop, if the rule's `target_status` is already in the set, the move would revisit an occupied status — in a deterministic status-only model that is definitionally a cycle — so halt **before** applying. Naturally bounded: at most `|CARD_STATUSES|` distinct statuses can be visited.
- **Pseudocode**:
  ```
  visited = { current.status }
  while true:
      rule = firstMatch(rules, current.status)
      if rule is null: break                 // natural end
      if visited.has(rule.target_status):     // revisit == cycle
          log cycle; break                     // do NOT apply
      apply(rule); current = moved; visited.add(current.status)
  return current
  ```
- **Time Complexity**: Best `O(N)`. Average/Worst `O(N·|statuses|)` = `O(N)` since `|statuses|` is 3 (constant).
- **Query count per pass**: `1 SELECT + 2·hops`; **worst = `1 + 2·2 = 5`** (at most 2 applied hops before the set fills and the next attempt is a revisit).
- **Space Complexity**: `O(|statuses|)` = `O(1)` (≤ 3 entries).
- **Data Structures**: a `Set<CardStatus>`.
- **Pros**:
  - **Semantically correct detector**: halts a cycle at the exact hop that would loop, on the earliest attempt.
  - **No false blocks** in the frozen model (revisit ≡ cycle for deterministic status-only conditions).
  - **No spurious write** — detects before applying, so no bogus revisit `card_activity`.
  - Tightly self-bounding by the graph's node count; ≤ 2 applied hops in practice.
- **Cons**:
  - Slightly more state than a counter (a 3-element set) — negligible.
  - The "revisit ≡ cycle" reasoning is model-specific; a future non-deterministic/multi-field condition model could make a revisit legitimate (mitigated by the defensive ceiling in Option 3 and flagged for re-review then).
- **Best For**: small, deterministic transition graphs (exactly this feature).
- **Worst For**: models where the same status can be legitimately re-entered under changed non-status context (out of scope this iteration).

### Option 3: Visited-status set + defensive `MAX_HOPS` ceiling (chosen)

- **Approach**: Option 2 as the operative detector, **plus** an explicit compile-time `MAX_HOPS = CARD_STATUSES.length` loop ceiling as belt-and-suspenders. The visited-status check is what fires today; the counter is a hard liveness guarantee that survives even if the "revisit ≡ cycle" invariant is ever weakened by a future model change.
- **Pseudocode**: see [Algorithm Steps](#algorithm-steps) — the full evaluation pass.
- **Time Complexity**: identical to Option 2 — `O(N)` (constant `|statuses|`).
- **Query count per pass**: identical — worst `1 + 2·2 = 5`; even the defensive ceiling of 3 applied hops is only `1 + 6 = 7` tiny queries.
- **Space Complexity**: `O(1)`.
- **Data Structures**: a `Set<CardStatus>` + an integer counter.
- **Pros**:
  - Everything in Option 2, plus a **structural, self-documenting bound** (`MAX_HOPS = |CARD_STATUSES|`) that directly satisfies AC-ERROR-1's "small fixed constant."
  - Guaranteed termination **independent of** the correctness of the visited-status reasoning — two independent guards.
  - `MAX_HOPS` derived from `CARD_STATUSES.length` auto-scales if a status is ever added, and localizes the "why 3?" answer in one constant.
- **Cons**:
  - The ceiling branch is effectively **dead code today** (the visited set always trips first). Accepted as cheap, documented insurance consistent with the codebase's fail-safe posture.
- **Best For**: a synchronous, latency-budgeted, fail-safe engine on a tiny transition graph — this feature exactly.
- **Worst For**: nothing within scope; the redundancy is intentional.

### Option 4: Visited-rule-id set

- **Approach**: Track which rule ids have fired; halt when a rule is about to fire twice. Bounds hops to the number of enabled rules `N`.
- **Time Complexity**: `O(N²)` worst (scan × up to N firings). **Query count**: `1 + 2·N` worst.
- **Space Complexity**: `O(N)`.
- **Pros**: Terminates; allows each distinct rule to fire once.
- **Cons**:
  - **Bound = N is not a small fixed constant** — it grows with the number of rules a board owner creates, directly violating AC-ERROR-1 and threatening the p95 budget (a board with many rules forming a long distinct-rule chain could apply many hops synchronously).
  - Doesn't exploit the 3-node reality at all; strictly looser than the status-based detectors.
  - A 3-rule status cycle (A `todo→in_progress`, B `in_progress→done`, C `done→todo`) fires all 3 distinct rules (3 hops + spurious writes) before the 4th attempt repeats a rule — more hops and more spurious activity than Option 3.
- **Best For**: graphs where nodes are effectively unbounded and rules are the natural unit — not this feature.
- **Worst For**: latency-budgeted synchronous evaluation with a small status enum. **Rejected.**

---

## Complexity Comparison

| Metric | Opt 1: Hop counter | Opt 2: Visited-status | Opt 3: Visited + ceiling | Opt 4: Visited-rule-id |
|--------|:-:|:-:|:-:|:-:|
| Time (Best) | O(N) | O(N) | O(N) | O(N) |
| Time (Avg) | O(N·h) | O(N) | O(N) | O(N·h) |
| Time (Worst) | O(N·H) | O(N) | O(N) | O(N²) |
| Space | O(1) | O(1) | O(1) | O(N) |
| Worst query count / pass | 1 + 2H | **1 + 4** | **1 + 4** | 1 + 2N |
| Bound is a small fixed const | ✔ (if H fixed) | ✔ (structural) | ✔✔ (explicit + structural) | **✘ (= N)** |
| Detects cycle before applying | ✘ | ✔ | ✔ | ✘ |
| False-block risk (this model) | none (H=2) | none | none | none |
| Implementation | Simple | Simple | Simple | Medium |

## Performance Projection

At expected scale (tens of enabled rules/board; one card per pass):
| Option | Expected Latency (added to PATCH) | Memory Usage |
|--------|------------------|--------------|
| Opt 3 (chosen), typical (0–1 hop) | 1 SELECT (+ optional 1 UPDATE + 1 INSERT) ≈ sub-ms–low-single-digit ms | O(1) — a 3-element set + counter |
| Opt 3 (chosen), worst legitimate (2 hops) | 5 single-row indexed queries ≈ a few ms | O(1) |
| Opt 3 (chosen), cycle halt | ≤ 1 applied hop + in-memory detect ≈ ≤ 3 queries | O(1) |

All comfortably inside p95 < 200ms. The pass cost is **independent of rule count for hop purposes** (only the in-memory `firstMatch` scan is `O(N)`, N tiny) — the guardrail that makes synchronous evaluation safe.

---

## Decision

### Decision 1 — Cycle-detection strategy

**Chosen**: **Option 3 — a visited-status `Set<CardStatus>` as the operative cycle detector, backed by a defensive `MAX_HOPS` ceiling.**

The engine seeds `visited` with the card's post-update status and, before each hop, refuses to move to a `target_status` already in `visited`. In the frozen deterministic status-only model, re-entering a status is definitionally the onset of an infinite loop, so this detector is **both correct and tight**: it never falsely blocks a legitimate acyclic chain (those visit only distinct statuses), and it halts a real cycle on the *attempt* to revisit — before applying the looping hop, so no spurious `card_activity` row is written. The `MAX_HOPS` counter is a second, independent liveness guarantee.

**Why not the alternatives**: a pure hop counter (Opt 1) applies the cycle-forming hop before noticing, emitting a bogus event and leaving the card one step further along a loop it already knows is bad. A visited-rule-id set (Opt 4) bounds hops by the number of rules — not a small fixed constant, in direct conflict with AC-ERROR-1 and the p95 budget.

### Decision 2 — The concrete bound

**Chosen**: **`MAX_HOPS = CARD_STATUSES.length` (= `3`)**, a compile-time constant in `rules.engine.ts`, **not** env- or per-rule-configurable.

Justification, tied to the 3-node graph:
- A legitimate **acyclic** chain visits distinct statuses, so it is at most `|CARD_STATUSES| − 1 = 2` hops. A bound of 2 already covers every legitimate chain; setting the ceiling one higher (`3 = |CARD_STATUSES|`) means the **visited-status detector always fires first** on a real cycle (it trips on the revisit attempt once the set holds all 3 statuses, i.e. after ≤ 2 applied hops), and the counter only ever engages if the visited logic is later weakened — pure insurance.
- Self-documenting: "a card may occupy each of the N statuses at most once per pass; an (N)th distinct hop is impossible." Deriving the constant from `CARD_STATUSES.length` keeps the rationale in one place and auto-scales if a status is added.
- **Latency**: at the bound the pass issues at most `1 + 2·2 = 5` single-row indexed queries (even the defensive 3-hop ceiling is `7`), i.e. low-single-digit ms — trivially inside p95 < 200ms under synchronous evaluation. This is exactly why the architecture phase could confirm synchronous timing: the bound is small and fixed.

### Decision 3 — Rule-match ambiguity + self-loop policy

**Chosen (multi-match)**: **First-match-wins at runtime, ordered by `id` ASC.** `findEnabledByBoard` returns enabled rules ordered `ORDER BY id ASC` (the house idiom used by `cards`/`activity`); at each hop the engine fires the **first** rule whose `condition.value === current.status`, then re-evaluates from the new status.

- **Why runtime first-match, not validation-time conflict rejection**: rejecting overlapping conditions at `POST/PATCH /rules` requires a board-scoped cross-row read on every rule write, races between concurrent creations, and re-checks on every `enabled` toggle — a **new cross-row validation pattern the codebase does not have**, in tension with simplicity-first. Runtime first-match keeps the policy self-contained in the engine, is fully deterministic, and **degrades gracefully** (a misconfiguration produces a defined move, never a rejected write or a runtime error).
- **Why `id`, not `created_at`**: `id` is the identity PK — monotonic with creation, guaranteed unique (two rules created in the same tick could tie on `created_at`), and already the repository's natural ordering. Deterministic and stable.
- **Why not "runtime error"**: throwing (even if caught) on ambiguity is user-hostile — it turns a benign overlap into "no automation happened," worse than a predictable pick, and fights the fail-safe ethos.

**Chosen (self-loop, `condition.value === target_status`)**: **Reject at rule-validation time**, with a runtime backstop.
- **Validation-time rejection** (`rules.validation.ts`): a self-loop is statically detectable from a **single rule's own fields** (no cross-row analysis needed, unlike multi-match), and it is never meaningful ("move a `done` card to `done`" does nothing but seed an instant loop). Reject with `INVALID_RULE`, `details: [{ field: 'target_status', error: 'target_status must differ from condition.value (a rule cannot move a card to the status it matches)' }]`. This also aligns with AC-HAPPY-2's phrasing ("a `target_status` different from that matched status").
- **Runtime backstop**: even if a self-loop row somehow exists (legacy/manual insert), the visited-status detector catches it on the **first** hop attempt (`target === current.status`, already in `visited`) → the move is never applied, `rules.cycle_detected` is logged, and the card is returned unchanged. The engine is robust regardless of validation.

### Trade-offs Accepted
- **Visited-status reasoning is model-specific.** If a future iteration adds non-status or non-deterministic conditions where a status can legitimately be re-entered, the "revisit ≡ cycle" premise weakens. Mitigation: the `MAX_HOPS` ceiling still guarantees termination, and this doc flags the re-review trigger explicitly.
- **First-match-wins can silently ignore an overlapping rule.** Accepted: deterministic and non-destructive; the operator can observe which rule fired via the `rule_id` on the emitted activity, and a validation-time conflict policy remains an open, non-breaking future enhancement.
- **`MAX_HOPS` ceiling is dead code today.** Accepted as cheap, documented insurance consistent with fail-safe liveness.
- **No rollback across hops.** Inherited from the architecture decision / AC-ASYNC-2; the codebase has no unit-of-work pattern.

---

## Implementation Details

### Data Structures
| Structure | Purpose | Operations Used |
|-----------|---------|-----------------|
| `Set<CardStatus>` (`visited`) | Cycle detector — statuses occupied this pass | `has` / `add` — O(1), ≤ 3 entries |
| `number` (`hops`) | Defensive `MAX_HOPS` ceiling counter | increment / compare — O(1) |
| `AutomationRule[]` (ordered `id ASC`) | Enabled rules for the board | linear `firstMatch` scan — O(N), N tiny |

### Algorithm Steps

```
CARD_STATUSES = ['todo', 'in_progress', 'done']
MAX_HOPS = CARD_STATUSES.length          // = 3, compile-time const, NOT env/per-rule configurable

// Single entry. NEVER throws. Returns the last-successfully-applied card.
async function evaluate(card):            // `card` = post-manual-update state
    try:
        rules = await rulesRepo.findEnabledByBoard(card.board_id)   // ONE read, ordered id ASC
    catch err:
        log('error', 'rules.execution_failed',
            { code: 'RULE_EXECUTION_FAILED', card_id: card.id, board_id: card.board_id, message: str(err) })
        return card                        // fail-safe: manual card stands (AC-ERROR-3)

    current = card
    visited = new Set([current.status])
    hops = 0

    while hops < MAX_HOPS:                              // defensive ceiling
        rule = firstMatch(rules, current.status)       // first (lowest id) enabled rule matching current.status
        if rule == null:
            break                                       // NATURAL termination — no rule matches

        target = rule.target_status
        if visited.has(target):                         // ← CYCLE TRIPS HERE (revisit == cycle), BEFORE applying
            log('error', 'rules.cycle_detected',
                { code: 'RULE_CYCLE_DETECTED', card_id: current.id, board_id: current.board_id,
                  hops, last_status: current.status })
            return current                              // leave at last-applied status; still 200 (AC-ERROR-1)

        try:
            result = await cardsRepo.update(current.id, { status: target })   // atomic single-hop write
            event  = await activityRepo.record(
                { board_id: current.board_id, card_id: current.id, card_title: current.title,
                  from_status: current.status, to_status: target,
                  triggered_by: 'rule', rule_id: rule.id })                    // per-hop activity (AC-ASYNC-2)
            activityEmitter.emit(current.board_id, event)                      // reuse FEAT-005 fan-out
            log('info', 'rules.applied',
                { card_id: current.id, board_id: current.board_id, rule_id: rule.id,
                  from_status: current.status, to_status: target, activity_id: event.id })
        catch err:
            log('error', 'rules.execution_failed',
                { code: 'RULE_EXECUTION_FAILED', card_id: current.id, board_id: current.board_id,
                  rule_id: rule.id, message: str(err) })
            return current                              // fail-safe: committed hops stay committed (AC-ASYNC-2)

        current = result.card
        visited.add(current.status)
        hops += 1

    // Defensive ceiling: only reachable if the visited detector is ever weakened (dead code in the 3-status model).
    if hops == MAX_HOPS and firstMatch(rules, current.status) != null:
        log('error', 'rules.cycle_detected',
            { code: 'RULE_CYCLE_DETECTED', card_id: current.id, board_id: current.board_id,
              hops, last_status: current.status })

    return current

function firstMatch(rules, status):        // rules already ordered id ASC ⇒ first-match-wins by lowest id
    for rule in rules:
        if rule.condition.field == 'status' and rule.condition.operator == 'eq'
               and rule.condition.value == status:
            return rule
    return null
```

**Where the cycle trips**: the `visited.has(target)` guard, *before* the write — so a cycle never emits a spurious revisit activity row and the card is left at the last legitimately-applied status. On the AC-ERROR-1 example (A `in_progress→done`, B `done→in_progress`, card at `in_progress`): apply A → `done`; attempt B → `in_progress ∈ visited` → `rules.cycle_detected` (hops=1), return card at `done`, PATCH still 200.

**How it degrades to "return last-applied, log, still 200"**: every faulting path (`findEnabledByBoard` throws, a hop's `update`/`record` throws, a cycle trips, the defensive ceiling) `log`s a structured event and `return`s `current` (the last successfully applied card, or the input card if nothing applied). `evaluate` never rethrows. The route's own try/catch around `ruleEngine.evaluate(card)` (architecture Decision 3) is defense-in-depth so even an engine defect cannot 500 the caller's PATCH.

### Edge Case Handling
| Edge Case | Handling |
|-----------|----------|
| No matching rule | `firstMatch` returns null → `break` → return input card, zero side effects |
| Legitimate 2-hop chain | Two hops applied, two activity rows, final = terminal status, no cycle log |
| Cycle (A/B pair) | Apply first hop, detect revisit on second (`visited.has(target)`), halt at last-applied, log `rules.cycle_detected` |
| Multiple matches on a status | `firstMatch` returns lowest-`id` enabled rule; only it fires this hop |
| Self-loop rule at runtime | `target === current.status ∈ visited` on first attempt → not applied, log cycle, return unchanged |
| Self-loop rule at creation | Rejected `400 INVALID_RULE` in `rules.validation.ts` (single-rule static check) |
| Disabled rule | Never returned by `findEnabledByBoard`; invisible to the engine |

### Error Handling
| Error Condition | Response |
|-----------------|----------|
| `findEnabledByBoard` rejects | Catch, `rules.execution_failed`, return input card (no hops) |
| `cardsRepo.update` rejects mid-hop | Catch, `rules.execution_failed`, return last-applied card; prior hops stay committed |
| `activityRepo.record` rejects on an applied hop | Catch, `rules.execution_failed`, return last-applied card (the status move already persisted; no rethrow) |
| Cycle / hop-ceiling | `rules.cycle_detected`, return last-applied card; PATCH still 200 |

## Performance Expectations

### At Current Scale
- Expected latency: typical pass (0–1 hop) adds 1 SELECT (+ optional 1 UPDATE + 1 INSERT) ≈ sub-ms to low-single-digit ms.
- Memory usage: O(1) per pass (a ≤3-element set + a counter).
- Throughput: unbounded relative to rule/card counts — hop count is capped by the status enum.

### At 10x Scale
- Expected latency: unchanged for hops (bound is structural, not data-dependent); the only `O(N)` term is the in-memory `firstMatch` scan over enabled rules — negligible at tens-to-hundreds of rules.
- Memory usage: O(1).
- Bottlenecks: none from this algorithm; if a board ever had thousands of enabled rules, the per-hop linear scan could be indexed by `condition_value` into a `Map<CardStatus, AutomationRule[]>` built once per pass (see below) — not needed at MVP.

### Optimization Opportunities
- **Index rules by source status**: build a `Map<CardStatus, AutomationRule>` (first rule per status) once per pass to make `firstMatch` O(1). Deferred — N is tiny; premature at MVP (simplicity-first).
- **Validation-time conflict policy**: promote overlapping-condition detection to `POST/PATCH /rules` if operators report confusion — non-breaking future enhancement.

## Validation Checklist

- [x] Meets latency requirements (≤ 5 tiny queries at the bound; well inside p95 < 200ms)
- [x] Meets memory requirements (O(1) per pass)
- [x] Handles all edge cases (match/no-match/chain/cycle/multi-match/self-loop/disabled/throw)
- [x] Scales to expected data size (hop count independent of rule/card counts)
- [x] Implementation feasible (pure in-memory logic over injected repos; mirrors existing seams)
- [x] Respects Guiding Principles and data flow patterns in systemPatterns.md (simplicity-first; fail-safe liveness; injected seam; reuses `ActivityEmitter`/repositories; no new infra)

## Testing Strategy

### Unit Tests — `src/rules/rules.engine.test.ts` (stub `rulesRepo`, `cardsRepo`, `activityRepo`, `activityEmitter`)

The build/test phase MUST assert:

1. **Match → single auto-move**: one enabled rule `status=in_progress → done`; card at `in_progress`. Assert `evaluate` returns a card with `status: 'done'`; `cardsRepo.update` called **once** with `{ status: 'done' }`; `activityRepo.record` called **once** with `triggered_by: 'rule'`, `rule_id` = the rule, `from_status: 'in_progress'`, `to_status: 'done'`; `emit` called **once**.
2. **No match → no-op**: no enabled rule matches `card.status`. Assert `evaluate` returns the input card unchanged; `cardsRepo.update`, `activityRepo.record`, `emit` **not called**.
3. **Disabled rule → no-op**: `findEnabledByBoard` returns `[]` (the disabled rule is filtered out). Assert no move, no activity — the engine only ever sees enabled rules.
4. **Legitimate 2-hop chain (AC-ASYNC-2)**: Rule A `todo → in_progress`, Rule B `in_progress → done`; card at `todo`. Assert final `status: 'done'`; `cardsRepo.update` called **twice** (`→in_progress`, then `→done`); **two** `activityRepo.record` calls, each tagged with its **driving** `rule_id` (A then B); `emit` called twice; **no** `rules.cycle_detected` log.
5. **Multi-match ordering — first-match-wins by `id` ASC**: two enabled rules both `condition.value='todo'`, id=1 → `in_progress`, id=2 → `done`, provided in `id ASC` order; card at `todo`. Assert the **id=1** rule fires first (move to `in_progress`), and the first `record` call carries `rule_id === 1`. (Confirms deterministic lowest-id selection at each hop.)
6. **Cycle halt at the bound (AC-ERROR-1)**: Rule A `in_progress → done`, Rule B `done → in_progress`; card at `in_progress`. Assert `cardsRepo.update` called **exactly once** (only the A hop; the B/revisit hop is **never applied**); `evaluate` returns the card at **`done`** (last-applied); `log('error', 'rules.cycle_detected', { code: 'RULE_CYCLE_DETECTED', hops: 1, last_status: 'done', ... })` emitted **once**; `evaluate` does **not throw**.
7. **Self-loop runtime backstop**: an enabled rule `status=done → done`; card at `done`. Assert `cardsRepo.update` **not called**; `evaluate` returns the card unchanged at `done`; `rules.cycle_detected` logged (target already in `visited` on first attempt).
8. **Fail-safe on thrown `cardsRepo.update` (AC-ERROR-3)**: a matching rule, but `cardsRepo.update` rejects on the first hop. Assert `evaluate` **does not rethrow**; returns the **input** card; `log('error', 'rules.execution_failed', { code: 'RULE_EXECUTION_FAILED', ... })` emitted.
9. **Fail-safe on thrown `findEnabledByBoard`**: `findEnabledByBoard` rejects. Assert `evaluate` returns the input card unchanged, logs `rules.execution_failed`, does not throw, and never calls `cardsRepo.update`.
10. **Partial progress preserved on mid-chain failure (AC-ASYNC-2)**: Rule A `todo → in_progress` succeeds, then hop 2 `in_progress → done` `cardsRepo.update` rejects. Assert `evaluate` returns the card at **`in_progress`** (hop 1 committed, **not** rolled back); `cardsRepo.update` called twice (2nd threw); `activityRepo.record` called **once** (hop 1 only); `rules.execution_failed` logged.
11. **Fail-safe on thrown `activityRepo.record`**: `record` rejects on an applied hop. Assert caught, `rules.execution_failed` logged, `evaluate` returns the last-applied card, no rethrow.

### Related tests (placed per Test Strategy, not in `rules.engine.test.ts`)
- `src/rules/rules.validation.test.ts` — **self-loop rejection**: `POST /rules` (and `PATCH`) with `condition.value === target_status` → `400 INVALID_RULE`, `details: [{ field: 'target_status', error: 'target_status must differ from condition.value ...' }]`. Plus multi-match is *not* a validation concern (overlapping conditions are permitted — first-match-wins at runtime).
- `src/cards/cards.routes.test.ts` — **PATCH integration** with a **stub `RuleEngine`**: (a) response body reflects the engine's **final** status (not the client-requested one); (b) `ruleEngine.evaluate` invoked with the post-transition card, only inside the real-transition gate; (c) a **thrown** `evaluate` still yields **200** with the manually-applied card (route-level defensive catch → `rules.execution_failed`).

### Performance Tests
- Benchmark a 2-hop pass end-to-end asserting ≤ ~5 repo calls and completion well under the p95 budget in a Supertest timing harness (optional — the query-count assertions in tests 4/6 already bound the work).
- Stress: a 3-rule status cycle confirms termination in ≤ 2 applied hops with a single `rules.cycle_detected`.

## Next Steps

1. **Build Phase 2** implements `CardRuleEngine.evaluate` per the pseudocode above: `MAX_HOPS = CARD_STATUSES.length`, visited-status `Set`, first-match-wins over `id ASC` rules, internally fail-safe.
2. `rulesRepo.findEnabledByBoard(boardId)` returns `enabled = true` rules **ordered `id ASC`** (the ordering that makes first-match deterministic).
3. `rules.validation.ts` adds the **self-loop rejection** check (`condition.value === target_status`) alongside the frozen field/operator/value checks.
4. Wire per Test Strategy: `rules.engine.test.ts` asserts cases 1–11; `rules.validation.test.ts` asserts self-loop rejection; `cards.routes.test.ts` asserts the PATCH integration with a stub engine.

---

## NEW_TERMS_INTRODUCED

- **transition graph** — the directed graph the engine walks: nodes are `CARD_STATUSES` (3), edges are enabled rules (`condition.value → target_status`).
- **visited-status set** — the per-pass `Set<CardStatus>` of statuses the card has occupied; the operative cycle detector (a move to an already-visited status is a cycle in the deterministic status-only model).
- **MAX_HOPS** — the compile-time defensive hop ceiling, `= CARD_STATUSES.length` (3); a second, independent termination guarantee. Not env/per-rule configurable (AC-ERROR-1).
- **first-match-wins** — the multi-match policy: when several enabled rules match a status, the one with the lowest `id` fires that hop (rules fetched `ORDER BY id ASC`).
- **self-loop rule** — a rule whose `condition.value === target_status`; rejected at rule validation, no-opped by the visited-status detector at runtime.
- **cycle trip** — the point (`visited.has(target)`) at which the engine detects a cycle and halts *before* applying the looping hop, logging `rules.cycle_detected`.
