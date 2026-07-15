# Architecture Decision: React Frontend (BanyanBoard)

**Created**: 2026-07-13
**Status**: DECIDED
**Decision Type**: Architecture
**Task**: TASK-004 (Level 3) · **Roadmap**: FEAT-004

> Greenfield read-only React SPA consuming the existing (complete, 95/95) Board + Card REST API.
> This document ratifies the seven open architectural questions flagged in the plan so Phase 1 build
> can proceed without further guessing. Every decision is anchored to the two Guiding Principles that
> dominate this project: **simplicity-first clean architecture** (add abstraction only on concrete need)
> and **strict 12-factor config** (no hardcoded host/port in app code).

---

## Context

### System Requirements
- Two client-side routes only: `/` (board list) and `/boards/:id` (board view, `:id` = numeric `boards.id`).
- `/` fetches `GET /boards` → renders every `Board` (name, optional description) as a clickable item that navigates to `/boards/:id`.
- `/boards/:id` fetches `GET /boards/:id` (header) + `GET /cards?board_id=:id` (cards), partitions cards into three fixed columns by `status` (`todo`→To Do, `in_progress`→In Progress, `done`→Done).
- Loading, empty, error, and (board-view only) 404 "not found" states for both views.
- Automated component/UI tests covering the 11 acceptance criteria.
- API base URL sourced from environment (12-factor) — never hardcoded.
- **Read-only iteration**: no writes (`POST`/`PATCH`/`DELETE`) from the UI.

### Technical Constraints
- **Backend is COMPLETE and must not regress** — `src/app.ts` (pure `createApp(deps)` factory), `src/server.ts` (composition root), `pg` isolated in `src/db/pool.ts`, 95/95 Vitest + Supertest tests. Any change to `src/app.ts` risks the working suite.
- **`src/app.ts` has NO CORS middleware.** A cross-origin dev-server frontend is blocked by the browser same-origin policy until CORS is enabled OR the frontend calls same-origin.
- **Repo layout**: backend lives at repo root `src/`, single root `package.json` (`"type": "commonjs"`, `module: commonjs`, `target: ES2022`). Not a workspace-managed monorepo.
- **Wire-format gotcha (verified)**: backend domain types use JS `Date` for `created_at`/`updated_at`/`due_date`, but `res.json()` serializes them to **ISO strings**. The frontend contract sees `string`, not `Date`.
- **Route/path collision (verified)**: the client-side route `/boards/:id` collides with the API path `/boards`. If the SPA calls same-origin `/boards`, the browser router intercepts it. The API must be reached under a distinct prefix.
- **Schema truth**: `Card` has no `labels` column (`db/init/002_cards.sql`). Do not render or type `labels`.
- Frontend toolchain is fully `[TBD]` in `techContext.md`; no `frontend/` dir exists yet.

### Non-Functional Requirements
- **Performance**: board load < 1s on broadband (API already p95 < 200ms / p99 < 500ms). SPA bundle must stay small.
- **Accessibility**: WCAG 2.1 AA — roles/accessible names, visible focus, status/column not conveyed by color alone (detailed treatment owned by the UI/UX creative; this doc keeps the architecture a11y-friendly by using semantic routing/landmarks and RTL role-based tests).
- **Responsive**: usable on tablet/phone browsers (no native app).
- **i18n**: English-only at MVP (no i18n framework this iteration).
- **Browsers**: modern evergreen (Chrome/Firefox/Safari/Edge, latest 2).

### Existing Patterns That Must Be Respected
- **Simplicity-first clean architecture** — shallow layers, direct readable code over indirection.
- **12-factor config** — env vars only; local-dev defaults live in compose/config files, not app code.
- **Dependency injection / testability by construction** — backend injects I/O so tests use stubs with no live DB. The frontend mirror: the **API client is the single injectable I/O seam**; component tests stub it, never a live backend (matches `systemPatterns.md` Testing Patterns and the Test Strategy in TASK-004).
- **Driver/infrastructure isolation** — backend confines `pg` to one module. Frontend mirror: confine all `fetch` to one API-client module.
- **Vitest** as the test runner (backend uses Vitest + Supertest).

---

## Component Analysis

