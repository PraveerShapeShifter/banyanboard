# Reflection: TASK-003 — Card CRUD API

**Date**: 2026-07-13
**Task Complexity**: Level 3 (inherited from FEAT-003)
**Total Phases**: 2 (Phase 1 data layer · Phase 2 HTTP layer)
**Duration**: 2026-07-12 → 2026-07-13 (two `/banyan-build` cycles)
**Branch**: feature/FEAT-003-card-crud (in-repo, Worktree N/A; local-merge strategy)

**Ratings** — Task Quality: **High** · Ecosystem Effectiveness: **Good**

---

## Executive Summary

TASK-003 added the second domain resource in BanyanBoard: a full Card CRUD REST surface
(POST/GET/GET:id/PATCH/DELETE `/cards`) backed by a new `cards` table with a `board_id`
foreign key to `boards`, an optional `?board_id=` list filter, a `pg`-pool repository,
hand-rolled validation, and reuse of the existing central error handler. It was built in
two human-gated phases — a data layer (schema + repository) then an HTTP layer (validation
+ routes + wiring) — landing 95/95 passing tests (33 new), a clean `tsc --strict` build,
and no new dependencies.

All twelve acceptance-criteria items across four groups (AC-ENTRY-1, AC-HAPPY-1..7,
AC-ERROR-1..4) are satisfied at code and test level. The task carried three genuinely new
behaviours relative to Board CRUD, and each was handled deliberately: (1) the `ON DELETE
CASCADE` FK, verified at the orchestration layer via **linked in-memory stubs sharing state**
so a `DELETE /boards/:id` drops the board's cards exactly as Postgres would; (2) an
**application-level FK-existence check** (`board_id` referencing no board → `400`, not a
leaked Postgres FK-violation `500`); and (3) the `?board_id=` filter as a single
`findAll(boardId?)` repository method with a parameterized `WHERE` applied only when present.
`board_id` immutability on `PATCH` is enforced in the validator, not left to convention.

This was a clean, precedent-faithful Level 3 execution that extends TASK-002's module shape
almost mechanically while adding exactly the new machinery the FK relationship demands — no
more. The one open item is the live-DB smoke test (real `ON DELETE CASCADE` / FK enforcement),
deliberately manual and consistent with FEAT-001/002. As predicted in TASK-002's reflection,
the validation primitives did duplicate — a signal, not yet a problem.

---

## Dimension 1: Task Implementation Quality

### Requirements Achievement

**Status**: ✅ All Met (code + automated tests); one manual live-DB verification pending by design

| AC | Status | Evidence |
|----|--------|----------|
| AC-ENTRY-1 (all 5 routes mounted/reachable) | ✅ | `cards.routes.test.ts` mount test; router `app.use`d in `app.ts` with both repos |
| AC-HAPPY-1 (create → 201, persisted) | ✅ | create→GET round-trip asserts equality, status defaults to `todo`, `due_date` null |
| AC-HAPPY-2 (list reflects DB state) | ✅ | list grows 0→2→3 as cards are added |
| AC-HAPPY-3 (`?board_id=` filters to one board) | ✅ | cards under board A vs B; filter returns only the matching subset |
| AC-HAPPY-4 (get by id) | ✅ | fetched body equals created body |
| AC-HAPPY-5 (partial update moves columns; created_at stable, updated_at bumped) | ✅ | monotonic stub clock; other fields unchanged, status→in_progress persisted |
| AC-HAPPY-6 (delete → 204, then 404) | ✅ | empty body + subsequent GET 404 |
| AC-HAPPY-7 (board delete cascades to cards) | ✅ | linked stubs: DELETE /boards/:id → cards 404 + `?board_id=` empty |
| AC-ERROR-1 (404 JSON on missing id, GET/PATCH/DELETE) | ✅ | three explicit 404 cases |
| AC-ERROR-2 (400 on invalid create/update, incl. status enum, board_id-not-patchable) | ✅ | missing title, bad status, PATCH board_id rejected; "changes nothing" checked |
| AC-ERROR-3 (400 when board_id references no board) | ✅ | non-existent board_id → exact error body; "creates nothing" checked |
| AC-ERROR-4 (400 malformed JSON, 500 on DB failure, no leak) | ✅ | throwingCardsRepo → 500; body free of "connection refused"/"5432" |

