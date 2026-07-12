# TASK-003: Card CRUD API

**Complexity**: Level 3 (inherited from FEAT-003)
**Status**: PLANNING_COMPLETE
**Roadmap**: FEAT-003
**Branch**: feature/FEAT-003-card-crud
**Worktree**: N/A

## Task Description

Add the Card domain model with full CRUD REST endpoints, a foreign key to Board (`board_id` → `boards.id`), and input validation. Includes the cards table/schema with the FK constraint and delete behavior (cascade/restrict — to be decided in creative), repository layer, validation, and comprehensive tests.

**Dependencies**: FEAT-002 (Board CRUD API — `cards.board_id` references `boards.id`); FEAT-001 (foundation — `pg` pool, `createApp(deps)` factory/DI, env/logger). Board CRUD code is already present in the codebase (`src/boards/`, `db/init/001_boards.sql`), so the dependency is satisfied in practice.

## Specification

**Feature Type**: End-User Feature
*Note: this is a REST API surface with no direct UI in this task, mirroring TASK-002/FEAT-002. It is consumed by the not-yet-built React frontend (FEAT-004) and is directly exercisable via HTTP clients (curl, Supertest) for verification.*
**Primary Persona**: Marco (Team Member / Contributor) — creates cards, updates their detail, and moves them across columns as work evolves (`memory-bank/productBrief.md` Key Personas, Key Workflows: "Add a card... Move a card between columns... Edit or delete a card"). Priya consumes card state to see status at a glance; Sam observes via `GET`. Devon is not a direct API consumer.
**Creative Exploration Needed**: Yes — three concrete, scoped questions (not full UX exploration; the route/response contract below is otherwise concrete). See "Creative Exploration Needed" below.