### Core Components
| Component | Purpose | Responsibilities |
|-----------|---------|------------------|
| **Build/dev tool (Vite)** | Bundle + dev server | TS/JSX transform, HMR dev server, production build, dev proxy to the API, env injection (`import.meta.env.VITE_*`) |
| **Router (React Router)** | Client-side routing | Map `/` → BoardListPage, `/boards/:id` → BoardViewPage; expose `:id` param; catch-all 404 route |
| **API client (`src/api/client.ts`)** | Single I/O seam | `getBoards()`, `getBoard(id)`, `getCards(boardId)`; owns all `fetch`; reads base URL from env; normalizes HTTP/network errors into typed results; the one thing tests stub |
| **Wire types (`src/api/types.ts`)** | Typed contract | `Board`, `Card`, `CardStatus` typed to the JSON wire format (dates as `string`) |
| **BoardListPage** | `/` view | Fetch boards; render list/empty/error/loading; navigate on click |
| **BoardViewPage** | `/boards/:id` view | Fetch board + cards; group by status; render 3 columns; loading/empty/error/404 |
| **Column / Card** | Presentation | Render a column header + its cards / a single card (`title`, optional `description`/`due_date`) |
| **Shared state components** | UX consistency | `LoadingState`, `EmptyState`, `ErrorState` (+ retry), `NotFoundState` |

### Component Interactions
```
                       browser
                          │
        ┌─────────────────┴──────────────────┐
        │  React Router  (/  ,  /boards/:id ) │
        └───────┬───────────────────┬─────────┘
                ▼                   ▼
         BoardListPage        BoardViewPage
                │                   │
                └────────┬──────────┘
                         ▼
              api/client.ts  (ONLY module that calls fetch)
                         │  base = import.meta.env.VITE_API_BASE_URL (default "/api")
                         ▼
        ┌───────────────────────────────────────────────┐
        │  DEV: Vite dev-server proxy                     │
        │       "/api/*"  ──rewrite strip /api──▶ :3000   │
        │  PROD: reverse proxy serves SPA + routes /api   │
        └───────────────────────────────────────────────┘
                         ▼
              Express API (src/app.ts) — UNCHANGED
              GET /boards · GET /boards/:id · GET /cards?board_id=
```
The **API client is the only I/O boundary** — pages depend on its typed functions, never on `fetch` or a URL. Tests inject a stubbed client, exactly mirroring how the backend injects `checkDb`/repositories into `createApp`.

---

## Options Explored

The seven questions split into **settled choices** (a genuine alternative exists but one clearly wins on the Guiding Principles — justified briefly) and **real trade-offs** (CORS-vs-proxy, API-client pattern, shared-types, directory placement — explored as full options).

### Q1 — Build tooling / dev server *(settled)*

**Chosen: Vite + `@vitejs/plugin-react`.**
- **Alternatives considered**: Create React App (deprecated, unmaintained), Next.js (SSR framework — overkill for a 2-route read-only SPA, violates simplicity-first), raw esbuild/webpack (more config burden).
- **Why Vite**: near-zero config, first-class TS/JSX, fast HMR, a built-in dev-server **proxy** (directly solves the CORS question — see Q4), native env handling via `import.meta.env.VITE_*` (directly serves the 12-factor requirement in Q3), and it shares the **Vitest** engine already used by the backend (Q6). It is the current default for a React SPA and carries the least indirection. **Technical Fit: High · Complexity: Low · Scalability: High.**

### Q2 — Client-side routing *(settled)*

**Chosen: React Router (`react-router-dom` v6+), data/`createBrowserRouter` API.**
- **Alternatives considered**: (a) hand-rolled routing via `window.location` + conditional render — avoids a dependency but re-implements param parsing, history, and a 404 route by hand (net *more* code for two routes plus a catch-all); (b) TanStack Router — powerful but heavier and less familiar. 
- **Why React Router**: it is the de-facto standard, tiny for this use, gives `useParams()` for `:id`, `useNavigate()` for click-through, and a first-class catch-all (`path: "*"`) plus a route-level not-found story that pairs with AC-ERROR-3. A hand-rolled router would be "clever indirection" the principle warns against. **Technical Fit: High · Complexity: Low · Scalability: High.**

### Q3 — API client pattern & base-URL injection *(real trade-off)*