Scope was well-contained: no `columns` table, no `labels`, no user-assignment, no
position/ordering, no pagination beyond the `board_id` filter, no auth — all explicitly
excluded in the spec's Scope Boundaries and design decisions.

### Code Quality Assessment

**Overall Rating**: Excellent

- **Maintainability**: High. `cards/` mirrors `boards/` file-for-file (types / repository /
  validation / routes + co-located tests), so a reader who knows one knows the other. Each
  file carries a purposeful "why" docstring (e.g. the `COLUMNS` projection, `board_id`
  immutability note in `update`).
- **Architecture**: The `CardsRepository` interface / `PostgresCardsRepository` split injected
  via `AppDeps.cardsRepo` reuses the established DI precedent. The one *new* architectural
  wrinkle is deliberate and clean: `createCardsRouter(cardsRepo, boardsRepo)` takes the boards
  repo too, so the FK-existence check composes existing pieces rather than reaching into the
  boards module's internals or duplicating a `boardExists` query.
- **Error Handling**: Reuses the central Express handler unchanged (malformed JSON → 400,
  else → generic 500, `res.headersSent` guard, server-side stack log). The card-specific
  FK-existence failure is surfaced as an explicit application-level 400 *before* the insert,
  so a well-formed-but-dangling `board_id` never becomes a leaked Postgres FK-violation 500.
- **Testing**: Strong balance — 14 repository unit tests (mocked pool: parameterization,
  `RETURNING`, `updated_at` bump, optional `WHERE` filter, row mapping) + 15 validation unit
  tests (title, board_id positive-int, status enum, optional typing, board_id-not-patchable) +
  18 route integration tests (stateful stubs, persistence round-trips, cascade). Assertions are
  specific (SQL contains `$1..$5` and *not* the literal value; `WHERE board_id = $1` only when
  filtered).

### Technical Decisions

