# Archive: React Frontend (TASK-004 / FEAT-004)

## Metadata
- **Task ID**: TASK-004
- **Complexity**: Level 3
- **Roadmap Link**: FEAT-004 (React Frontend)
- **Branch**: feature/FEAT-004-react-frontend
- **Started**: 2026-07-13 (plan)
- **Completed**: 2026-07-14 (archived)
- **Disposition**: local-merge → `main` (Archive Strategy per projectbrief.md)

## Summary

Delivered BanyanBoard's first user-facing surface: a **read-only React SPA** with two views — a board list page (`/`) listing all boards, and a board view (`/boards/:id`) that groups a board's cards into three fixed status columns (To Do / In Progress / Done). The app consumes the already-complete Board/Card REST API (FEAT-002/003, 95/95 backend tests) without modifying any backend code. This was the project's first frontend task in an otherwise all-backend (Express/TypeScript) repository, and it stood up a complete frontend toolchain (Vite + React + TypeScript + Vitest/RTL) from scratch under `frontend/`.

## Requirements

### Original Requirements (from FEAT-004)
- A React app builds and runs with a documented start command, configured against the API base URL via environment (12-factor)
- Board list page fetches and displays all boards; selecting a board navigates to its board view
- Board view renders the board's cards in three columns (To Do / In Progress / Done) based on card status
- Loading, empty, and error states handled for both views
- Frontend covered by automated component/UI tests

### Success Criteria (11 Acceptance Criteria — all met in code + tests)
- [✓] AC-ENTRY-1 — board list is the landing view (`/`)
- [✓] AC-HAPPY-1 — app builds/runs via documented command; API base URL from env (`VITE_API_BASE_URL`, never hardcoded)
- [✓] AC-HAPPY-2 — board list fetches + renders all boards (count matches response)
- [✓] AC-HAPPY-3 — selecting a board navigates to `/boards/:id`
- [✓] AC-HAPPY-4 — cards grouped into 3 fixed columns by status; each card in exactly one column
- [✓] AC-HAPPY-5 — explicit empty state when no boards
- [✓] AC-HAPPY-6 — empty column still renders header + "no cards" indicator
- [✓] AC-ERROR-1 — board list fetch failure → error + retry
- [✓] AC-ERROR-2 — board/cards fetch failure → error + retry, no silent-empty column
- [✓] AC-ERROR-3 — 404 → distinct "board not found" state with a way back
- [✓] AC-ASYNC-1 — loading indicator; never blank/stale while pending

## Implementation

### Approach
Three sequential, independently-testable build phases, each with a human-review gate, preceded by two creative phases that resolved seven open LOW-confidence design questions before any code was written:
- **Phase 1** — Frontend scaffold, tooling & typed API client (delivers AC-HAPPY-1)
- **Phase 2** — Board list page + client-side routing (delivers AC-ENTRY-1, AC-HAPPY-2/3/5, AC-ERROR-1, AC-ASYNC-1)
- **Phase 3** — Board view + column grouping, completing the entry→success journey (delivers AC-HAPPY-4/6, AC-ERROR-2/3, AC-ASYNC-1)

