# TASK-002: Board CRUD API

**Complexity**: Level 3 (inherited from FEAT-002)
**Status**: REFLECTION_COMPLETE
**Reflection**: memory-bank/reflection/reflection-TASK-002.md
**Roadmap**: FEAT-002
**Branch**: feature/FEAT-002-board-crud
**Worktree**: N/A

## Task Description

Introduce the Board domain model with full CRUD REST endpoints (GET all, GET by id, POST, PATCH, DELETE) and comprehensive tests. Includes the boards table/schema, a repository/data-access layer over the existing `pg` pool, input validation, and 404/error handling. Prerequisite for all board-scoped features (columns, cards).

**Dependencies**: FEAT-001 (Project Foundation — DB pool + app factory). This feature unblocks FEAT-003 (Card CRUD API), whose `board_id` foreign key references `boards.id`.

## Specification

**Feature Type**: End-User Feature
*Note: this is a REST API surface with no direct UI in this task. It is consumed by the (not-yet-built) React frontend and is directly exercisable via HTTP clients (curl, Supertest) for verification.*
**Primary Persona**: Priya (Team Lead / Project Coordinator) — creates and manages boards to organize her team's work (`memory-bank/productBrief.md` Key Personas). Marco and Sam consume `GET /boards`/`GET /boards/:id` to see board state; Devon (self-hosting admin) is not a direct API consumer.
**Creative Exploration Needed**: Yes — see "Creative Exploration Needed" below (schema/migration mechanism, `boards.id` PK strategy). Entry/Happy/Error paths and response contracts are concrete and do NOT require creative exploration.

### Invocation Method
- **Location**: New `src/boards/` module, mirroring the existing `src/health/` module structure (`memory-bank/systemPatterns.md` Component Responsibilities). Routes are mounted in the app factory `createApp()` (`src/app.ts`), alongside the existing `GET /` and the health router.
- **Element**: Five REST endpoints on the `boards` resource:
  | Method | Path | Purpose |
  |---|---|---|
  | `POST` | `/boards` | Create a board |
  | `GET` | `/boards` | List all boards |
  | `GET` | `/boards/:id` | Fetch one board |
  | `PATCH` | `/boards/:id` | Partially update a board (name/description) |
  | `DELETE` | `/boards/:id` | Delete a board |