**Key Decisions:**
1. **`ON DELETE CASCADE` on `cards.board_id`** — direct quote from productBrief ("board deletion
   cascades to associated cards"). Verified by AC-HAPPY-7. The real constraint is DB-enforced;
   the test emulates it at the stub layer (see below).
2. **`status` enum via a `CHECK` constraint, no `columns` table** — simplest model that satisfies
   FEAT-004's "three fixed columns" dependency; app-layer default `'todo'` mirrors the DB default.
3. **Application-level FK-existence check** — `boardsRepo.findById(board_id)` before insert →
   400 on miss, rather than catching a Postgres FK violation. Keeps the error surface friendly
   and DB-agnostic (AC-ERROR-3).
4. **`board_id` immutable** — absent from `UpdateCardInput`; the update validator actively
   *rejects* a supplied `board_id` (400) rather than silently ignoring it.
5. **Optional filter as one repository method** — `findAll(boardId?)` adds a parameterized
   `WHERE` only when a board id is present; a malformed `?board_id=` query → 400.
6. **`board_id` index** (`cards_board_id_idx`) — the primary filter/lookup path, protecting the
   p95 < 200ms NFR.

**Trade-offs:**
- **Stub-emulated cascade vs live-DB test**: gained a fast, deterministic AC-HAPPY-7 with no DB;
  the cost is that the *real* `ON DELETE CASCADE` is only smoke-tested manually — the stub proves
  orchestration intent, not Postgres enforcement.
- **App-level FK check vs DB-constraint-only**: gained a friendly 400 and no leaked driver error;
  the cost is a second round-trip (a `findById` before `create`) and a benign TOCTOU window
  (a board deleted between check and insert would fall back to the DB FK → 500) — acceptable
  pre-auth, pre-concurrency.
- **Rejecting `board_id` on PATCH vs ignoring it**: gained an explicit, discoverable contract
  (client learns the field is immutable); the cost is strictness (a client echoing the whole
  object back on PATCH must strip `board_id`).
- **Hand-rolled validation again**: as flagged in TASK-002, the title/description primitives
  duplicate `boards.validation.ts`. Kept per simplicity-first; the duplication is now concrete.

### What Went Well

1. **New behaviour, contained** — the FK, cascade, filter, and immutability each landed with a
   single, well-tested mechanism; none leaked complexity into the boards module.
2. **Cross-repository composition** — passing `boardsRepo` into the cards router for the existence
   check reused existing capability instead of duplicating a query or coupling modules.
3. **Cascade verified without a DB** — linked stubs sharing one backing store let AC-HAPPY-7 be
   an automated assertion, not a prose "verify manually" note (the real constraint still is).
4. **Injection-safety and filter-shape asserted at test level** — repository tests prove literals
   never appear in SQL and that `WHERE` is present only when filtering.

### Challenges Encountered

1. **Testing a DB-enforced cascade with no DB** — `ON DELETE CASCADE` is Postgres behaviour, not
   app code. Resolved by building a linked boards+cards stub pair over a shared store whose
   `boardsRepo.delete` drops matching cards, so the route-level orchestration is verifiable.
2. **Distinguishing a dangling FK from a malformed body** — both are client faults but need
   distinct messages. Resolved with an explicit `boardsRepo.findById` existence check returning a
   dedicated 400 body, separate from the generic validation-failure body.
3. **`due_date` type across the wire/DB boundary** — accepted as an ISO string on input,
   surfaced as a JS `Date` on read (pg parses `DATE`). Kept lenient (any parseable date string);
   the `DATE` column remains the storage source of truth.

### Technical Debt & Future Work

- **Live-DB smoke test is manual**: real `ON DELETE CASCADE` + FK enforcement + the `board_id`
  index need `docker compose down -v && up` and curl round-trips. Same deliberate gap as
  FEAT-001/002 — should be tracked as a first-class follow-up, not just prose.
- **Validation duplication is now real**: `cards.validation.ts` re-implements title/description
  string checks from `boards.validation.ts`. A small shared validation-primitives helper is now
  justified before a third resource repeats them a third time.
- **No auth/RBAC**: cards are world-reachable; the security NFR is unsatisfied and deferred,
  same known gap as boards.
- **Init-script-only schema**: `002_cards.sql` inherits the empty-volume limitation. With two
  tables now, a real migration path is closer to warranted.

---

## Dimension 2: Claude Code Ecosystem Effectiveness

### Build Session Analysis

**Session logs**: Not task-indexed — `.agent-logs/claude/by-task/TASK-003/` does not exist.
Build-session tool-utilization and sub-agent metrics are therefore **unavailable**; figures
below are reconstructed from the task file's Execution State. _Run `/banyan-init` to upgrade
session logging to the task-indexed layout._ (Third task in a row with this gap.)

**Build Sessions**: 2 (`/banyan-build` Phase 1, `/banyan-build` Phase 2)
**Sub-Agents Spawned**: The orchestrator built both phases **directly** (inline), rather than
delegating to Test Writer / Coding / Reviewer sub-agents — a judgment call given full
boards-module context was already loaded and the phases were tightly scoped. Human review gate
preserved between phases.
**Tool Calls**: Not available (no session logs)
**Errors Recovered**: 0 build/test failures across both phases (green on first run each phase)

#### Tool Utilization

| Tool | Count | Success Rate | Notes |
|------|-------|--------------|-------|
| Read/Edit/Write/Bash/Grep/Glob | N/A | N/A | Not measurable — no task-scoped session logs (see above) |

#### Sub-Agent Performance

| Agent Type | Invocations | Model | Effectiveness |
|------------|-------------|-------|---------------|
| (none delegated) | 0 | — | Orchestrator implemented inline; TDD → verify → self-review → commit gates still followed per phase |

Note: this diverges from the command's nominal sub-agent flow. It was efficient here (zero
fix cycles, both phases green first-run), but it means the "independent code-reviewer" gate was
a self-review rather than a separate `typescript-reviewer` pass as in TASK-002.

### Command Workflow Evaluation