### Key Components
1. **API client seam** — `frontend/src/api/client.ts` (the *only* module that calls `fetch`) + `types.ts` (frontend-owned wire types, dates as `string`, no `labels`). Returns a discriminated `ApiResult<T>` (`ok | http | network`) so the UI can distinguish network vs. HTTP vs. 404-as-not-found. Base URL read per-call from `import.meta.env.VITE_API_BASE_URL` (default same-origin `/api`).
2. **Async state machine** — `frontend/src/hooks/useApiResource.ts` maps `ApiResult` into a `loading | success | error` status union with a `reload` (retry), enforcing "never render stale/blank while pending" by construction.
3. **Shared state components** — `components/{Loading,ErrorState,EmptyState,NotFoundState}.tsx`, reused by both pages (`role="alert"`, `aria-live`, back-link on NotFound, no Retry where retry can't help).
4. **Routing** — `routes.tsx` (`/`, `/boards/:id`, catch-all `*`); `App.tsx` mounts `RouterProvider(createBrowserRouter(routes))`.
5. **Board list page** — `pages/BoardListPage/` (`BoardListPage`, `BoardList`, `BoardListItem`) — semantic `<ul>/<li>/<a>` full-row link list.
6. **Board view page** — `pages/BoardViewPage/` (`BoardViewPage`, `BoardHeader`, `Columns`, `Column`, `Card`, `groupCardsByStatus.ts`). `getBoardView(id)` composes `getBoard`+`getCards` in parallel while preserving the single fetch seam; `groupCardsByStatus` (pure) seeds all three status keys so every column always renders; status conveyed by persistent text `<h2>` labels, never color alone.
7. **CORS resolution** — Vite dev-server proxy (`/api/*` → `VITE_API_PROXY_TARGET`, default `http://localhost:3000`, `/api` prefix stripped). **Zero backend changes** — `src/app.ts` untouched.

### Design Decisions (creative phase)
- **Architecture**: Vite + `@vitejs/plugin-react`; React Router; raw `fetch` client (no data-fetching library — rejected as premature for 3 read-only endpoints); **dev-server proxy over backend CORS** (the highest-leverage call — resolved CORS with zero backend touch, dodged the `/boards` API-vs-route collision, kept the build env-agnostic); frontend-owned wire types (deviation from the shared-types recommendation, justified by the Date-vs-string mismatch and cost of restructuring a completed backend); Vitest + RTL + jsdom, co-located `*.test.tsx`; frontend in `frontend/` at repo root.
- **UI/UX**: semantic `<ul>/<li>/<a>` list; CSS Grid 3-col collapsing to a single stacked column <640px; shared Loading/Error/Empty/NotFound components; WCAG 2.1 AA (status via text label not color-only, `role="alert"`, `aria-live`, `:focus-visible` preserved); plain CSS / CSS Modules, no component library.

References: `memory-bank/creative/TASK-004-react-frontend-architecture.md`, `memory-bank/creative/TASK-004-react-frontend-uiux.md`

## Testing
- **Component/UI tests (Vitest + RTL)**: 20/20 passing — 8 client (`api/client.test.ts`) + 6 board list (`BoardListPage.test.tsx`) + 6 board view (`BoardViewPage.test.tsx`, incl. the list→click→columns journey).
- **Behavior/accessibility-focused**: queried by ARIA role/accessible name (`getByRole('region', { name: /To Do/ })`, `role="alert"`, `role="link"`) rather than test-ids — doubles as an a11y check.
- **Verification gate each phase**: `tsc --noEmit` clean; `vite build` PASS (final bundle 69.5 kB gzip, well under the <1s load budget); `npm audit` **0 vulnerabilities**.
- Backend tests untouched (95/95 still passing) — no `src/` changes.

## Files Changed
32 files, +4789 lines under `frontend/` (greenfield package — `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `README.md`, and `src/` per the component list above). No `src/` (backend) changes. Memory-bank docs (task file, creative ×2, reflection, progress, techContext, learned rules) updated across the lifecycle.

## Lessons Learned
- **The proxy decision cascaded into three wins from one choice** (CORS resolution + route-collision avoidance + env-agnostic build) — a strong signal the Architecture creative found the load-bearing question.
- **Accessibility designed in, not bolted on** — non-color status, `role`/`aria-live`, semantic list carried literally from creative into implementation and exercised by role-based test queries.
- **Single-fetch-seam discipline survived the trickiest phase** — Phase 3's `getBoardView` composed existing client functions instead of adding a second I/O path.
- **Two real greenfield-tooling challenges resolved cleanly**: (1) jsdom/undici rejects the data router's `AbortSignal` on navigation → tests drive the same `routes` array through declarative `MemoryRouter`+`Routes`; (2) Vitest 2→3 bump deduped a nested `vite@5` onto Vite 6, clearing all `npm audit` advisories.
- **Backend-scoped learned rules transferred only partially** to the first frontend task — DI/stub-testing and 12-factor-env held; SQL/repository/FK rules were N/A. This motivated seeding a new `frontend-patterns.md` learned topic.

Reference: `memory-bank/reflection/reflection-TASK-004.md` (Task Quality: High · Ecosystem Effectiveness: Good)

## References
- Task/Plan: `memory-bank/tasks/TASK-004.md`
- Creative (Architecture): `memory-bank/creative/TASK-004-react-frontend-architecture.md`
- Creative (UI/UX): `memory-bank/creative/TASK-004-react-frontend-uiux.md`
- Reflection: `memory-bank/reflection/reflection-TASK-004.md`
- Phase 1 archive: `memory-bank/archive/archive-TASK-004-phase1.md`
- Progress: `memory-bank/progress.md`

## Follow-up
1. **`/banyan-uat TASK-004` (strongly recommended — not yet run)** — this is the project's first UI, and the creative phase's WCAG 2.1 AA claims (keyboard traversal, screen-reader column-header/count announcements, non-color status legibility at each breakpoint) are **unverified in a real browser**. Closer to an unmet acceptance gap than optional polish.
2. **Human live-verify** — `npm run dev` against the actually-running API (real `/api/boards` round-trip). Same category as prior tasks' deferred `docker compose up` / live-DB smoke tests.
3. **Frontend-owned wire types will drift if the API contract changes** — any future backend `POST`/`PATCH` to `Board`/`Card` shape should trigger a frontend type review (promotion path to a shared `contract/` package is documented).
4. **Test/production router-instance fidelity gap** — `MemoryRouter`+`Routes` in tests vs. `createBrowserRouter` in `main.tsx`; low risk today, revisit if React Router loaders/actions are adopted.
5. **`.env.example` deviation** — repo tooling guards `.env*`, so the env template lives in `frontend/README.md`; consider a `techContext.md` note so contributors scanning for `.env.example` find it.
