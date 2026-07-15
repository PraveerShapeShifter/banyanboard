# Learning Log

Chronological record of pattern extraction and consolidation events from task reflections.

---

## 2026-07-16 - Consolidation (during TASK-006 archive)

- Files before: 10, Files after: 10
- Merged: 0 files (no pair exceeds 50% topic/glob overlap — closest is `security`↔`data-access` at 33% via the shared "security" topic)
- Expired: 0 bullets (0 files deleted — all evidence rows are ≤6 days old, well under the 90-day threshold)
- Promoted: 0 files (`api-design` was already promoted low→medium during the TASK-006 reflection at evidence_count 3; no other file is at ec≥3 with low priority)
- Pruned: 0 excess bullets (no file exceeds the 15-bullet cap)
- **At cap**: 10/10 files. Next task's extractions must amend existing files (or merge) rather than create new ones unless a merge frees a slot.

---

## 2026-07-16 - TASK-006 Reflection

### Extracted Patterns
- **async-dispatch** → created `agent-rules/_learned/async-dispatch.md` (evidence count: 1) — fire-and-forget off-request-path dispatch with a synchronously-created DB row as durable source of truth, `.unref()` timers, fully fail-safe; **folded in** the request-path performance learning (bound synchronous traversal by an enum's cardinality, `MAX_HOPS = STATUSES.length`) as a second bullet, since both protect the p95 latency budget and the cap was reached at 10 files
- **api-design** → amended `agent-rules/_learned/api-design.md` (evidence count: 3) — state a deliberate response-shape divergence + "do not homogenize" directly in the spec next to the AC, not only in a design doc. **Promoted low → medium** (crossed threshold 3).
- **security** → created `agent-rules/_learned/security.md` (evidence count: 1) — treat SSRF exposure from user-supplied outbound URLs as a mandatory documented accepted-risk decision recorded where the validation lives

### Cap Handling
- Started at 8 files, cap 10. Created 2 new files (async-dispatch, security) → 10 files. The 4th learning (performance) was folded into `async-dispatch.md` rather than creating an 11th file (cap-forced consolidate — both learnings serve request-path latency protection).

### systemPatterns.md Updates
- **Rule-engine seam + fire-and-forget webhook dispatch (TASK-006, as-built)** added to Recent Architecture Changes — `CardRuleEngine` seam (synchronous bounded auto-move on the `PATCH /cards/:id` path) + injected `WebhookDispatcher` (DB-row-source-of-truth, off-path retries), realizing the previously-aspirational "Webhook Delivery Pattern" section.

---

## 2026-07-10 - TASK-001 Reflection

### Extracted Patterns
- **testing-patterns** → created `agent-rules/_learned/testing-patterns.md` (evidence count: 1)
- **error-handling** → created `agent-rules/_learned/error-handling.md` (evidence count: 1)
- **infrastructure** → created `agent-rules/_learned/infrastructure.md` (evidence count: 1)
- **configuration** → created `agent-rules/_learned/configuration.md` (evidence count: 1)

### systemPatterns.md Updates
- None (learnings are coding/infra practices, not novel architecture patterns)

---

## 2026-07-12 - TASK-002 Reflection

### Extracted Patterns
- **testing-patterns** → amended `agent-rules/_learned/testing-patterns.md` (evidence count: 2) — stateful in-memory stub + persistence round-trips
- **error-handling** → amended `agent-rules/_learned/error-handling.md` (evidence count: 2) — central Express error middleware, headersSent guard, no leak
- **data-access** → created `agent-rules/_learned/data-access.md` (evidence count: 1) — parameterized queries incl. dynamic partial UPDATE
- **api-design** → created `agent-rules/_learned/api-design.md` (evidence count: 1) — 404 for unparseable `:id`

### systemPatterns.md Updates
- None (learnings are coding/API practices, not novel architecture patterns)

---

## 2026-07-13 - TASK-003 Reflection

### Extracted Patterns
- **api-design** → amended `agent-rules/_learned/api-design.md` (evidence count: 2) — validate FK via parent repo → 400 before insert, no leaked DB constraint error
- **data-access** → amended `agent-rules/_learned/data-access.md` (evidence count: 2) — optional filter as single `findAll(filter?)` with parameterized WHERE + indexed FK column
- **testing-patterns** → amended `agent-rules/_learned/testing-patterns.md` (evidence count: 3) — linked shared-store stubs to verify DB cascade at the orchestration layer. **Promoted low → medium** (crossed threshold 3).

### systemPatterns.md Updates
- None (learnings are coding/API/testing practices, not novel architecture patterns)

---

## 2026-07-14 - TASK-004 Reflection

### Extracted Patterns
- **frontend-patterns** → created `agent-rules/_learned/frontend-patterns.md` (evidence count: 1) — single `fetch` client with discriminated result + page async state as one status union (first frontend topic)
- **testing-patterns** → amended `agent-rules/_learned/testing-patterns.md` (evidence count: 4) — query React components by ARIA role/accessible name (a11y-assertive, refactor-resilient); widened globs to `**/*.test.tsx`
- **configuration** → amended `agent-rules/_learned/configuration.md` (evidence count: 2) — keep test runner + host bundler on same major (Vitest/Vite), verify with `npm ls`; widened scope to frontend build tooling
- **error-handling** → amended `agent-rules/_learned/error-handling.md` (evidence count: 3) — branch on specific 404 before generic error state in async UI; widened globs to frontend pages. **Promoted low → medium** (crossed threshold 3).

### systemPatterns.md Updates
- None (learnings are coding/testing/config practices, not novel architecture patterns)

### Files
- Before: 6, After: 7 (frontend-patterns.md created; still under cap 10)

---

## 2026-07-15 - TASK-005 Reflection

### Extracted Patterns
- **connection-lifecycle** → created `agent-rules/_learned/connection-lifecycle.md` (evidence count: 1) — register `req.on('close')` cleanup before any `await` with an idempotent `closed` flag; subscribe-before-backfill with cursor dedupe + validated `Last-Event-ID` (first realtime/SSE topic)
- **data-access** → amended `agent-rules/_learned/data-access.md` (evidence count: 3) — atomic old-vs-new via `FROM (SELECT …) AS old` + `RETURNING` subquery instead of SELECT-then-UPDATE. **Promoted low → medium** (crossed threshold 3).
- **frontend-patterns** → amended `agent-rules/_learned/frontend-patterns.md` (evidence count: 2) — single-seam + status-union discipline extends to a long-lived stream (connecting/open/reconnecting/degraded, reset on key change); decoupled visually-hidden `aria-live` announcer keyed for re-announce + arming heuristic; widened topics to streaming/accessibility
- **deployment** → amended `agent-rules/_learned/infrastructure.md` (evidence count: 2) — treat each new `db/init/*.sql` as deployment-affecting: init scripts run only on a fresh volume, so document/verify the non-fresh path + add a readiness signal so a missing table fails loudly not silently; widened globs to `db/init/*.sql`, topics to deployment/migrations

### systemPatterns.md Updates
- None (the three novel architecture patterns — in-process fan-out seam, write-path side-effect capture, SSE push transport with backfill/replay, and the client EventSource-seam + decoupled a11y announcer — were already documented in systemPatterns.md § Recent Architecture Changes by the build Documentation Agent during Phase 1-3 builds; no duplication needed)

### Files
- Before: 7, After: 8 (connection-lifecycle.md created; still under cap 10)

---

## 2026-07-15 - Consolidation (during TASK-005 archive)

- Files before: 8, Files after: 8
- Merged: 0 files (no pair >50% topic/glob overlap — `connection-lifecycle` is backend `src/**/*.routes.ts` streaming vs `frontend-patterns` `frontend/src/**`; they share only the `streaming`/`async` topic tags, <50%)
- Expired: 0 bullets (all evidence within 90 days; earliest 2026-07-10)
- Promoted: 0 files during consolidation (`data-access` low→medium at ec 3 was applied during TASK-005 reflection extraction, not here)
- Pruned: 0 excess bullets (all files ≤4 bullets, cap 15)

---

## 2026-07-13 - Consolidation (during TASK-003 archive)

- Files before: 6, Files after: 6
- Merged: 0 files (six topics remain distinct — no >50% overlap)
- Expired: 0 bullets (all evidence within 90 days)
- Promoted: 1 file (`testing-patterns.md` low → medium at evidence_count 3; applied during reflection)
- Pruned: 0 excess bullets (all files ≤3 bullets)

---

## 2026-07-14 - Consolidation (during TASK-004 archive)

- Files before: 7, Files after: 7
- Merged: 0 files (seven topics remain distinct; `frontend-patterns` and `error-handling` share only the `async-ui` topic tag — <50% overlap, kept separate)
- Expired: 0 bullets (all evidence within 90 days; earliest 2026-07-10)
- Promoted: 0 files during consolidation (`error-handling` low→medium at ec 3 was applied during TASK-004 reflection extraction, not here)
- Pruned: 0 excess bullets (all files ≤4 bullets, cap 15)
