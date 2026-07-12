# Learning Log

Chronological record of pattern extraction and consolidation events from task reflections.

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

## 2026-07-13 - Consolidation (during TASK-003 archive)

- Files before: 6, Files after: 6
- Merged: 0 files (six topics remain distinct — no >50% overlap)
- Expired: 0 bullets (all evidence within 90 days)
- Promoted: 1 file (`testing-patterns.md` low → medium at evidence_count 3; applied during reflection)
- Pruned: 0 excess bullets (all files ≤3 bullets)