#### Option 3A: Raw `fetch` wrapper + build-time env (CHOSEN)
- **Description**: A ~40-line `api/client.ts` exposing `getBoards()/getBoard(id)/getCards(boardId)`. Base URL read once from `import.meta.env.VITE_API_BASE_URL`. Errors normalized to a small discriminated result (`ok | http-error(status) | network-error`) so pages can render error vs. 404 states without try/catch sprawl.
- **Pros**: zero runtime dependency; trivially stubbable (the DI seam); transparent; matches backend "driver isolation" ethos; smallest bundle.
- **Cons**: no built-in caching/retry/dedupe (not needed — read-only, 3 endpoints, no revalidation requirement); manual loading/error state in each page (mitigated by a tiny shared `useAsync` hook or per-page `useState`/`useEffect`).
- **Technical Fit: High · Complexity: Low · Scalability: Medium** (add a data lib later only if writes/realtime arrive in FEAT-005).

#### Option 3B: TanStack Query (React Query)
- **Description**: Data-fetching library over a thin fetch layer; hooks manage loading/error/cache.
- **Pros**: ergonomic loading/error/retry, caching, dedupe; scales well to many endpoints and mutations.
- **Cons**: a dependency + mental model for a **read-only, 3-endpoint, no-cache-invalidation** feature — abstraction ahead of concrete need, contradicting simplicity-first. Adds bundle weight against the < 1s budget.
- **Technical Fit: Medium · Complexity: Medium · Scalability: High.**

**Base-URL injection sub-decision**: build-time `import.meta.env.VITE_API_BASE_URL` (**chosen**) vs. runtime config (`/config.js` or `window.__ENV__` injected by the server). Build-time wins because, combined with the Q4 proxy decision, the **default value is `/api` (same-origin, relative)** — the built artifact is environment-agnostic and needs no per-environment rebuild, since environment-specific routing lives in the reverse proxy (infra config), not the bundle. Runtime config is the documented escape hatch if a truly cross-origin absolute URL is ever needed without a proxy.

### Q4 — CORS vs. dev-server proxy *(real trade-off — CRITICAL)*

#### Option 4A: Vite dev-server proxy — same-origin (CHOSEN)
- **Description**: The SPA calls a same-origin, prefixed path (`/api/boards`, `/api/boards/:id`, `/api/cards?board_id=`). In dev, Vite's `server.proxy` forwards `/api/*` to the API and **strips the `/api` prefix**. The browser only ever makes same-origin requests, so **CORS never engages** and the backend is **not touched**. The `/api` prefix also resolves the verified `/boards` vs. client-route `/boards/:id` collision.
- **Exact change**: `frontend/vite.config.ts` only:
  ```ts
  // vite.config.ts (dev server section)
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  }
  ```
  No change to `src/app.ts`, no new backend dependency, no new backend test.
- **Pros**: backend 95/95 suite stays untouched; simplest possible dev setup; no CORS allowlist to maintain per environment; production mirrors it cleanly (a reverse proxy serves the static SPA and routes `/api/*` to the API — same-origin everywhere); env-agnostic build artifact.
- **Cons**: production topology must include a reverse proxy (or the API serving the built SPA as static files) so `/api` stays same-origin — a deployment convention to document, not app code. If a future consumer must call the API from a genuinely different origin (e.g., a third-party client), CORS would still be required then.
- **Technical Fit: High · Complexity: Low · Scalability: Medium.**

#### Option 4B: Add CORS middleware to the Express API
- **Description**: Install `cors`, mount it in `createApp`, allow the frontend origin from a new env var (e.g., `CORS_ALLOWED_ORIGIN`). SPA then calls the API's absolute URL cross-origin.
- **Exact change**: `src/app.ts` (`app.use(cors({ origin: env-driven allowlist }))`), a new dep in root `package.json`, a new env var threaded through `env.ts` + `docker-compose.yml`, and a new assertion in `src/app.test.ts` (per the plan) verifying the CORS header — i.e., **modifying the pure, complete app factory and its verified suite**.
- **Pros**: works for genuinely cross-origin deployments without any proxy; explicit, standard.
- **Cons**: touches the completed backend and its test suite (regression surface on a 95/95 baseline); adds a dependency + an origin allowlist to configure and keep correct in every environment (a classic 12-factor-but-fiddly footgun); still needs the client to hold an absolute base URL, reintroducing per-environment config. More moving parts for no benefit in the single-team, self-hosted, same-origin-friendly deployment model of BanyanBoard.
- **Technical Fit: Medium · Complexity: Medium · Scalability: Medium.**