- **Visibility**: Always reachable — no auth/RBAC gate exists anywhere in the codebase yet (confirmed via `src/app.ts`, `src/server.ts`; productBrief's "RBAC scoped to boards" is an aspirational NFR with an open question — "Authentication approach ... later?" — not yet implemented). Enforcing auth is explicitly **out of scope** for this task; see Scope Boundaries.
- **Navigation**: API-only — a client reaches the feature via `http://<host>:<PORT>/boards[...]` where `PORT` comes from `src/config/env.ts` (default 3000, or `docker-compose.yml`'s mapped `3000:3000`). No UI navigation steps exist yet.
- **Confidence**: HIGH — the module layout, DI pattern (`AppDeps`), and router-factory shape (`createBoardsRouter(boardsRepo): Router`, following `createHealthRouter(checkDb): Router` in `src/health/health.ts`) all follow an established, single, unambiguous precedent in this codebase.

### Success Criteria
- **User sees**: Exact JSON response bodies and status codes:
  - `POST /boards` → `201` with the created board (including generated `id`, `created_at`, `updated_at`)
  - `GET /boards` → `200` with a JSON array of all boards
  - `GET /boards/:id` → `200` with the board, or `404` if no board has that id
  - `PATCH /boards/:id` → `200` with the updated board, or `404`/`400` (see Acceptance Criteria)
  - `DELETE /boards/:id` → `204` with an empty body, or `404`
- **Verifiable at**: The same endpoint via round-trip (e.g. `POST` then `GET /boards/:id` returns the same data); directly in the `boards` table via `psql`/a test DB client.
- **Data persisted**: `boards` table (new — first domain table in the schema). Proposed columns:

  | Column | Type | Notes |
  |---|---|---|
  | `id` | `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` (recommended — see Creative Exploration Needed) | FK target for FEAT-003's `cards.board_id` |
  | `name` | `VARCHAR(120) NOT NULL` | required, non-blank (validated) |
  | `description` | `TEXT NULL` | optional |
  | `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | set once on insert, never changes |
  | `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | bumped on every successful `PATCH` |

  Delete semantics: **hard delete** (row physically removed), consistent with productBrief's Data & Privacy statement — "Right to Deletion: Account and board deletion cascades to associated cards" — which describes cascading hard deletion, not soft-delete/archival. (HIGH confidence — directly sourced from productBrief.)
- **Observable within**: Immediate — all Board CRUD operations are synchronous request/response; there is no async job or background processing in this feature.

### Acceptance Criteria

#### AC-ENTRY-1: Client can reach all five Board CRUD routes
**Priority**: MUST
**Given** the Express app is constructed via `createApp()` with a boards repository dependency injected (mirroring `AppDeps.checkDb` in `src/app.ts`)
**When** a client sends `GET /boards`, `POST /boards`, `GET /boards/:id`, `PATCH /boards/:id`, and `DELETE /boards/:id`
**Then** each route is handled by the Board CRUD router (not Express's generic unmatched-route 404, as verified today by `src/app.test.ts`'s "`returns 404 for unknown routes`" case) — i.e. each responds with the resource-specific status/body defined in this spec, proving the router is mounted and reachable

#### AC-HAPPY-1: Client creates a board
**Priority**: MUST
**Given** the `boards` table exists (empty or containing other boards)
**When** a client sends `POST /boards` with body `{ "name": "Sprint Board", "description": "Q3 sprint" }`
**Then** the response is `201 Created` with a JSON body containing a generated `id`, the submitted `name` and `description`, and generated `created_at`/`updated_at` timestamps; a matching row exists in the `boards` table (verified by a subsequent `GET /boards/:id`, not just the echoed response)

#### AC-HAPPY-2: Client lists all boards
**Priority**: MUST
**Given** N boards exist in the `boards` table (created via prior `POST /boards` calls)
**When** a client sends `GET /boards`
**Then** the response is `200 OK` with a JSON array of exactly N board objects reflecting current DB state — not a hardcoded/stubbed list; creating an (N+1)th board and re-fetching returns N+1 items

#### AC-HAPPY-3: Client fetches a single board by id
**Priority**: MUST
**Given** a board with a known `id` exists
**When** a client sends `GET /boards/:id` using that id
**Then** the response is `200 OK` with the JSON board object whose fields match what was persisted (same `id`/`name`/`description`/`created_at`/`updated_at`)

#### AC-HAPPY-4: Client updates a board
**Priority**: MUST
**Given** an existing board
**When** a client sends `PATCH /boards/:id` with body `{ "name": "Renamed Board" }` (partial update — `description` omitted)
**Then** the response is `200 OK` with the updated `name`, an unchanged `description`, an unchanged `created_at`, and an `updated_at` newer than before; a subsequent `GET /boards/:id` reflects the new name (change is persisted, not just echoed)

#### AC-HAPPY-5: Client deletes a board
**Priority**: MUST
**Given** an existing board
**When** a client sends `DELETE /boards/:id`
**Then** the response is `204 No Content`; a subsequent `GET /boards/:id` for the same id returns `404 Not Found`; the row no longer exists in the `boards` table

#### AC-ERROR-1: Client gets 404 for a board that does not exist
**Priority**: MUST
**Given** no board exists with a given id (e.g. `999999`)
**When** a client sends `GET /boards/999999`, `PATCH /boards/999999`, or `DELETE /boards/999999`
**Then** each responds `404 Not Found` with a JSON error body (e.g. `{ "error": "Board not found" }`); no row is created or modified as a side effect

#### AC-ERROR-2: Client gets 400 for invalid create/update payloads
**Priority**: MUST
**Given** a client is creating or updating a board
**When** they send `POST /boards` with a missing or blank `name` (or a `name` exceeding 120 characters), or `PATCH /boards/:id` with an invalid field type (e.g. `name: 123`)
**Then** the response is `400 Bad Request` with a JSON error body describing the validation failure; no row is created or modified in the `boards` table

#### AC-ERROR-3: Client gets a safe, non-crashing error for malformed requests or DB failures
**Priority**: MUST
**Given** a client sends `POST /boards`/`PATCH /boards/:id` with a malformed JSON body, OR the database is unreachable during any Board CRUD operation
**When** the request is processed
**Then** the API responds with a `400` (malformed JSON) or `500` (DB failure) JSON error body — mirroring the fail-safe pattern already established in `src/health/health.ts` (catch, return a status, never throw/crash the process) — and no internal stack trace or driver error text leaks into the response body

*AC-ASYNC: not applicable. All Board CRUD operations are synchronous request/response; there is no async lifecycle or blocked state to observe in this feature.*

### Scope Boundaries
- **In scope**: The Board domain model; the `boards` table/schema; a repository/data-access layer over the existing `pg` pool (`src/db/pool.ts`); the five REST endpoints (`POST/GET/GET:id/PATCH/DELETE /boards`); request-body validation; 404 and error handling; comprehensive tests (unit + Supertest-driven integration, following `src/health/health.test.ts`'s style).
- **Out of scope**: Columns and Cards (FEAT-003, blocked until this ships); authentication/authorization/RBAC enforcement (no auth exists anywhere in the app yet — productBrief's RBAC requirement is a future dependency, not part of this task); pagination/filtering/sorting on `GET /boards` beyond returning the full list; soft-delete/archival/undo; board sharing/membership; rate limiting; real-time updates.
- **Dependencies**: FEAT-001 (Project Foundation) — the `pg` pool (`src/db/pool.ts`), the `createApp(deps)` factory/DI pattern (`src/app.ts`), env/logger conventions (`src/config/`). This feature is a hard prerequisite that unblocks FEAT-003 (Card CRUD API), whose `cards.board_id` foreign key references `boards.id`.
- **NFR implications** (from `memory-bank/productBrief.md`): API latency should stay within the stated p95 < 200ms / p99 < 500ms budget (simple CRUD over a single table should comfortably meet this); structured JSON logging per CLAUDE.md's Observability Standards should log board mutations (create/update/delete) with a trace/correlation id once OTEL is wired up project-wide (not newly introduced by this task, but new log call sites should follow the existing `log()` convention in `src/config/logger.ts`); no accessibility NFR applies (no UI); the security NFR (RBAC scoped to boards) is explicitly **not** satisfied by this task and should be tracked as a known gap until an auth feature lands.

### Creative Exploration Needed
Yes — two concrete, scoped questions (not full UX exploration; Entry/Happy/Error behavior above is otherwise concrete):

1. **Schema/migration management mechanism** (LOW confidence): no migration tool or SQL init script exists in the repo today — `docker-compose.yml`'s `db` service provisions an empty Postgres 16 container with no `docker-entrypoint-initdb.d` mount, and `package.json` has no migration dependency. This is the first schema ever added, so the choice made here sets precedent for FEAT-003 and beyond. Options: (a) a committed SQL init script mounted into the Postgres container, (b) an idempotent `CREATE TABLE IF NOT EXISTS boards (...)` executed at app boot, (c) introducing a lightweight migration tool (e.g. `node-pg-migrate`). Recommendation leaning toward (a) or (b) per the "simplicity-first" guiding principle in `systemPatterns.md`, but the plan/creative phase should confirm.
2. **`boards.id` primary-key strategy** (MEDIUM confidence): `INTEGER GENERATED ALWAYS AS IDENTITY` vs `UUID`. No precedent exists (first table in the schema) and the choice determines the type of FEAT-003's `cards.board_id` FK. Recommendation: `INTEGER` identity column, per simplicity-first and absent any stated requirement for opaque/non-enumerable ids — but flagged because it's foundational for every future table.

All other fields (routes, status codes, response shapes, validation/error behavior, delete semantics) are concrete and ready for implementation planning without further exploration.

---

**Spec Writer Notes to Orchestrator**: Confidence is HIGH on invocation method (module layout and DI pattern directly mirror the existing `src/health/` precedent), HIGH on the five route contracts and their status codes/response shapes (Acceptance Criteria are fully concrete — 1 AC-ENTRY, 5 AC-HAPPY, 3 AC-ERROR, AC-ASYNC explicitly not applicable), and HIGH on delete semantics (hard delete, directly sourced from productBrief's data-retention statement). Confidence is MEDIUM-to-LOW on two narrow technical questions that affect schema design rather than API behavior: the schema/migration mechanism (no precedent exists in this repo) and the `boards.id` primary-key type (int identity vs UUID), both flagged above with a recommendation. A short, scoped creative/architecture pass on just these two questions is recommended before or during `/banyan-plan`'s implementation design step — full `/banyan-creative` UX exploration is not needed since there is no UI and the REST contract itself is already concrete.

## User Journey Definition

> Superseded by the `## Specification` section above, which holds the authoritative
> Invocation Method, Success Criteria, and Acceptance Criteria (AC-ENTRY / AC-HAPPY /
> AC-ERROR) for this REST API feature. This placeholder is retained only for template
> structure — do not fill it separately.

## Design Decisions (resolved inline during planning, 2026-07-12)

The two questions the Spec Writer flagged were resolved inline (human-approved), so **no `/banyan-creative` phase is required**:

1. **Schema/migration mechanism** → **Committed SQL init script** (spec option *a*). A `db/init/001_boards.sql` file is mounted read-only into the Postgres container at `/docker-entrypoint-initdb.d/`. Rationale: simplicity-first (`systemPatterns.md`), zero new dependencies, and it establishes the schema-provisioning precedent for FEAT-003.
   - **Known limitation (documented, not a blocker)**: `docker-entrypoint-initdb.d` scripts run only on an *empty* data directory. The existing `db-data` volume from FEAT-001 must be recreated (`docker compose down -v`) for the script to apply the first time. This is acceptable for a pre-release dev database and will be called out in the README.
2. **`boards.id` primary-key type** → **`INTEGER GENERATED ALWAYS AS IDENTITY`**. Rationale: simplicity-first, no requirement for opaque/non-enumerable ids. This fixes the type of FEAT-003's `cards.board_id` FK to `INTEGER`.

## Test Strategy

### Approach
- **Emphasis**: Integration-leaning (Supertest through the real Express app) + focused unit tests on the repository's SQL/row mapping. Matches the foundation's convention (`src/app.test.ts`, `src/health/health.test.ts`): construct the app via `createApp(deps)` with **stubbed dependencies — no live database**.
- **Target test count**: ~15 (justified: 5 CRUD verbs × happy path, 3 error paths, 1 entry/mount, plus repository mapping/param tests).

### File Organization
- **New test files**:
  - `src/boards/boards.routes.test.ts` — Supertest against `createApp({ ...deps, boardsRepo: <in-memory stub> })`; covers AC-ENTRY-1, AC-HAPPY-1..5, AC-ERROR-1 (404), AC-ERROR-2 (400 validation), AC-ERROR-3 (500 on repo throw). The in-memory stub is **stateful** so create→get, patch→get, delete→get(404) assertions verify persistence semantics, not just echoed responses.
  - `src/boards/boards.repository.test.ts` — unit tests for `PostgresBoardsRepository` using a mocked `pg` client (`pool.query` mock): asserts correct SQL text/parameterization (parameterized queries, no interpolation) and row→`Board` mapping. Verifies `RETURNING` on insert/update and the `updated_at` bump on update.
- **Extend existing**: `src/app.test.ts` — the "returns 404 for unknown routes" test stays valid; add nothing unless the boards mount changes the unknown-route behavior (it must not).

### What NOT to Test
- The `pg` driver's networking / real DB round-trips — no live DB in the unit/integration suite (parity with FEAT-001; a real-DB smoke test is exercised manually via `docker compose up` + curl, documented in AC verification).
- Express's JSON body parsing internals — covered by the framework; we only assert our 400 behavior on malformed/invalid bodies.
- TypeScript-enforced type correctness of the `Board` interface — covered by the compiler.

### Per-Phase Test Guidance
- **Phase 1 (data layer)**: ~5 tests in `boards.repository.test.ts` — `create` issues parameterized INSERT ... RETURNING and maps the row; `findAll` returns mapped array; `findById` returns null when no row; `update` bumps `updated_at` and applies partial fields; `delete` reports whether a row was removed.
- **Phase 2 (HTTP layer)**: ~10 tests in `boards.routes.test.ts` — one per AC (entry/mount, 5 happy CRUD with state round-trips, 404, 400 validation for POST+PATCH, 500 on repo failure with no stack-trace leak).

## Implementation Roadmap

- [x] **Phase 1: Data layer** — `boards` schema + domain model + repository ✅ (2026-07-12)
  - Add `db/init/001_boards.sql` (`CREATE TABLE boards` with INTEGER identity PK, columns per spec) and mount it into the `db` service in `docker-compose.yml` at `/docker-entrypoint-initdb.d/`.
  - Add `src/boards/boards.types.ts` — `Board` domain interface, `CreateBoardInput`, `UpdateBoardInput`.
  - Add `src/boards/boards.repository.ts` — `BoardsRepository` interface + `PostgresBoardsRepository` (constructed from the `pg` `Pool`), parameterized queries, `RETURNING`-based create/update, row→domain mapping.
  - Tests: `src/boards/boards.repository.test.ts` (mocked pool).
- [x] **Phase 2: HTTP layer** — validation, routes, wiring, error handling (delivers the complete client-facing flow) ✅ (2026-07-12)
  - Add `src/boards/boards.validation.ts` — validate create/update bodies (name required/non-blank/≤120 chars, description optional string); return structured 400 errors; no external validation dependency (hand-rolled, simplicity-first) unless trivially justified.
  - Add `src/boards/boards.routes.ts` — `createBoardsRouter(repo: BoardsRepository): Router` exposing the 5 endpoints with the exact status codes/bodies from the spec; mirror `health.ts` fail-safe error handling (catch → 500 JSON, never leak internals, never crash).
  - Wire into `src/app.ts`: extend `AppDeps` with `boardsRepo: BoardsRepository`; `app.use(createBoardsRouter(deps.boardsRepo))`.
  - Wire into `src/server.ts`: construct `new PostgresBoardsRepository(pool)` and pass it into `createApp` deps.
  - Log board mutations (create/update/delete) via the existing `log()` helper in `src/config/logger.ts` (no `console.log` — CLAUDE.md observability rule).
  - Tests: `src/boards/boards.routes.test.ts` (in-memory stub repo). Full entry→success flow (create a board → 201 → GET returns it) covered here.

## Creative Phases

- [x] Design questions resolved inline during planning (see **Design Decisions** above) — no separate `/banyan-creative` phase required.

---

## Build Execution State

**Build Status**: IDLE
**Current Phase**: REFLECT → ARCHIVE
**Current Build**: Phase 2: HTTP layer (TASK-002)
**Phase Number**: 2 of 2
**Is Multi-Phase**: YES
**Branch**: feature/FEAT-002-board-crud (local-merge strategy, no worktree)

### Current Build Step
**Step**: REFLECTION_COMPLETE — reflection doc + learned rules written. Next: `/banyan-archive TASK-002`
**Status**: COMPLETE (2026-07-12)
**Can Resume**: NO

### Completed Steps (Phase 1)
- Step 0.5 Git Setup: COMPLETE — created/switched to feature/FEAT-002-board-crud
- Step 0.6 Phase Gate: COMPLETE — taxonomy clean, roadmap populated, no creative required
- Step 1 Read Task Context: COMPLETE — Phase 1 (Data layer) identified, 1 of 2
- Step 2 Load Context: COMPLETE — Level 3
- Step 3 Test Writer: COMPLETE — `src/boards/boards.repository.test.ts`, 12 tests (mocked pool)
- Step 4 Coding Agent: COMPLETE — `src/boards/boards.repository.ts` (BoardsRepository + PostgresBoardsRepository), `db/init/001_boards.sql`, docker-compose init mount
- Step 6/7 Verification: COMPLETE — Tests 19/19 PASS, Build (tsc) PASS, Lint N/A (no lint script)
- Step 8 Code Review: COMPLETE — parameterized queries (injection-safe), DI interface, RETURNING; no issues
- Step 10 Memory Bank: COMPLETE — Phase 1 marked complete

### Completed Steps (Phase 2)
- Step 1 Read Task Context: COMPLETE — Phase 2 (HTTP layer) identified, 2 of 2
- Step 3 Test Writer: COMPLETE — `boards.routes.test.ts` (16 integration tests, stateful in-memory stub), `boards.validation.test.ts` (13 unit tests)
- Step 4 Coding Agent: COMPLETE — `boards.validation.ts`, `boards.routes.ts` (5 endpoints), `app.ts` (boardsRepo dep + router mount + central error handler), `server.ts` (PostgresBoardsRepository wiring); updated `app.test.ts`/`health.test.ts` stubs
- Step 6/7 Verification: COMPLETE — Tests 48/48 PASS, Build (tsc strict) PASS, Lint N/A
- Step 8 Code Review: COMPLETE — typescript-reviewer Approve (Warning); applied `res.headersSent` guard + stack logging in error handler
- Step 10 Memory Bank: COMPLETE — Phase 2 marked complete, tasks.md → BUILD_COMPLETE

### Phase 1 Deliverables
- `src/boards/boards.types.ts` — Board, CreateBoardInput, UpdateBoardInput (pre-existing)
- `src/boards/boards.repository.ts` — BoardsRepository interface + PostgresBoardsRepository
- `src/boards/boards.repository.test.ts` — 12 unit tests (mocked pg pool)
- `db/init/001_boards.sql` — boards table DDL (INTEGER identity PK)
- `docker-compose.yml` — mounts `./db/init` into the db service init dir

### Phase 2 Deliverables
- `src/boards/boards.validation.ts` — hand-rolled create/update validators (name required/non-blank/≤120, description string|null)
- `src/boards/boards.routes.ts` — `createBoardsRouter(repo)`: 5 REST endpoints, fail-safe `next(err)` handling, mutation logging
- `src/app.ts` — `AppDeps.boardsRepo`, router mount, central error handler (malformed JSON→400, else→500, headersSent guard, no leak)
- `src/server.ts` — constructs `PostgresBoardsRepository(pool)` and injects it
- `src/boards/boards.routes.test.ts` — 16 integration tests (stateful stub, persistence round-trips)
- `src/boards/boards.validation.test.ts` — 13 unit tests
- Updated `src/app.test.ts`, `src/health/health.test.ts` — inject stub `boardsRepo`

### Acceptance Criteria Coverage
- AC-ENTRY-1 (all 5 routes mounted/reachable) ✅
- AC-HAPPY-1..5 (create/list/get/update/delete with persistence round-trips) ✅
- AC-ERROR-1 (404 JSON on missing id, GET/PATCH/DELETE) ✅
- AC-ERROR-2 (400 on invalid create/update payloads) ✅
- AC-ERROR-3 (400 malformed JSON, 500 on DB failure, no stack-trace leak) ✅

### Resumption Notes
**Can Resume**: NO (all phases complete — BUILD_COMPLETE)
**Resume From**: N/A
**Notes**: Run `/banyan-reflect TASK-002` to create the reflection document, then `/banyan-archive TASK-002` (Level 3 → reflect + archive recommended).

### Active Sub-Agents
(none)