**Commands Used**: `/banyan-build` ×2 (Phase 1, Phase 2), then `/banyan-reflect` (this run).
Planning + roadmap linking (FEAT-003) preceded the build; `/banyan-creative` was deliberately
skipped (design questions resolved inline during planning, recorded under Design Decisions).

**Workflow Efficiency**: Excellent

**Assessment**:
- The `plan → build×2 → reflect` flow matched the work exactly; the data-layer / HTTP-layer split
  gave a clean review gate.
- **Skipping `/banyan-creative` was again correct** — the four flagged questions (status model,
  FK semantics, field scope, route shape) each had a concrete recommendation backed by direct
  productBrief/roadmap quotes, not open UX exploration. Same well-recorded judgment as TASK-002.
- **New wrinkle worth noting**: the git setup started on `main` (Worktree N/A), so the feature
  branch was created inline at build start rather than pre-existing from `/banyan-init`. Handled
  cleanly, but it means the "worktree created by init" assumption in the build command didn't
  hold for this task.

### Context File Effectiveness

**Files Loaded**: `tasks/TASK-003.md` (spec, AC, design decisions, roadmap, execution state),
`progress.md`, the entire `boards/` module (as the mirror template), `app.ts`/`server.ts`, the
`_learned/` topic files, and `reflection-TASK-002.md` for style/precedent.

**Assessment**:
- **Helpful**: The task file was again the single best artifact — concrete AC + inline Design
  Decisions made the build near-mechanical. The `boards/` module functioned as an executable
  spec for the `cards/` module.
- **Gaps**: Plugin context/agent files still live at a different install path
  (`C:/ShapeShifter_code/Banyan_test/BMB1.8.4/...`) than the workspace; level-specific rule files
  outside the workspace remain effectively unavailable to in-workspace tooling.
- **Redundancy**: None material.

### Memory Bank Organization

**Assessment**:
- **Structure**: Intuitive; per-task file + registry + progress log + topic-scoped learned rules
  scaled cleanly to a third task.
- **Navigation**: The six `_learned/` files (of a 10 cap) are correctly topic-scoped, which let
  this reflection consolidate into `data-access`, `api-design`, and `testing-patterns` rather
  than sprawl.
- **Completeness**: Adequate. The recurring missing document *type* is still a first-class
  "deferred runtime verification" tracker (now three tasks deep: docker up, live-DB smoke,
  live cascade/FK).

### Suggested Improvements to Claude Code System

**Note**: Suggestions only — NOT implemented.

**High Priority**:
1. **Task-indexed session logging is still absent** — third consecutive task where tool /
   sub-agent / error-recovery metrics cannot be reported. This remains the single biggest blind
   spot in the ecosystem dimension.

**Medium Priority**:
2. **First-class "deferred runtime verification" status** — docker up (T-001), live-DB smoke
   (T-002), and live cascade/FK (T-003) are all tracked only in prose. A structured field would
   stop them aging out silently.
3. **Build command assumes a pre-existing worktree** — for a task with `Worktree: N/A`, the
   feature branch had to be created at build start. The command's Step 0.5 could detect "no
   worktree, not on feature branch" and create the branch as a defined path rather than an
   improvisation.
4. **Co-locate/mirror plugin context files into the workspace** — unchanged from TASK-002.

**Low Priority / Nice to Have**:
5. **Shared validation-primitives helper** — the hand-rolled title/description checks have now
   duplicated across boards and cards; a small shared helper would pay off at the third resource.

---

## Key Learnings

### Extractable Learnings (for Continuous Learning)

**Format**: `- **[category]** ([scope hint]): [directive]`

1. **api-design** (`src/**/*routes*.ts`): Validate a foreign-key reference against the parent's repository (`parentRepo.findById`) and return a dedicated `400` *before* insert, so a well-formed-but-dangling FK never surfaces as a leaked DB constraint-violation `500`. _(amends `api-design.md`, evidence_count → 2)_
2. **testing-patterns** (`**/*.test.ts`, `src/**/*.ts`): To verify DB-enforced cascade/relationship behaviour without a live DB, back route tests with *linked* in-memory stubs that share one backing store, so a parent delete cascades to children at the orchestration layer. _(amends `testing-patterns.md`, evidence_count → 3 → promote to `medium`)_
3. **data-access** (`src/**/*repository*.ts`): Expose an optional filter as a single method (`findAll(filter?)`) that adds a parameterized `WHERE` only when the filter is present, and index the filtered/FK column. _(amends `data-access.md`, evidence_count → 2)_

