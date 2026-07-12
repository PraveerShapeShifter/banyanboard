# Task Archive: TASK-003 — Card CRUD API

**Status**: ✅ COMPLETE / ARCHIVED
**Date Archived**: 2026-07-13
**Complexity**: Level 3 (inherited from FEAT-003)
**Roadmap**: FEAT-003 (Card CRUD API)
**Branch**: feature/FEAT-003-card-crud → merged into `main` (local-merge)
**Reflection**: `memory-bank/reflection/reflection-TASK-003.md`

---

## 1. Summary

Delivered BanyanBoard's second domain resource: a full Card CRUD REST surface
(`POST`/`GET`/`GET :id`/`PATCH`/`DELETE` `/cards`) backed by a new `cards` table with a
`board_id` foreign key to `boards` (`ON DELETE CASCADE`), an optional `?board_id=` list
filter, a `pg`-pool repository, hand-rolled validation, and reuse of the existing central
error handler. Built in two human-gated phases (data layer → HTTP layer). Landed **95/95
tests** (33 new), a clean `tsc --strict` build, and **no new dependencies**.

The task mirrored the reviewed `src/boards/` module file-for-file and layered in exactly the
new machinery the FK relationship required: cascade delete, an application-level FK-existence
check (dangling `board_id` → `400`, not a leaked Postgres FK-violation `500`), the list
filter, and enforced `board_id` immutability on `PATCH`.

---

## 2. Requirements & Acceptance Criteria

All 12 acceptance criteria met in code and automated tests:

| Group | Result |
|-------|--------|
| AC-ENTRY-1 (5 routes mounted/reachable) | ✅ |
| AC-HAPPY-1..6 (create/list/filter/get/update/delete round-trips) | ✅ |
| AC-HAPPY-7 (board delete cascades to cards) | ✅ (verified at orchestration layer via linked stubs; real `ON DELETE CASCADE` is DB-enforced, manual smoke test pending) |
| AC-ERROR-1 (404 on missing id, GET/PATCH/DELETE) | ✅ |
| AC-ERROR-2 (400 invalid payload incl. status enum, board_id-not-patchable) | ✅ |
| AC-ERROR-3 (400 when board_id references no board) | ✅ |
| AC-ERROR-4 (400 malformed JSON, 500 on DB failure, no leak) | ✅ |

---

## 3. Implementation (by phase)

### Phase 1 — Data layer (commit `3db6151`)
- `db/init/002_cards.sql`: `cards` table — INTEGER identity PK, `board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE`, `title VARCHAR(200)`, `description TEXT`, `status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done'))`, `due_date DATE`, timestamps, `cards_board_id_idx`. Numbered `002_` so it runs after `001_boards.sql`.
- `src/cards/cards.types.ts`: `Card`, `CreateCardInput`, `UpdateCardInput`, `CardStatus` (`board_id` absent from update = immutable).
- `src/cards/cards.repository.ts`: `CardsRepository` interface + `PostgresCardsRepository` (parameterized queries, `RETURNING`, `findAll(boardId?)` optional WHERE, app-layer `'todo'` default, partial update bumping `updated_at`, hard delete).
- `src/cards/cards.repository.test.ts`: 14 unit tests (mocked pool).

### Phase 2 — HTTP + validation layer (commit `acde232`)
- `src/cards/cards.validation.ts`: hand-rolled create/update validators (title required/non-blank/≤200, board_id positive integer, status enum, description/due_date optional+typed, board_id rejected on update).
- `src/cards/cards.routes.ts`: `createCardsRouter(cardsRepo, boardsRepo)` — 5 endpoints + `?board_id=` filter + application-level FK-existence check (AC-ERROR-3) + fail-safe `next(err)`; mutations logged via `log()`.
- Wiring: `AppDeps.cardsRepo` + router mount in `src/app.ts`; `PostgresCardsRepository` in `src/server.ts`; stub `cardsRepo` injected into `app.test.ts` + `health.test.ts`.
- `README.md`: Cards API table + `002_cards.sql` first-run schema note.
- Tests: 15 validation unit tests + 18 Supertest route tests (linked in-memory board+card stubs share one store so cascade AC-HAPPY-7 is verified at the orchestration layer).

### Reflection (commit `dd1c701`)
- `reflection-TASK-003.md` (Task Quality High, Ecosystem Good); 3 learnings extracted.

---

## 4. Key Design Decisions

1. `ON DELETE CASCADE` on `cards.board_id` (direct productBrief quote).
2. `status` enum via `CHECK`, no `columns` table (satisfies FEAT-004's fixed-columns dependency).
3. Application-level FK-existence check via `boardsRepo.findById` → 400 before insert.
4. `board_id` immutable — actively rejected on `PATCH`.
5. Optional filter as a single `findAll(boardId?)` with a parameterized `WHERE`; `board_id` indexed for the p95 < 200ms NFR.
6. Route shape flat (`/cards`), consistent with Board CRUD; no cross-router coupling except the injected `boardsRepo`.

No `/banyan-creative` phase — all four flagged questions resolved inline during planning with productBrief/roadmap evidence (same treatment as TASK-002).

---

## 5. Testing

- **95/95 tests pass** (33 new this task: 14 repository + 15 validation + 18 route; 62 pre-existing, no regression). `tsc --strict` clean. Lint N/A (no lint script).
- No live DB in the automated suite (parity with FEAT-001/002). Repository tests use a mocked `pg` pool; route tests use stateful in-memory stubs with persistence round-trips.

---

## 6. Lessons Learned (see reflection for full detail)

- **Mirror-module-as-spec**: building `cards/` by mirroring the reviewed `boards/` module gave a near-mechanical, zero-fix-cycle build; the value was in the *new* bits (FK, cascade, filter, immutability).
- **Cascade verified without a DB**: linked stubs sharing one backing store made a DB-enforced behaviour an automated assertion.
- **App-level FK check** keeps the error surface friendly and DB-agnostic (400, not a leaked 500).

**Extracted learnings** (all consolidated into existing rules): `api-design` (FK check → 400 before insert), `data-access` (optional-filter method + indexed FK), `testing-patterns` (linked shared-store stubs for cascade; promoted low → medium).

---

## 7. Open Follow-ups (carried forward)

1. **Live-DB smoke test** — verify real `ON DELETE CASCADE` / FK enforcement / `board_id` index via `docker compose down -v && up` + curl round-trips (deliberate manual step; no live DB in the suite).
2. **Shared validation-primitives helper** — title/description checks have now duplicated across boards and cards; extract before a third CRUD resource.
3. **Auth/RBAC** — cards are world-reachable; security NFR unsatisfied, deferred to a future auth feature (same known gap as boards).
4. **Init-script-only schema** — with two tables now, a real migration path is closer to warranted.

---

## 8. References

- Task file: `memory-bank/tasks/TASK-003.md`
- Reflection: `memory-bank/reflection/reflection-TASK-003.md`
- Progress log: `memory-bank/progress.md` (2026-07-12 / 2026-07-13 entries)
- Roadmap: `memory-bank/roadmap.md` (FEAT-003)
- Commits: `3db6151` (Phase 1), `acde232` (Phase 2), `dd1c701` (reflection)
