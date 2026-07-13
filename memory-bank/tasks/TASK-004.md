# TASK-004: React Frontend

**Complexity**: Level 3
**Status**: CREATIVE_COMPLETE
**Roadmap**: FEAT-004
**Branch**: feature/FEAT-004-react-frontend
**Worktree**: N/A

## Task Description

Introduce a React single-page frontend for BanyanBoard consuming the existing REST API. Delivers two views: (1) a **board list page** showing all boards with the ability to open one, and (2) a **board view** rendering the selected board's cards grouped into three fixed columns — To Do / In Progress / Done. Includes frontend tech-stack and build-tooling setup (bundler, routing, API client), UI/UX layout for the board/column presentation, loading/empty/error states, and component structure. Read-oriented in this iteration (card drag-and-drop and card creation from the UI are out of scope unless a later feature adds them).

**Acceptance Criteria (from FEAT-004):**
- A React app builds and runs with a documented start command, configured against the API base URL via environment (12-factor)
- Board list page fetches and displays all boards; selecting a board navigates to its board view
- Board view renders the board's cards in three columns (To Do / In Progress / Done) based on card status
- Loading, empty, and error states are handled for both views
- Frontend is covered by automated component/UI tests

**Dependencies**: FEAT-002 (Board CRUD API — board list + board fetch); FEAT-003 (Card CRUD API — cards to populate columns, including a status field for column grouping). Both API features are complete.

## Specification