### Invocation Method
- **Location**: New `src/cards/` module, mirroring the existing `src/boards/` module structure exactly (`boards.types.ts`, `boards.repository.ts`, `boards.validation.ts`, `boards.routes.ts` → `cards.types.ts`, `cards.repository.ts`, `cards.validation.ts`, `cards.routes.ts`). Routes are mounted in `createApp()` (`src/app.ts`) alongside the boards router.
- **Element**: Five REST endpoints on a flat `cards` resource (mirroring the boards resource's flat top-level shape rather than nesting under `/boards/:boardId/cards` — see Creative Exploration Needed #4 below for the confidence note on this choice):

  | Method | Path | Purpose |
  |---|---|---|
  | `POST` | `/cards` | Create a card (body includes `board_id`) |
  | `GET` | `/cards` | List cards — all, or filtered to one board via `?board_id=` |
  | `GET` | `/cards/:id` | Fetch one card |
  | `PATCH` | `/cards/:id` | Partially update a card (title/description/status/due_date — NOT `board_id`, see Scope Boundaries) |
  | `DELETE` | `/cards/:id` | Delete a card |
- **Visibility**: Always reachable — no auth/RBAC gate exists anywhere in the codebase yet, same as Board CRUD (confirmed via `src/app.ts`). Enforcing auth is out of scope for this task.
- **Navigation**: API-only — a client reaches the feature via `http://<host>:<PORT>/cards[...]`, `PORT` from `src/config/env.ts`. FEAT-004's board view will call `GET /cards?board_id=<id>` to populate its three columns. No UI navigation steps exist yet.
- **Confidence**: HIGH on module layout, DI pattern, and the four of five route contracts that directly mirror Board CRUD (`POST`, `GET` single, `PATCH`, `DELETE`). MEDIUM on the `GET /cards?board_id=` filter param specifically — Board CRUD's `GET /boards` has no query filtering (its Scope Boundaries explicitly exclude "pagination/filtering/sorting... beyond returning the full list"), so this is a genuine new addition for Cards, justified because FEAT-004 explicitly needs "the selected board's cards" and a card FK inherently scopes to one board. Recommend confirming inline during planning rather than a full creative pass — the shape of the filter (`?board_id=`) is a minor, low-risk technical choice with no valid alternative that changes user-facing behavior.

### Success Criteria
- **User sees**: Exact JSON response bodies and status codes:
  - `POST /cards` → `201` with the created card (`id`, `board_id`, `title`, `description`, `status`, `due_date`, `created_at`, `updated_at`)
  - `GET /cards` → `200` with a JSON array of all cards, or (with `?board_id=N`) only cards belonging to board `N`
  - `GET /cards/:id` → `200` with the card, or `404` if no card has that id
  - `PATCH /cards/:id` → `200` with the updated card, or `404`/`400` (see Acceptance Criteria)
  - `DELETE /cards/:id` → `204` with an empty body, or `404`
- **Verifiable at**: The same endpoint via round-trip (e.g. `POST` then `GET /cards/:id` returns the same data); directly in the `cards` table via `psql`/a test DB client; `GET /cards?board_id=N` after creating cards under different boards returns only the matching subset.
- **Data persisted**: `cards` table (new — second domain table, FK to `boards`). Proposed columns:

  | Column | Type | Notes |
  |---|---|---|
  | `id` | `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | mirrors `boards.id` |
  | `board_id` | `INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE` | see Creative Exploration Needed #2 — CASCADE recommended |
  | `title` | `VARCHAR(200) NOT NULL` | required, non-blank (validated); 200 chosen by analogy to `boards.name VARCHAR(120)`, scaled up for a card-title use case — a minor implementation detail, not a blocking design question |
  | `description` | `TEXT NULL` | optional |
  | `status` | `VARCHAR(20) NOT NULL DEFAULT 'todo'` with a `CHECK` constraint restricting to `'todo' \| 'in_progress' \| 'done'` | see Creative Exploration Needed #1 — drives FEAT-004's column grouping |
  | `due_date` | `DATE NULL` | optional; see Creative Exploration Needed #3 |
  | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | set once on insert |
  | `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | bumped on every successful `PATCH` |

  Excluded from this table (see Scope Boundaries): `labels` (a many-to-many entity, future feature) and any user-assignment column (productBrief open question, deferred).

  Delete semantics: **hard delete** (row physically removed) for direct `DELETE /cards/:id` calls, consistent with Board CRUD's precedent. Cards are also removed as a side effect of their parent board's deletion via the FK's `ON DELETE CASCADE` (see Creative Exploration Needed #2).
- **Observable within**: Immediate — all Card CRUD operations are synchronous request/response; there is no async job or background processing in this feature.

### Acceptance Criteria

#### AC-ENTRY-1: Client can reach all five Card CRUD routes
**Priority**: MUST
**Given** the Express app is constructed via `createApp()` with a cards repository dependency injected (mirroring `AppDeps.boardsRepo`)
**When** a client sends `GET /cards`, `POST /cards`, `GET /cards/:id`, `PATCH /cards/:id`, and `DELETE /cards/:id`
**Then** each route is handled by the Card CRUD router (not Express's generic unmatched-route 404) — each responds with the resource-specific status/body defined in this spec, proving the router is mounted and reachable

#### AC-HAPPY-1: Client creates a card
**Priority**: MUST
**Given** a board with a known `id` exists
**When** a client sends `POST /cards` with body `{ "board_id": <id>, "title": "Write spec", "description": "Draft the card CRUD spec" }`
**Then** the response is `201 Created` with a JSON body containing a generated `id`, the submitted `board_id`/`title`/`description`, a default `status` of `"todo"`, a `null` `due_date`, and generated `created_at`/`updated_at`; a matching row exists in the `cards` table (verified by a subsequent `GET /cards/:id`, not just the echoed response)

#### AC-HAPPY-2: Client lists all cards
**Priority**: MUST
**Given** N cards exist across one or more boards
**When** a client sends `GET /cards`
**Then** the response is `200 OK` with a JSON array of exactly N card objects reflecting current DB state — not a hardcoded/stubbed list; creating an (N+1)th card and re-fetching returns N+1 items

#### AC-HAPPY-3: Client lists only the cards belonging to one board
**Priority**: MUST
**Given** cards exist under at least two different boards
**When** a client sends `GET /cards?board_id=<id>` for one of those boards
**Then** the response is `200 OK` with a JSON array containing only the cards whose `board_id` matches `<id>` — cards belonging to the other board are excluded

#### AC-HAPPY-4: Client fetches a single card by id
**Priority**: MUST
**Given** a card with a known `id` exists
**When** a client sends `GET /cards/:id` using that id
**Then** the response is `200 OK` with the JSON card object whose fields match what was persisted

#### AC-HAPPY-5: Client updates a card, including moving it between columns
**Priority**: MUST
**Given** an existing card with `status: "todo"`
**When** a client sends `PATCH /cards/:id` with body `{ "status": "in_progress" }` (partial update — other fields omitted)
**Then** the response is `200 OK` with the updated `status`, unchanged `title`/`description`/`due_date`/`board_id`, an unchanged `created_at`, and an `updated_at` newer than before; a subsequent `GET /cards/:id` reflects the new status (change is persisted, not just echoed)

#### AC-HAPPY-6: Client deletes a card
**Priority**: MUST
**Given** an existing card
**When** a client sends `DELETE /cards/:id`
**Then** the response is `204 No Content`; a subsequent `GET /cards/:id` for the same id returns `404 Not Found`; the row no longer exists in the `cards` table

#### AC-HAPPY-7: Deleting a board removes its cards (cascade)
**Priority**: MUST
**Given** a board with one or more cards attached
**When** the board is deleted (`DELETE /boards/:id`, from TASK-002)
**Then** the FK's `ON DELETE CASCADE` removes all cards whose `board_id` matched the deleted board — a subsequent `GET /cards/:id` for any of those card ids returns `404`, and `GET /cards?board_id=<deletedId>` returns an empty array; no orphaned card rows remain

#### AC-ERROR-1: Client gets 404 for a card that does not exist
**Priority**: MUST
**Given** no card exists with a given id (e.g. `999999`)
**When** a client sends `GET /cards/999999`, `PATCH /cards/999999`, or `DELETE /cards/999999`
**Then** each responds `404 Not Found` with a JSON error body (e.g. `{ "error": "Card not found" }`); no row is created or modified as a side effect

#### AC-ERROR-2: Client gets 400 for invalid create/update payloads
**Priority**: MUST
**Given** a client is creating or updating a card
**When** they send `POST /cards` with a missing or blank `title` (or a `title` exceeding 200 characters), a missing `board_id`, or a `status` value outside `'todo' | 'in_progress' | 'done'`, or `PATCH /cards/:id` with an invalid field type (e.g. `title: 123`)
**Then** the response is `400 Bad Request` with a JSON error body describing the validation failure; no row is created or modified in the `cards` table

#### AC-ERROR-3: Client gets 400 when `board_id` does not reference an existing board
**Priority**: MUST
**Given** a client sends `POST /cards` with a `board_id` that is well-formed but does not match any row in `boards`
**When** the request is processed
**Then** the response is `400 Bad Request` with a JSON error body (e.g. `{ "error": "board_id does not reference an existing board" }`) — surfaced as an application-level validation check (not a raw FK-violation/Postgres error leaking through), and no card row is created

#### AC-ERROR-4: Client gets a safe, non-crashing error for malformed requests or DB failures
**Priority**: MUST
**Given** a client sends `POST /cards`/`PATCH /cards/:id` with a malformed JSON body, OR the database is unreachable during any Card CRUD operation
**When** the request is processed
**Then** the API responds with a `400` (malformed JSON) or `500` (DB failure) JSON error body — mirroring the fail-safe pattern established in `src/app.ts`'s central error handler and `src/boards/boards.routes.ts` (catch, defer to `next(err)`, never leak internals, never crash the process)

*AC-ASYNC: not applicable. All Card CRUD operations are synchronous request/response; there is no async lifecycle or blocked state to observe in this feature.*

### Scope Boundaries
- **In scope**: The Card domain model; the `cards` table/schema with the `board_id` FK constraint; a repository/data-access layer over the existing `pg` pool; the five REST endpoints; request-body validation (including `board_id` existence checking); 404 and error handling; comprehensive tests (unit + Supertest-driven integration, following `boards.repository.test.ts`/`boards.routes.test.ts`/`boards.validation.test.ts`'s style).
- **Out of scope**: A separate `columns` entity/table (columns are represented purely as the `status` enum on `card` — see Creative Exploration Needed #1); `labels` (a many-to-many entity — future feature); card assignment to specific users (productBrief open question, explicitly deferred); moving a card to a *different* board (`board_id` is immutable after creation — not exposed on `PATCH`); manual ordering/position of cards within a column (FEAT-004 is read-oriented in its first iteration; no `position`/`sort_order` column at MVP); pagination/sorting on `GET /cards` beyond the `board_id` filter; authentication/authorization/RBAC enforcement (same gap as Board CRUD); rate limiting; real-time updates.
- **Dependencies**: FEAT-002 (Board CRUD API) — `cards.board_id` FK references `boards.id`; the `boards` table must exist (it does, via `db/init/001_boards.sql`). FEAT-001 (Project Foundation) — the `pg` pool, `createApp(deps)` factory/DI pattern, env/logger conventions. This feature is a hard prerequisite for FEAT-004 (React Frontend), whose board view needs `GET /cards?board_id=` and the `status` field for column grouping.
- **NFR implications** (from `memory-bank/productBrief.md`): API latency should stay within p95 < 200ms / p99 < 500ms (simple CRUD over an indexed FK lookup should comfortably meet this — recommend an index on `cards.board_id` given it's the primary filter/lookup path); structured JSON logging should log card mutations (create/update/delete) via the existing `log()` helper, same convention as boards; the `status` field is the mechanism FEAT-004 will use to satisfy the accessibility NFR "keyboard-accessible card movement... non-drag alternative" — a `PATCH { status }` call is inherently keyboard/non-drag-operable, which is a point in favor of the status-enum recommendation in Creative Exploration Needed #1; `due_date` as a plain `DATE` keeps the door open for the i18n NFR's "date/time formatting for due dates" to be a pure frontend display concern; no accessibility NFR applies directly to this API-only task; the security NFR (RBAC scoped to boards) is not satisfied by this task, same known gap as Board CRUD.

### Creative Exploration Needed
Yes — three concrete, scoped questions plus one minor technical note, all narrower than a full `/banyan-creative` UX pass (there is no UI in this task and the core CRUD contract above is otherwise concrete):

1. **Card `status`/column model** (MEDIUM-HIGH confidence): No `columns` table exists, and productBrief's Open Questions lists "Are columns fixed (To Do/In Progress/Done) or fully customizable per board at MVP?" as unresolved. However, `memory-bank/roadmap.md`'s FEAT-004 description already commits to an answer in practice — it states the board view renders cards "grouped into three fixed columns — To Do / In Progress / Done... based on card status" and lists FEAT-003 as owing "a status field for column grouping" as an explicit dependency. **Recommendation**: add a `status` column (`VARCHAR(20)` with a `CHECK` constraint, values `'todo' | 'in_progress' | 'done'`, `DEFAULT 'todo' NOT NULL`) — no separate `columns` table. This is the simplest option consistent with the "simplicity-first" guiding principle and directly satisfies FEAT-004's stated dependency. Recommend closing out productBrief's open question to "fixed columns at MVP" as a byproduct of this decision, since a customizable-columns model would require a `columns` table this task does not build.
2. **FK delete semantics** (HIGH confidence): `cards.board_id REFERENCES boards(id)` — `ON DELETE CASCADE` vs `RESTRICT`. productBrief's Data & Privacy section states directly: "Right to Deletion: Account and board deletion cascades to associated cards." **Recommendation**: `ON DELETE CASCADE`. This mirrors the same evidence quality that resolved Board CRUD's analogous schema questions inline during planning (TASK-002 Design Decisions) — it is a direct quote, not an inference.
3. **MVP card field scope** (MEDIUM confidence): productBrief's Key Functionality/Key Workflows mention title, description, due date, and labels; Card assignment is an explicit open question. **Recommendation**: scope the Card MVP to `title` (required), `description` (optional), `status` (per #1), `board_id`, `due_date` (optional, plain `DATE`, no reminders/notifications logic), and timestamps. **Exclude** `labels` — modeling a label as a many-to-many join table (`card_labels`) is a distinct data-modeling effort better suited to its own feature/task rather than folding into Card CRUD's initial schema. **Exclude** user assignment entirely, per the still-open productBrief question.
4. **Route shape — flat `/cards?board_id=` vs. nested `/boards/:boardId/cards`** (MEDIUM confidence, minor): Flagged in Invocation Method above. Recommendation is the flat form to keep the `cards` module independent of the `boards` module (no cross-router coupling) and consistent with Board CRUD's flat precedent, with `board_id` carried as a required create-time field and an optional list-time query filter.

All four points above have a stated recommendation and supporting evidence from `productBrief.md`/`roadmap.md`; none require multi-option UX exploration. Consistent with TASK-002's precedent (where two similarly-scoped schema questions were resolved inline during `/banyan-plan` without a separate `/banyan-creative` phase), these are suitable for inline resolution during planning rather than a full creative pass — recommend the same treatment here.

---

**Spec Writer Notes to Orchestrator**: Confidence is HIGH on invocation method's module layout and DI pattern (directly mirrors `src/boards/`), HIGH on four of the five route contracts (`POST`, `GET :id`, `PATCH`, `DELETE` — status codes/bodies are fully concrete), and MEDIUM on the `GET /cards?board_id=` filter shape (new relative to Board CRUD, but low-risk and necessary for FEAT-004). Acceptance Criteria are fully concrete: 1 AC-ENTRY, 7 AC-HAPPY (including the cascade-delete behavior in AC-HAPPY-7, which is genuinely new relative to Board CRUD and should not be skipped in testing), 4 AC-ERROR (including a card-specific FK-existence check in AC-ERROR-3 that Board CRUD had no analog for), AC-ASYNC explicitly not applicable. The three flagged design questions (status/column model, FK cascade semantics, MVP field scope) all carry a concrete recommendation backed by direct quotes from `productBrief.md` and `roadmap.md` — none are open-ended UX decisions. Recommend resolving all three (plus the minor route-shape note) inline during `/banyan-plan`'s implementation design step, the same way TASK-002 handled its two schema questions — a full `/banyan-creative` phase is not warranted for this task.

## Design Decisions (resolved inline during planning, 2026-07-12 — human-approved)

The Spec Writer flagged four scoped design questions; all were resolved inline (human-approved), so **no `/banyan-creative` phase is required** (same treatment as TASK-002):

1. **Card `status`/column model** → **`status` enum column, no separate `columns` table.** `status VARCHAR(20) NOT NULL DEFAULT 'todo'` with a `CHECK (status IN ('todo','in_progress','done'))` constraint. Rationale: simplicity-first; directly satisfies FEAT-004's stated dependency ("cards grouped into three fixed columns based on card status"). **Byproduct**: productBrief's open question "columns fixed vs customizable at MVP" is resolved to **fixed** — a customizable-columns model would need a `columns` table this task does not build.
2. **FK delete semantics** → **`board_id ... REFERENCES boards(id) ON DELETE CASCADE`.** Rationale: direct quote from productBrief Data & Privacy ("board deletion cascades to associated cards"). Verified by AC-HAPPY-7.
3. **MVP card field scope** → `title` (required, ≤200, non-blank), `description` (optional TEXT), `status` (per #1), `board_id` (required FK, immutable after create), `due_date` (optional plain `DATE`, no reminder logic), `created_at`/`updated_at`. **Excluded**: `labels` (future many-to-many `card_labels` feature), user assignment (productBrief open question), card position/ordering.
4. **Route shape** → **flat `/cards` with `board_id` as a create-time body field and an optional `?board_id=` list filter.** Rationale: keeps the `cards` module independent of `boards` (no cross-router coupling); consistent with Board CRUD's flat precedent.

Additional implementation note: add an index on `cards.board_id` (primary filter/lookup path) to protect the p95 < 200ms NFR.

## User Journey Definition

> Superseded by the `## Specification` section above, which holds the authoritative
> Invocation Method, Success Criteria, and Acceptance Criteria (AC-ENTRY / AC-HAPPY /
> AC-ERROR) for this REST API feature. This placeholder is retained only for template
> structure — do not fill it separately.

## Test Strategy

### Approach
- **Emphasis**: Integration-leaning (Supertest through the real Express app via `createApp(deps)` with **stubbed dependencies — no live DB**) + focused unit tests on the repository's SQL/param/row-mapping and on the validators. Matches the boards module convention exactly (`src/boards/*.test.ts`).
- **Target test count**: ~20 (justified: 5 CRUD verbs, `?board_id=` filter, cascade-delete behavior, board_id existence check, 3 shared error paths, plus repository mapping/param tests and status/board_id validation unit tests — Cards has more ACs than Boards: 1 entry, 7 happy, 4 error).

### File Organization
- **New test files** (co-located, mirroring `src/boards/`):
  - `src/cards/cards.repository.test.ts` — unit tests with a mocked `pg` client (`pool.query` mock): parameterized SQL (no interpolation), `RETURNING` on insert/update, `updated_at` bump, row→`Card` mapping, `findAll` with and without the `board_id` filter, `findById` null-on-missing, delete reports affected rows.
  - `src/cards/cards.validation.test.ts` — unit tests for create/update validators: `title` required/non-blank/≤200, `board_id` required + integer, `status` restricted to the enum, `description`/`due_date` optional and type-checked, `board_id` rejected on update (immutable).
  - `src/cards/cards.routes.test.ts` — Supertest against `createApp({ ...deps, cardsRepo: <stateful in-memory stub>, boardsRepo })`; covers AC-ENTRY-1, AC-HAPPY-1..7, AC-ERROR-1..4. The stateful stub makes create→get, patch→get, delete→get(404), and `?board_id=` filter assertions verify real semantics, not echoed responses.
- **Extend existing**: `src/app.test.ts` and `src/health/health.test.ts` — inject the new stub `cardsRepo` into their `createApp` calls so they keep compiling/passing (same as when `boardsRepo` was added in TASK-002). The "returns 404 for unknown routes" test must stay valid.

### What NOT to Test
- The `pg` driver networking / real DB round-trips — no live DB in the suite (parity with boards). Real cascade/FK behavior is smoke-tested manually via `docker compose up` + curl and documented in AC verification. (The cascade AC-HAPPY-7 is unit-verified at the route/stub layer for orchestration and confirmed against the real DB manually, since the actual `ON DELETE CASCADE` is enforced by Postgres, not app code.)
- Express JSON body-parsing internals — only our 400-on-malformed behavior is asserted.
- TypeScript-enforced correctness of the `Card` interface — covered by the compiler.
- FK constraint enforcement by Postgres itself — we test our application-level `board_id`-existence check (AC-ERROR-3), not the DB constraint.

### Per-Phase Test Guidance
- **Phase 1 (data layer)**: ~7 tests in `cards.repository.test.ts` — create (parameterized INSERT ... RETURNING, defaults applied), findAll (unfiltered), findAll (filtered by `board_id`), findById (hit + null miss), update (partial + `updated_at` bump), delete (affected-row reporting).
- **Phase 2 (HTTP + validation layer)**: ~13 tests — `cards.validation.test.ts` (~5: title, board_id, status enum, optional fields, board_id-not-patchable) + `cards.routes.test.ts` (~8+: entry/mount, 5 happy CRUD with round-trips, `?board_id=` filter, cascade AC-HAPPY-7, 404, 400 validation, 400 board_id-not-found, malformed-JSON/500 fail-safe).

## Implementation Roadmap

- [x] **Phase 1: Data layer** — `cards` schema + domain model + repository ✅ (2026-07-12)
  - Add `db/init/002_cards.sql`: `CREATE TABLE cards` (INTEGER identity PK; `board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE`; `title VARCHAR(200) NOT NULL`; `description TEXT`; `status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done'))`; `due_date DATE`; `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`) + `CREATE INDEX ON cards(board_id)`. File numbered `002_` so it runs after `001_boards.sql` in the mounted `db/init` dir (FK target must exist first).
  - Add `src/cards/cards.types.ts` — `Card`, `CreateCardInput`, `UpdateCardInput`, `CardStatus` union.
  - Add `src/cards/cards.repository.ts` — `CardsRepository` interface + `PostgresCardsRepository(pool)`: parameterized queries, `RETURNING`-based create/update, `findAll(boardId?)` (optional WHERE), row→domain mapping, `boardExists(id)` helper (or reuse boards repo) for the AC-ERROR-3 existence check.
  - Tests: `src/cards/cards.repository.test.ts` (mocked pool).
- [x] **Phase 2: HTTP + validation layer** — validators, routes, wiring, error handling (delivers the complete client-facing flow) ✅ (2026-07-13)
  - Add `src/cards/cards.validation.ts` — hand-rolled create/update validators (no new dependency, simplicity-first), mirroring `boards.validation.ts`: title required/non-blank/≤200, board_id required integer (create only, not patchable), status ∈ enum, description/due_date optional + typed; structured 400 errors.
  - Add `src/cards/cards.routes.ts` — `createCardsRouter(cardsRepo, boardsRepo): Router` exposing the 5 endpoints with exact spec status codes/bodies + the `?board_id=` filter; application-level board_id-existence check → 400 (AC-ERROR-3); fail-safe `next(err)` handling; log mutations via `src/config/logger.ts` `log()` (no `console.log`).
  - Wire into `src/app.ts`: extend `AppDeps` with `cardsRepo: CardsRepository`; `app.use(createCardsRouter(deps.cardsRepo, deps.boardsRepo))`. Central error handler already handles malformed-JSON→400 / →500.
  - Wire into `src/server.ts`: construct `new PostgresCardsRepository(pool)` and inject it.
  - Update `src/app.test.ts` + `src/health/health.test.ts` stubs to include `cardsRepo`.
  - Tests: `src/cards/cards.validation.test.ts`, `src/cards/cards.routes.test.ts`. Full entry→success flow (create a card → 201 → GET returns it; PATCH status → GET reflects move) covered here.
  - README note: `002_cards.sql` (like `001_boards.sql`) only applies on an empty data dir — `docker compose down -v` required to re-provision an existing dev DB.

## Creative Phases

- [x] Design questions resolved inline during planning (see **Design Decisions** above) — no separate `/banyan-creative` phase required.

---

## Build Execution State

**Build Status**: COMPLETE (BUILD_COMPLETE — all phases done)
**Current Build**: Phase 2: HTTP + validation layer (TASK-003) — COMPLETE
**Build Started**: 2026-07-13
**Phase Number**: 2 of 2
**Is Multi-Phase**: YES
**Branch**: feature/FEAT-003-card-crud (in-repo, Worktree N/A)

### Current Build Step
**Step**: All phases complete — committed. Next: `/banyan-reflect TASK-003`.
**Status**: COMPLETE
**Completed**: 2026-07-13
**Output**: HTTP layer built. cards.validation.ts (+15 tests), cards.routes.ts (5 endpoints + ?board_id filter + AC-ERROR-3 board-existence 400 + fail-safe), wired cardsRepo into AppDeps/createApp/server.ts, extended app.test.ts + health.test.ts stubs, README Cards API + 002_cards.sql notes. 95/95 tests pass, tsc strict PASS. All AC groups (ENTRY-1, HAPPY-1..7 incl. cascade, ERROR-1..4) covered.

### Completed Steps
- Step 0: Resolved FEAT-003 → auto-provisioned TASK-003
- Step 3: Spec Writer Agent (Sonnet) → Specification written, taxonomy CLEAN
- Step 3.2: Human review → APPROVED (resolve design questions inline)
- Step 5: Test Strategy + Implementation Roadmap written (2 phases)
- Step 6: Validation gate PASSED; no creative phase required; PLANNING_COMPLETE
- Step 0.5 Git Setup: COMPLETE (2026-07-12) — created feature/FEAT-003-card-crud from main
- Step 1 Read Task Context: COMPLETE (2026-07-12) — Phase 1 (data layer) identified, Level 3, 2 phases
- Phase 1 Build: COMPLETE (2026-07-12) — schema + types + repository + 14 tests; 62/62 pass; tsc PASS; committed to feature branch
- Phase 2 Build: COMPLETE (2026-07-13) — validation + routes + app/server wiring + README; 33 new tests (15 validation + 18 routes); 95/95 pass; tsc PASS; committed to feature branch. Status → BUILD_COMPLETE.

### Resumption Notes
**Can Resume**: NO (BUILD_COMPLETE)
**Resume From**: N/A — both phases complete. Next workflow step: `/banyan-reflect TASK-003`, then `/banyan-archive TASK-003`.
**Notes**: All acceptance criteria covered by the test suite. Live `ON DELETE CASCADE` / real-DB FK behavior to be smoke-tested manually via `docker compose up` + curl (per Test Strategy — no live DB in the automated suite).