**Chosen: Option 4A (dev-server proxy, same-origin).** It honors "don't add abstraction/config until a concrete need appears," keeps the completed backend and its tests untouched, and gives an env-agnostic build. CORS (4B) is documented as the deferred escape hatch for a future cross-origin consumer.

### Q5 — Shared types *(real trade-off)*

#### Option 5A: Frontend-owned wire types (CHOSEN)
- **Description**: Hand-author `frontend/src/api/types.ts` mirroring the verified contract, with **dates typed as `string`** (ISO) to match the JSON wire format, and `CardStatus = 'todo' | 'in_progress' | 'done'` duplicated. No workspace tooling.
- **Pros**: honest about the wire format (backend's `Date` fields arrive as `string` — a *shared* type would be wrong for one side); zero monorepo/workspace setup; frontend stays fully decoupled from backend build; the contract is tiny (2 interfaces + 1 union) and stable (read-only, no schema churn this iteration).
- **Cons**: two copies of the shape → drift risk if the API contract changes. Mitigated by: contract verified & frozen for this iteration; component tests assert on the exact fields; promotion path documented below.
- **Technical Fit: High · Complexity: Low.**

#### Option 5B: Shared types package/dir consumed by both
- **Description**: A `shared/` dir or `packages/shared-types` workspace exporting `Board`/`Card`, imported by backend and frontend.
- **Pros**: single source of truth; `techContext.md` explicitly recommends this to keep FE/BE in sync.
- **Cons**: the **Date-vs-string mismatch makes a single literal type inaccurate for at least one side** — you'd need generic/branded date handling or a mapping layer, i.e., abstraction ahead of need. Requires converting the root into a workspace (pnpm/npm workspaces), touching the completed backend's `tsconfig`/build and CommonJS setup — real churn against a 95/95 baseline. Overkill for 2 tiny types.
- **Technical Fit: Medium · Complexity: Medium-High.**

**Chosen: Option 5A**, with a **documented deviation** from the `techContext.md` "shared types recommended" guidance. Trade-off rationale: the recommendation is sound in principle but its literal application is defeated by the wire-format mismatch and would force monorepo restructuring of a completed backend — a clear case where simplicity-first overrides. **Promotion path**: if/when the frontend gains writes (FEAT-005+) or the contract starts changing, introduce a shared `contract/` package with explicit wire-DTO types (dates as strings) and a backend serializer, then have both import it.

### Q6 — Folder structure & test framework *(settled)*

**Chosen: Vitest + React Testing Library + jsdom** (mirrors backend Vitest; RTL is the standard, accessibility-first component-test library; matches the Test Strategy in TASK-004). **Alternative** Jest was rejected to avoid a second test engine in the repo and extra transform config; Vitest reuses the Vite pipeline and config.

Directory layout (see Implementation Guidelines for the annotated tree). Tests are **co-located** (`Foo.tsx` + `Foo.test.tsx`), mirroring the backend's `src/**/*.test.ts` convention. **Technical Fit: High · Complexity: Low.**

### Q7 — Directory placement in the repo *(real trade-off)*

#### Option 7A: `frontend/` at repo root, standalone package (CHOSEN)
- **Description**: New top-level `frontend/` beside the backend's root `src/`, with its own `package.json` (`"type": "module"` for Vite/ESM), own `tsconfig.json`, own `node_modules`. Backend files stay exactly where they are.
- **Pros**: zero disruption to the completed backend, its root `package.json` (`type: commonjs`), `tsconfig`, Docker build, and 95/95 tests; clean separation of the ESM frontend from the CommonJS backend; obvious mental model.
- **Cons**: backend still sits at root `src/` rather than a symmetric `apps/api` — cosmetically asymmetric; no shared dependency hoisting (fine at this scale).
- **Technical Fit: High · Complexity: Low.**

#### Option 7B: Restructure into `apps/api` + `apps/web` workspaces
- **Description**: Move the backend into `apps/api`, frontend into `apps/web`, adopt npm/pnpm workspaces.
- **Pros**: symmetric, "proper" monorepo; enables a shared package cleanly (pairs with 5B).
- **Cons**: **moves the entire completed backend** — updates `package.json` main/scripts, `tsconfig` `rootDir/outDir`, `docker-compose.yml` build context/Dockerfile paths, and risks the 95/95 suite — pure scope creep for a read-only FE feature. Violates simplicity-first ("don't restructure without concrete need").
- **Technical Fit: Medium · Complexity: High.**

**Chosen: Option 7A.** Document that Option 7B (full `apps/*` workspace) is a viable future evolution if a shared contract package or a third deployable appears — not now.

---

## Evaluation Matrix

Scored for the decisions where a real alternative competed. Scale: High / Med / Low (higher = better fit for *this* project).

| Criteria | Q3A fetch (chosen) | Q3B React Query | Q4A proxy (chosen) | Q4B CORS | Q5A FE types (chosen) | Q5B shared pkg | Q7A `frontend/` (chosen) | Q7B `apps/*` |
|----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Simplicity-first fit | High | Med | High | Med | High | Low | High | Low |
| Maintainability | Med | High | High | Med | Med | High | High | Med |
| Performance (bundle/<1s) | High | Med | High | High | High | High | High | High |
| Backend-regression safety | High | High | High | Low | High | Med | High | Low |
| 12-factor cleanliness | High | High | High | Med | High | High | High | High |
| Observability | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| Implementation cost | Low | Med | Low | Med | Low | High | Low | High |

---

## Observability Architecture

**Applies: No** — consistent with the TASK-004 plan's Observability Requirements ("Applies: No"). This feature is browser-side React rendering consuming existing, already-instrumented endpoints. It introduces **no new server HTTP handlers, workers, or multi-service calls**. The chosen CORS-vs-proxy decision (Option 4A) adds **no backend code at all** (config-only in `vite.config.ts`), so there is no new traced operation, log site, or metric.

- **Logging**: no `console.log` in shipped frontend code (aligns with the project's blocking-violation rule); the API client surfaces errors to the UI as explicit error states rather than console noise. A dev-only diagnostic behind `import.meta.env.DEV` is acceptable.
- **Tracing**: the existing backend retains the project's OpenTelemetry / W3C Trace Context story on `GET /boards`, `GET /boards/:id`, `GET /cards`. The proxy forwards requests transparently and does not break trace propagation.
- **Metrics**: backend `http_requests_total` / `http_request_duration_seconds` continue to cover these endpoints.
- **Future revisit**: if a later feature adds frontend RUM/telemetry (e.g., web-vitals or OTEL browser SDK exporting to `OTEL_EXPORTER_OTLP_ENDPOINT`), introduce it then behind env config — out of scope here.

---

## Decision

**Chosen stack:**

| Question | Decision |
|----------|----------|
| **Q1 Build tooling** | **Vite** + `@vitejs/plugin-react` (dev server, HMR, prod build, env, proxy) |
| **Q2 Routing** | **React Router** (`react-router-dom` v6+), `createBrowserRouter`; routes `/`, `/boards/:id`, catch-all `*` |
| **Q3 API client** | **Raw `fetch` wrapper** in `src/api/client.ts` (no data lib); base URL from **build-time** `import.meta.env.VITE_API_BASE_URL` (default `/api`) |
| **Q4 CORS vs proxy** | **Vite dev-server proxy, same-origin** — `/api/*` proxied to the API with prefix stripped. **Backend `src/app.ts` untouched; no `cors` dependency.** |
| **Q5 Shared types** | **Frontend-owned wire types** in `src/api/types.ts` (dates as `string`); documented deviation from the shared-package recommendation |
| **Q6 Folder + tests** | **Vitest + React Testing Library + jsdom**; co-located `*.test.tsx`; layout below |
| **Q7 Directory** | **`frontend/` at repo root**, standalone `package.json` (`"type": "module"`); backend stays at root `src/` |

### Rationale
Every choice minimizes indirection and protects the completed backend. Vite + React Router + a hand-written fetch client is the smallest stack that satisfies all 11 ACs and the < 1s load budget. The proxy decision is the linchpin: it simultaneously (a) resolves the CORS gap with **zero backend change**, (b) sidesteps the verified `/boards` route/path collision via the `/api` prefix, and (c) yields an **environment-agnostic build artifact** because the client's default base is same-origin `/api` and per-environment routing lives in infra (reverse proxy), fulfilling 12-factor without baking hosts into the bundle. Frontend-owned wire types and a root-level `frontend/` dir both avoid restructuring a done, tested backend.

### Trade-offs Accepted
- **No data-fetching library** → manual loading/error state per page. Acceptable: 3 read-only endpoints, no cache-invalidation need; a small shared `useAsync` hook keeps it DRY. Revisit at FEAT-005 (realtime/writes).
- **Duplicated types (FE vs BE)** → drift risk. Acceptable: contract is tiny, frozen this iteration, test-asserted; promotion path to a shared contract package documented.
- **Proxy requires a same-origin production topology** (reverse proxy or API-served static) → a documented deployment convention, not app code. Acceptable and simpler than a per-environment CORS allowlist. CORS remains the documented escape hatch for a future cross-origin consumer.
- **Asymmetric repo layout** (`frontend/` + root `src/`) → cosmetic; avoids a risky backend move.

---

## Implementation Guidelines

1. **Scaffold `frontend/` at repo root** with its own `package.json` (`"type": "module"`), `tsconfig.json`, `index.html`. Do not modify the root backend `package.json`/`tsconfig.json`.

2. **Directory layout** (co-located tests, single I/O seam):
   ```
   frontend/
     package.json              # "type": "module"; scripts: dev/build/test/lint
     tsconfig.json             # jsx: react-jsx, module/moduleResolution: bundler, strict
     vite.config.ts            # react plugin + Vitest config + server.proxy (Q4A)
     index.html
     .env.example              # VITE_API_BASE_URL=/api  ·  VITE_API_PROXY_TARGET=http://localhost:3000
     src/
       main.tsx                # createRoot + RouterProvider
       App.tsx                 # createBrowserRouter route table (/, /boards/:id, *)
       api/
         types.ts              # Board, Card, CardStatus  (dates as string)
         client.ts             # getBoards/getBoard/getCards; ONLY module that calls fetch
         client.test.ts        # AC-HAPPY-1: base URL from env; correct request paths
       pages/
         BoardListPage.tsx  +  BoardListPage.test.tsx
         BoardViewPage.tsx  +  BoardViewPage.test.tsx   # includes journey test
       components/
         Column.tsx
         Card.tsx
         states/ { LoadingState, EmptyState, ErrorState (w/ retry), NotFoundState }.tsx
       test/
         setup.ts              # import '@testing-library/jest-dom'
   ```

3. **Dependencies**: `react`, `react-dom`, `react-router-dom`. **Dev**: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@types/react`, `@types/react-dom`.

4. **`src/api/types.ts` (verified contract, wire-accurate):**
   ```ts
   export type CardStatus = 'todo' | 'in_progress' | 'done';
   export interface Board {
     id: number; name: string; description: string | null;
     created_at: string; updated_at: string;        // ISO strings on the wire
   }
   export interface Card {
     id: number; board_id: number; title: string; description: string | null;
     status: CardStatus; due_date: string | null;    // no `labels` field
     created_at: string; updated_at: string;
   }
   ```

5. **`src/api/client.ts`**: read `const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'` once. Implement `getBoards()` → `GET ${BASE}/boards`, `getBoard(id)` → `GET ${BASE}/boards/${id}`, `getCards(boardId)` → `GET ${BASE}/cards?board_id=${boardId}`. Return a small discriminated result so pages can distinguish **network error** (AC-ERROR-1/2), **404** (AC-ERROR-3, for `getBoard`), and **success**. Never hardcode host/port.

6. **`vite.config.ts` proxy** (the entire CORS resolution — dev only): proxy `/api` → `process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000'`, `changeOrigin: true`, `rewrite: p => p.replace(/^\/api/, '')`. **Do not touch `src/app.ts` or `src/app.test.ts`.**

7. **Vitest config** inside `vite.config.ts`: `test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' }`. Component tests render a page/route and **inject a stubbed API client** (module mock or prop/context injection) — never hit a live backend, mirroring the backend stub pattern.

8. **Routing**: `createBrowserRouter([{ path: '/', element: <BoardListPage/> }, { path: '/boards/:id', element: <BoardViewPage/> }, { path: '*', element: <NotFoundState/> }])`. Use `useParams`/`useNavigate`. The board-view 404 (AC-ERROR-3) is data-driven (from a 404 API result), distinct from the route catch-all.

9. **Document the start command** in `techContext.md` (replace `[TBD]`s) and a `frontend/README`: `npm install`, `npm run dev` (Vite dev server + proxy), `npm run build` (`tsc -b && vite build`), `npm run test` (`vitest run`). Update `techContext.md` Component Structure: frontend path `frontend/`, test dir co-located, framework Vitest + RTL.

10. **Env**: commit `frontend/.env.example`; never commit a real `.env`. Keep `VITE_API_BASE_URL` defaulting to `/api` so the built artifact is environment-agnostic.

11. **Accessibility hook-in** (details owned by the UI/UX creative): use semantic landmarks/roles so RTL role-based queries double as a11y assertions; ensure status/column is not color-only; visible focus on the clickable board items and retry buttons.

---

## Validation Checklist

- [x] Meets all system requirements (2 routes, 3 GETs, loading/empty/error/404, env-driven base URL, read-only)
- [x] Respects technical constraints (backend untouched; route/path collision solved via `/api` prefix; wire dates typed as `string`; no `labels`)
- [x] Addresses NFRs (small bundle for < 1s; a11y-friendly routing/testing; responsive-ready; no i18n framework)
- [x] Technically feasible with current tooling (Vite/React Router/Vitest are mature; proxy is built-in)
- [x] Risks identified and acceptable (see Risk Assessment)
- [x] Complies with Guiding Principles — **one documented deviation**: Q5 declines the `techContext.md` shared-types recommendation, with trade-off rationale (wire mismatch + backend-restructure cost) and a promotion path
- [x] Respects established patterns (single I/O seam ↔ driver isolation; stub-injected tests ↔ DI testability; Vitest reuse; 12-factor env)
- [x] Observability architecture defined — **N/A with justification** (matches plan; no new server operation)
- [x] Trace context propagation across service boundaries — unaffected (proxy is transparent; backend retains OTEL)
- [x] Logging strategy consistent with observability-requirements.md — no `console.log` in shipped FE code; errors surface as UI states
- [x] Metrics strategy follows naming conventions — backend endpoints already covered; no new FE metrics this iteration

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:---:|:---:|------------|
| Type drift between FE wire types and API contract | Low | Med | Contract frozen this iteration; component tests assert exact fields; documented promotion to a shared contract package if writes/realtime land |
| Production topology not same-origin (proxy assumption broken) | Med | Med | Document the reverse-proxy / API-served-static convention; CORS (Option 4B) is the ready escape hatch (set `VITE_API_BASE_URL` absolute + add `cors`) |
| `/api` prefix mis-wired → 404s or route collision resurfaces | Low | High | Proxy `rewrite` strips `/api`; client tests assert exact request paths; smoke-test one live call in Phase 1 |
| Greenfield tooling churn / config sprawl | Low | Med | Lock this doc's choices before Phase 1; Vite's zero-config default keeps surface minimal |
| Bundle bloat breaks < 1s budget | Low | Low | No data-fetching lib; only React + Router; measure `vite build` output in Phase 1 |
| Accidentally modifying the completed backend | Low | High | Q4A/Q7A explicitly keep `src/**` untouched; if any backend edit is proposed, treat as out-of-scope and reassess |

## Next Steps

1. **Phase 1** — Scaffold `frontend/` (Vite + React + TS), add deps, write `api/types.ts` + `api/client.ts`, configure the `/api` proxy in `vite.config.ts`, set up Vitest + RTL, add `.env.example`, and document the start command in `techContext.md`/README. Delivers **AC-HAPPY-1**. Backend stays untouched.
2. **Phase 2** — React Router setup + `BoardListPage` (fetch/render/navigate/empty/error/loading). Delivers AC-ENTRY-1, AC-HAPPY-2/3/5, AC-ERROR-1, AC-ASYNC-1.
3. **Phase 3** — `BoardViewPage` + `Column`/`Card` (status grouping into 3 columns, column empty state, board/cards error+retry, distinct 404, loading, journey test). Delivers AC-HAPPY-4/6, AC-ERROR-2/3, AC-ASYNC-1.
4. Proceed to the **UI/UX Design creative** for visual layout, state presentation, and WCAG 2.1 AA treatment (this doc leaves visual/a11y specifics to that agent, providing only structural hooks).