**Limits**: Level 3 → 2-4 learnings. Three extracted, all consolidating into existing topic
files (no new files; count stays at 6 of 10 cap). `testing-patterns` reaches evidence_count 3,
crossing the promotion threshold → priority raised to `medium`.

### Learned Rules Applied

- **testing-patterns.md** (`Inject external I/O as dependencies…`, `stateful in-memory stub…round-trips`): **Directly applied and extended.** Cards route tests used stateful stubs with persistence round-trips; extended to *linked* stubs for the cascade — reinforced a third time.
- **data-access.md** (`Always parameterize queries…`): **Directly applied.** `PostgresCardsRepository` parameterizes every statement incl. the optional-filter `WHERE`; tests assert literals are absent.
- **api-design.md** (`unparseable :id → 404`): **Directly applied.** `parseId` (shared shape with `parseBoardId`) returns 404 for bad ids across GET/PATCH/DELETE; now extended with the FK-existence 400 rule.
- **error-handling.md** (`central handler, headersSent guard, no leak`): **Reused unchanged.** Cards routes defer to the same central handler; the throwingCardsRepo 500 test confirms no leak.
- **configuration.md / infrastructure.md**: **Loaded, analogous.** `002_cards.sql` mounted via compose like `001_`; live-DB verification deferred to a human, same reasoning.

The feedback loop is clearly working: four of six learned rules were actively re-used here.

### For Claude Code Workflow

1. **Mirror-module-as-spec is a high-leverage pattern** — building `cards/` by mirroring the
   reviewed `boards/` module gave a near-mechanical, low-defect phase. Worth recognizing
   explicitly when a task is "the Nth resource of the same shape".
2. **Record new-vs-mirrored behaviour** — this task's value was in the *new* bits (FK, cascade,
   filter, immutability); calling them out separately from the mirrored bits kept review focused.
3. **Session logging still off** — third task unable to report build metrics; enabling
   task-indexed logging would close the ecosystem-dimension blind spot.

---

## Conclusion

TASK-003 is a high-quality, precedent-faithful Level 3 execution: it added BanyanBoard's second
domain resource by mirroring the reviewed boards module and layering in exactly the new machinery
the `board_id` relationship requires — an `ON DELETE CASCADE` FK, an application-level FK-existence
check, an optional `?board_id=` filter, and enforced `board_id` immutability. All twelve
acceptance criteria are met in code and automated tests, including a cascade behaviour cleverly
verified at the orchestration layer via linked stubs. The open items — a manual live-DB smoke
test (real cascade/FK) and the deferred auth/RBAC gap — are deliberate, documented, and consistent
with the project's posture. The workflow ran smoothly and the `/banyan-creative` skip was again
correct and well-recorded. Two ecosystem caveats: build metrics were unavailable (no task-indexed
logs, third time), and the phases were built inline rather than via the nominal code-reviewer
sub-agent — efficient here, but the independent-review gate was a self-review. The
continuous-learning loop demonstrably worked: four prior learned rules were re-applied and are
now reinforced, with `testing-patterns` earning promotion to `medium`.

**Overall Task Success**: ✅ Success

**Overall Workflow Effectiveness**: ✅ Highly Effective (caveats: session-log metrics unavailable; inline build vs sub-agent review)

**Recommendation**: Ready to archive (`/banyan-archive TASK-003`). Carry forward three tracked
follow-ups: (1) human live-DB smoke test — real `ON DELETE CASCADE` / FK enforcement / index via
`docker compose down -v && up` + curl; (2) extract a shared validation-primitives helper before a
third CRUD resource; (3) auth/RBAC as a future feature.