**Feature Type**: End-User Feature
**Primary Persona**: Priya (Team Lead / Project Coordinator) — "Organize the team's work, see status at a glance." Secondary beneficiaries: Marco (Team Member — sees what's assigned) and Sam (Stakeholder/Observer — glances at progress without editing), since this iteration is read-only for all personas.
**Creative Exploration Needed**: Yes — see below.

### Invocation Method
- **Location**: A new, standalone React SPA (no existing frontend in the repo — `techContext.md` Component Structure lists the frontend path as `[TBD]`). Two client-side routes: `/` (board list page) and `/boards/:id` (board view), where `:id` is the numeric `boards.id`.
- **Element**: On `/`, each board is rendered as a clickable list item/card (name + description) that navigates to `/boards/:id` on click. On `/boards/:id`, three column containers ("To Do", "In Progress", "Done") each render the cards whose `status` matches that column.
- **Visibility**: Always visible — the board list is the app's landing page; no auth gate exists in the API today (no auth endpoints in `src/`), so there is no conditional visibility to model in this iteration.
- **Navigation**: App entry (`/`) → board list renders via `GET /boards` → user clicks a board → browser navigates to `/boards/:id` → board view renders board header via `GET /boards/:id` and cards via `GET /cards?board_id=:id`, grouped into columns by `status`.
- **Confidence**: LOW. The API contract is HIGH confidence (verified against `src/boards/boards.routes.ts`, `src/cards/cards.routes.ts`, and `db/init/*.sql`), but the frontend tech stack, routing library, component structure, and layout are all undecided — `techContext.md` explicitly lists bundler/testing/lint tooling as `[TBD]` and no `frontend/` directory exists yet. See Creative Exploration Needed.

### Success Criteria
- **User sees**: On `/`, a list of all boards (each showing at least `name`, optionally `description`). On `/boards/:id`, the board's `name` as a header and its cards distributed into three columns headed "To Do" / "In Progress" / "Done", each card showing at least `title` (and ideally `description`/`due_date`).
- **Verifiable at**: The rendered DOM of `/` (board list items count/labels match the `GET /boards` response) and `/boards/:id` (column contents match the `GET /cards?board_id=:id` response, partitioned by the exact `status` value of each returned card).
- **Data persisted**: None. This is a read-only iteration — the frontend performs no writes (no `POST`/`PATCH`/`DELETE` calls to the API). Nothing new is persisted to `boards` or `cards`.
- **Observable within**: Immediately after the fetch resolves; per `productBrief.md` Technical Metrics, board load should complete in < 1s on broadband (API layer already targets p95 < 200ms / p99 < 500ms).

### Exact API Contract (verified in codebase)
- `GET /boards` → `200` `Board[]`, where `Board = { id: number, name: string, description: string | null, created_at, updated_at }` (`src/boards/boards.types.ts`, `db/init/001_boards.sql`).
- `GET /boards/:id` → `200 Board` or `404 { error: "Board not found" }` (`src/boards/boards.routes.ts`).
- `GET /cards?board_id=<id>` → `200` `Card[]`, where `Card = { id, board_id, title, description, status, due_date, created_at, updated_at }` and `status` is exactly one of `'todo' | 'in_progress' | 'done'` (`src/cards/cards.types.ts`, `db/init/002_cards.sql` CHECK constraint). Column mapping: `'todo'` → **To Do**, `'in_progress'` → **In Progress**, `'done'` → **Done**.
- **Known gap**: `src/app.ts` has no CORS middleware today. A frontend served from a different origin/port (typical for a dev server) will be blocked by the browser's same-origin policy until either CORS is enabled on the API or a dev-server proxy is configured. This must be resolved during implementation planning — see Dependencies below.
- **Known gap**: `productBrief.md` describes cards as having "labels," but `cards` (per `002_cards.sql`) has no `labels` column — labels are not yet implemented anywhere in the API. The board view must not assume a `labels` field exists on `Card`.

### Acceptance Criteria

#### AC-ENTRY-1: User can find the board list page
**Priority**: MUST
**Given** a user opens the frontend application's root URL
**When** the page loads
**Then** the board list page renders as the landing view (no additional navigation required to reach it)

#### AC-HAPPY-1: App builds and runs via a documented command, configured against the API by environment
**Priority**: MUST
**Given** the frontend project's dependencies are installed
**When** a developer runs the documented start command (to be recorded in `techContext.md`/README during implementation)
**Then** the app builds/starts without errors and loads in a browser, with the API base URL sourced from an environment variable (12-factor) rather than hardcoded

#### AC-HAPPY-2: Board list page fetches and displays all boards
**Priority**: MUST
**Given** the API's `GET /boards` returns one or more boards
**When** the user loads the board list page
**Then** every returned board is rendered with at least its `name`, and the number of rendered items equals the number of boards returned

#### AC-HAPPY-3: Selecting a board navigates to its board view
**Priority**: MUST
**Given** the user is on the board list page with at least one board rendered
**When** the user clicks/activates a board item
**Then** the app navigates to that board's view (`/boards/:id`) and begins loading that board's data

#### AC-HAPPY-4: Board view renders cards grouped into three fixed columns by status
**Priority**: MUST
**Given** `GET /cards?board_id=:id` returns a set of cards with a mix of `status` values
**When** the board view finishes loading
**Then** each card renders under the column matching its `status` (`todo`→To Do, `in_progress`→In Progress, `done`→Done), and no card appears in more than one column or in none

#### AC-HAPPY-5: Board list shows an explicit empty state when there are no boards
**Priority**: MUST
**Given** `GET /boards` returns an empty array
**When** the board list page loads
**Then** the user sees an explicit "no boards" message/state, not a blank page or an empty list with no explanation

#### AC-HAPPY-6: A column shows an explicit empty state when it has no matching cards
**Priority**: MUST
**Given** a board's cards contain zero entries for a given `status`
**When** the board view renders that column
**Then** the column is still rendered with its header and an explicit "no cards" indicator, not omitted or left ambiguous

#### AC-ERROR-1: User sees a recoverable error state when the board list fails to load
**Priority**: MUST
**Given** `GET /boards` fails (network error or non-2xx response)
**When** the board list page attempts to load
**Then** the user sees an explicit error message (not a blank page or an unhandled exception) with a way to retry

#### AC-ERROR-2: User sees a recoverable error state when a board's cards fail to load
**Priority**: MUST
**Given** `GET /boards/:id` or `GET /cards?board_id=:id` fails (network error or non-2xx response)
**When** the board view attempts to load
**Then** the user sees an explicit error message with a way to retry, and no column silently renders as empty due to a swallowed error

#### AC-ERROR-3: User sees a "not found" state when navigating to a nonexistent board
**Priority**: MUST
**Given** `GET /boards/:id` returns `404 { error: "Board not found" }` (e.g., a stale link or manually edited URL)
**When** the board view attempts to load that id
**Then** the user sees an explicit "board not found" state distinct from a generic error or a blank/loading screen, with a way back to the board list

#### AC-ASYNC-1: User sees a loading indicator while board data is being fetched
**Priority**: MUST
**Given** the user navigates to the board list page or a board view
**When** the corresponding fetch(es) are in flight
**Then** a loading indicator is shown, and it is replaced by the loaded content (or the empty/error state) once the fetch resolves — the user is never shown stale or blank content while data is pending

### Scope Boundaries
- **In scope**:
  - Board list page: fetch + render all boards via `GET /boards`; click-through navigation to a board view
  - Board view: fetch + render one board's header via `GET /boards/:id` and its cards via `GET /cards?board_id=:id`, grouped into the three fixed columns (To Do / In Progress / Done) by `status`
  - Frontend tech-stack and build-tooling setup: bundler/dev server, client-side routing (`/` and `/boards/:id`), an API client configured against the API base URL via environment variable (12-factor)
  - Loading, empty, and error UI states for both views
  - Automated component/UI tests for both views
- **Out of scope**:
  - Card drag-and-drop or any other way of moving a card between columns from the UI
  - Card creation, editing, or deletion from the UI
  - Board creation, editing, or deletion from the UI
  - Any authentication/login UI (no auth endpoints exist in the API yet)
  - Real-time/live updates (explicitly deferred to FEAT-005 — Realtime Activity Feed)
  - Card labels display (not modeled in `cards` schema yet — `description` says labels exist, but `db/init/002_cards.sql` has no `labels` column)
- **Dependencies**:
  - FEAT-002 (Board CRUD API) — `GET /boards`, `GET /boards/:id` — COMPLETE
  - FEAT-003 (Card CRUD API) — `GET /cards?board_id=` with `status` — COMPLETE
  - **New dependency surfaced by this spec**: the API currently has no CORS middleware (`src/app.ts`). Implementation planning must decide how the frontend dev server reaches the API (enable CORS on the API, or configure a dev-server proxy) before the board list/board view can function outside of same-origin serving.
- **NFR implications** (from `productBrief.md`):
  - Board load time < 1s on broadband (Technical Metrics); API already targets p95 < 200ms / p99 < 500ms
  - WCAG 2.1 AA: screen reader compatibility for boards/columns/cards, visible focus indicators, accessible names/roles, and column/status must not be conveyed by color alone
  - Responsive web: usable on tablet/phone browsers (no native app at MVP)
  - English-only at MVP; no i18n work required this iteration

### Creative Exploration Needed
Yes — the following design questions are open and should go through `/banyan-creative` before implementation:
- **Frontend build tooling**: no bundler/dev-server choice is recorded anywhere (`techContext.md` lists it as `[TBD]`); needs a decision (e.g., Vite vs. other).
- **Routing approach**: no routing library is chosen for the two views (`/` and `/boards/:id`).
- **API client pattern**: raw `fetch` wrapper vs. a data-fetching library, and how the API base URL is injected per 12-factor (build-time env var vs. runtime config) — no existing frontend convention to follow.
- **CORS/proxy strategy**: the API has no CORS middleware today; whether to add CORS support to `src/app.ts` or configure a frontend dev-server proxy is an open architectural decision affecting both repos.
- **Visual/UX layout**: no design system or UI component library exists yet for the board-list and three-column board-view layouts (visual hierarchy, empty/error/loading state presentation, column visual treatment for accessibility).
- **Component structure & test tooling**: file/folder conventions for the new frontend codebase, and confirmation of the component/UI test framework (Vitest + React Testing Library would mirror the backend's existing Vitest usage, but this is not yet decided for the frontend).

## Test Strategy

### Approach
- **Emphasis**: Component/UI tests, behavior-focused — mirrors the backend's integration-first philosophy (`systemPatterns.md` Testing Patterns) but at the component boundary: render a view, stub the API client, assert on user-observable DOM. Framework assumed **Vitest + React Testing Library** (matches backend Vitest; to be confirmed in the Architecture creative phase). One journey-style test walks the entry→success path (list renders → activate a board → board view renders columns) with a stubbed API layer — no live backend, consistent with the backend's "inject stubs, no live DB" pattern.
- **Target test count**: ~15 (justified: 3 views/state-machines — list, board view, and the API-client/env wiring — each exercising happy + empty + error + loading paths, ~10-20 band for a multi-component feature per project guidance). Each AC maps to at least one test.

### File Organization
- **New test files** (co-located, mirroring backend `src/**/*.test.ts` convention, at the frontend path decided in creative):
  - `BoardListPage.test.tsx` — board list fetch/render/navigate/empty/error/loading (AC-ENTRY-1, AC-HAPPY-2/3/5, AC-ERROR-1, AC-ASYNC-1)
  - `BoardViewPage.test.tsx` — card fetch, 3-column status grouping, column empty state, board error, 404 not-found, loading (AC-HAPPY-4/6, AC-ERROR-2/3, AC-ASYNC-1)
  - `apiClient.test.ts` — API base URL sourced from env (12-factor), request shaping for `/boards`, `/boards/:id`, `/cards?board_id=` (AC-HAPPY-1)
  - One journey test (in `BoardViewPage.test.tsx` or a dedicated `journey.test.tsx`) walking list → click → columns
- **Extend existing**: None — greenfield frontend, no existing test files. Backend `src/**/*.test.ts` (95/95 passing) are NOT modified except if the CORS decision adds middleware to `src/app.ts`, in which case extend `src/app.test.ts` with 1 test asserting the CORS header is present.

### What NOT to Test
- The REST API behavior itself — covered by backend tests (TASK-002/003, 95/95 passing). Frontend tests stub the API client.
- Bundler/dev-server config, React framework internals, and the routing library's own behavior — framework/tooling responsibility.
- Exact pixel-level visual layout and styling — belongs to `/banyan-uat` (browser walk) and visual review, not component unit tests. Tests assert structure/roles/labels (accessibility-relevant), not CSS.
- Card `labels` — not in the `cards` schema; nothing to render or test this iteration.

### Per-Phase Test Guidance
- Phase 1 (Scaffold & API client): ~3 tests — API base URL comes from env not hardcoded (AC-HAPPY-1); client builds correct request paths for the three GETs; documented start command works (smoke — build/boot).
- Phase 2 (Board list page): ~6 tests — renders all boards with names & count (AC-HAPPY-2); item click navigates to `/boards/:id` (AC-HAPPY-3); landing at `/` shows the list (AC-ENTRY-1); empty-state message when `GET /boards` returns `[]` (AC-HAPPY-5); error+retry when the fetch fails (AC-ERROR-1); loading indicator while in flight (AC-ASYNC-1).
- Phase 3 (Board view page): ~6 tests — cards land in the column matching `status`, each card in exactly one column (AC-HAPPY-4); a status with no cards still renders its column + empty indicator (AC-HAPPY-6); error+retry when board/cards fetch fails (AC-ERROR-2); distinct "board not found" state on 404 with a way back (AC-ERROR-3); loading indicator (AC-ASYNC-1); journey: list → click → columns render.

## Implementation Roadmap

Read-only React SPA consuming the existing (complete) Board + Card REST API. Three phases, each independently testable; the final phase completes the full entry→success journey (board list → open a board → see status columns). Concrete tech choices (bundler, router, API-client pattern, CORS-vs-proxy, layout, folder/test conventions) are resolved in the Creative phases below **before** Phase 1 build.

- [x] **Phase 1 — Frontend scaffold, tooling & API client (foundation).** ✅ BUILD COMPLETE (2026-07-13)
  - Scaffold the frontend project at the path chosen in creative (update `techContext.md` Component Structure + Development Commands from `[TBD]`).
  - Establish bundler/dev-server, TypeScript config, and the component-test framework (per Architecture creative).
  - Build a typed API client whose base URL is read from an environment variable (12-factor — no hardcoded host/port), exposing `getBoards()`, `getBoard(id)`, `getCards(boardId)` typed against the verified `Board`/`Card` contract (shared types recommended per `techContext.md` Shared/Common Code).
  - Resolve the **CORS gap**: implement the decision from the Architecture creative (add CORS middleware to `src/app.ts`, or configure a dev-server proxy). If CORS middleware is added, keep it 12-factor (allowed origin via env) and extend `src/app.test.ts`.
  - Document the start command (README + `techContext.md`).
  - **Delivers**: AC-HAPPY-1. **Files**: new frontend dir (`package.json`, bundler config, `tsconfig`, `src/api/apiClient.ts`, env example), possibly `src/app.ts` (backend CORS), `techContext.md`.

- [ ] **Phase 2 — Board list page (`/`).**
  - Set up client-side routing (`/` and `/boards/:id`) per the router chosen in creative.
  - Board list page: fetch `GET /boards`, render each board (name, optional description) as a clickable item that navigates to `/boards/:id`.
  - Handle loading (indicator), empty (`[]` → explicit "no boards" state), and error (fetch failure → message + retry) states.
  - Apply the visual/UX layout + accessibility treatment from the UI/UX creative (roles, accessible names, visible focus, not color-only).
  - **Delivers**: AC-ENTRY-1, AC-HAPPY-2, AC-HAPPY-3, AC-HAPPY-5, AC-ERROR-1, AC-ASYNC-1 (list). **Files**: routing setup, `BoardListPage.tsx` + test, shared list/empty/error/loading components.

- [ ] **Phase 3 — Board view page (`/boards/:id`) + column grouping (completes the journey).**
  - Board view: fetch `GET /boards/:id` (header) and `GET /cards?board_id=:id` (cards); partition cards into three fixed columns by `status` (`todo`→To Do, `in_progress`→In Progress, `done`→Done), each card rendering `title` (+ optional `description`/`due_date`).
  - Always render all three columns; a column with no matching cards shows its header + explicit "no cards" indicator (AC-HAPPY-6).
  - Handle loading, board/cards fetch error (message + retry), and a distinct 404 "board not found" state with a way back to the list.
  - Apply UI/UX creative layout + accessibility (column/status not conveyed by color alone).
  - **Delivers**: AC-HAPPY-4, AC-HAPPY-6, AC-ERROR-2, AC-ERROR-3, AC-ASYNC-1 (board); completes the full entry→success flow. **Files**: `BoardViewPage.tsx`, `Column.tsx`, `Card.tsx` + tests, journey test.

### Observability Requirements
- **Applies**: No. This is browser-side React rendering consuming existing endpoints; no new server HTTP handlers, workers, or multi-service calls are introduced. The backend already carries the project's logging/OTEL story. The only possible backend touch — optional CORS middleware on `src/app.ts` — is configuration, not a new traced operation. (If a later feature adds frontend telemetry/RUM, revisit then.)

### API Requirements
- **REST API**: No new or modified endpoints/schemas. The frontend consumes existing, verified endpoints (`GET /boards`, `GET /boards/:id`, `GET /cards?board_id=`). The only candidate backend change is adding CORS middleware to `src/app.ts` (cross-origin access enablement, decided in the Architecture creative) — middleware/config, not an endpoint or contract change.
- **GraphQL API**: No.

### Dependencies & Risks
- **Dep (satisfied)**: FEAT-002 Board API + FEAT-003 Card API — both COMPLETE (95/95 tests). Card `status` enum (`todo`/`in_progress`/`done`) drives column grouping.
- **Risk — CORS**: `src/app.ts` has no CORS middleware; a cross-origin dev server is blocked until resolved. → Mitigation: decide CORS-vs-proxy in the Architecture creative and implement in Phase 1 before wiring any fetch.
- **Risk — greenfield tooling churn**: no frontend conventions exist. → Mitigation: lock bundler/router/test-framework/folder decisions in the Architecture creative before Phase 1; keep choices simplicity-first per Guiding Principles.
- **Risk — API drift**: labels appear in productBrief but not in the `cards` schema. → Mitigation: type `Card` strictly from `002_cards.sql`; do not render `labels`.
- **Risk — accessibility regressions** (WCAG 2.1 AA NFR): status-by-color-only, missing focus/roles. → Mitigation: bake a11y requirements into the UI/UX creative and assert roles/labels in component tests; verify in `/banyan-uat`.

## Creative Phases

Level 3 with LOW-confidence design questions → creative exploration REQUIRED before build.

- [x] **Architecture Design** → COMPLETE → `memory-bank/creative/TASK-004-react-frontend-architecture.md`. Decisions: **Vite** + `@vitejs/plugin-react`; **React Router** (`/`, `/boards/:id`, catch-all `*`); **raw `fetch` client**, base URL from build-time `import.meta.env.VITE_API_BASE_URL` (default same-origin `/api`); **CORS resolved via Vite dev-server proxy — `src/app.ts` NOT touched** (proxy `/api`→`VITE_API_PROXY_TARGET`, default `http://localhost:3000`, `/api` prefix stripped; also avoids `/boards` API-vs-route collision); frontend-owned wire types in `src/api/types.ts` (dates as `string`); **Vitest + React Testing Library + jsdom**, co-located `*.test.tsx`; frontend lives in **`frontend/`** at repo root with its own `package.json` (`"type": "module"`).
- [x] **UI/UX Design** → COMPLETE → `memory-bank/creative/TASK-004-react-frontend-uiux.md`. Decisions: board list = semantic `<ul>/<li>/<a>` full-row link list; board view = CSS Grid 3-column (`repeat(3,1fr)`) collapsing to single stacked column below ~640px (no swipe/tabs); shared `Loading`/`ErrorState`(+Retry)/`EmptyState`/`NotFoundState` components reused by both pages; `groupCardsByStatus` pure fn guarantees all 3 columns always render; a11y: native `<a>`/`<button>`, status via persistent text `<h2>` label (never color-only), `role="alert"` on errors, `aria-live="polite"` on loading, distinct NotFound (no retry, back-link) vs generic error, `:focus-visible` outlines preserved; styling = plain CSS / CSS Modules, no component library.

---

## Execution State

**Build Status**: PHASE_COMPLETE (Phase 1 of 3) — awaiting human review before Phase 2
**Current Build**: Phase 1: Frontend scaffold, tooling & API client (TASK-004)
**Phase Number**: 1 of 3
**Is Multi-Phase**: YES
**Current Phase**: BUILD
**Current Step**: Phase 1 complete — committed
**Last Completed**: Step 11 Git Completion (Phase 1)
**Can Resume**: NO (phase boundary — next: `/banyan-build TASK-004` for Phase 2)

### Current Build Step
**Step**: Step 11 — Git Completion (Phase 1)
**Status**: COMPLETE

### Completed Steps (Phase 1 build)
- Step 0.1 Resumption check: NEW build (was IDLE)
- Step 0.1 Agent rules: generated `memory-bank/agent-rules-index.md` (6 learned files, all backend-scoped; transferable = DI/stub testing + 12-factor env)
- Step 0.5 Git Setup: created + switched to `feature/FEAT-004-react-frontend`; committed plan+creative baseline (ec25052)
- Step 0.6 Phase Gate: PASS (FEAT-004 linked, roadmap populated, Architecture + UI/UX creative COMPLETE)
- Step 1 Read Task Context: Phase 1 of 3 identified (multi-phase)
- Step 2 Load Context: Level 3 implementation rules
- Step 3 Test Writer: 8 tests in `src/api/client.test.ts` (base-URL-from-env ×2, request shaping ×2, result normalization ×4)
- Step 4 Coding Agent: scaffolded `frontend/` (Vite+React+TS), `api/types.ts`, `api/client.ts` (single fetch seam, discriminated ApiResult), app shell, vite proxy, Vitest+RTL setup
- Step 6-7 Verification: 8/8 tests PASS; `tsc --noEmit` clean; `vite build` PASS (46 kB gzip); dev server boots (VITE ready 312ms @ :5173); `npm audit` 0 vulns
- Step 8 Code Review: ecc:typescript-reviewer → APPROVE; applied 2 non-blocking fixes (encodeURIComponent on id/boardId; comment on intentional unchecked JSON cast)
- Step 9 Documentation: techContext.md Component Structure + Development Commands + Tooling filled (removed frontend [TBD]s); frontend/README.md
- Step 10 Memory Bank: this file + tasks.md + progress.md updated

### Prior Completed Steps
- Step 0.1: Auto-provisioned TASK-004 for FEAT-004 (Level 3), registered + linked
- Step 3: Spec Writer Agent — drafted `## Specification` (End-User Feature, 11 ACs: 1 ENTRY / 6 HAPPY / 3 ERROR / 1 ASYNC); human approved as-is; taxonomy PASS WITH WARNINGS (1× T-006 soft warning on the non-canonical `### Exact API Contract` sub-header)
- Step 5: Implementation plan — 3 phases (scaffold+API client / board list / board view+columns), Test Strategy (~15 component tests, Vitest+RTL), Observability N/A, no new REST endpoints, dependencies+risks documented
- Step 6: Finalized — 2 creative phases flagged REQUIRED (Architecture Design, UI/UX Design)
- Creative: Architecture Design — COMPLETE (Vite + React Router + raw fetch, dev-proxy for CORS, `frontend/` dir, Vitest+RTL) → creative/TASK-004-react-frontend-architecture.md
- Creative: UI/UX Design — COMPLETE (semantic list + CSS Grid 3-col responsive, shared state components, WCAG AA non-color status) → creative/TASK-004-react-frontend-uiux.md
