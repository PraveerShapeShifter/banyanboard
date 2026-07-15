---
name: "Learned: API Design"
globs: ["src/**/*routes*.ts", "src/**/*.routes.ts"]
topics: ["api-design", "rest"]
priority: medium
evidence_count: 3
last_updated: 2026-07-16
auto_generated: true
---

# API Design

- Treat an unparseable/out-of-range resource `:id` (non-numeric, zero, negative) as `404 Not Found` rather than `400`, applied consistently across GET/PATCH/DELETE — it avoids leaking a format-vs-existence distinction and keeps not-found semantics uniform.
- Validate a foreign-key reference against the parent's repository (`parentRepo.findById`) and return a dedicated `400` *before* insert, so a well-formed-but-dangling FK never surfaces as a leaked DB constraint-violation `500`.
- When a new module deliberately diverges from an established response-shape convention, state the divergence and an explicit "do not homogenize this" instruction directly in the spec next to the affected AC — not only in a design doc a future agent may not load — so a later build/review agent cannot silently "correct" the intentional difference.

## Evidence

| Learning | Source | Date |
|----------|--------|------|
| `parseBoardId` returns null for non-digit/zero/negative/overflow ids → routes respond 404 before any DB call | [reflection-TASK-002.md](../../reflection/reflection-TASK-002.md) | 2026-07-12 |
| Cards router injects `boardsRepo`; `POST /cards` checks `boardsRepo.findById(board_id)` → 400 "board_id does not reference an existing board" before insert (AC-ERROR-3) | [reflection-TASK-003.md](../../reflection/reflection-TASK-003.md) | 2026-07-13 |
| `/rules` intentionally introduces a coded `{code, message, details:[{field,error}]}` envelope diverging from the codebase-wide `{error, details}` shape; the spec embeds "this mismatch is intentional — do not fix the rules error body to match cards" next to the AC, and no build agent homogenized it | [reflection-TASK-006.md](../../reflection/reflection-TASK-006.md) | 2026-07-16 |
