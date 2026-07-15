# Phase Archive: TASK-004 Phase 1 — Frontend Scaffold, Tooling & API Client

**Task**: TASK-004 — React Frontend (Level 3, FEAT-004)
**Phase**: 1 of 3 — Frontend scaffold, tooling & API client (foundation)
**Status**: ✅ PHASE COMPLETE (task continues — Phases 2-3 remaining)
**Date**: 2026-07-13
**Branch**: `feature/FEAT-004-react-frontend`
**Commits**: `ec25052` (plan + creative baseline), `cea0d5f` (Phase 1 implementation, 19 files)

> This is a **phase archive** (Mode A): Phase 1 is complete and captured for reference, but
> TASK-004 is NOT closed. No merge to main and no PR — that happens at the final Task Archive
> after all three phases and reflection are done.

---

## Phase Goals

Deliver the greenfield foundation for a read-only React SPA consuming the existing (complete,
95/95) Board + Card REST API, resolving all seven architectural questions from the creative
phase into working scaffold. Scope: bundler/dev-server, TypeScript + test framework, the typed
API client (the single I/O seam), the CORS resolution, and a documented start command.

**Delivers**: AC-HAPPY-1 (app builds and runs via a documented command, API base URL sourced
from the environment per 12-factor).

---

## What Was Built

Standalone `frontend/` package at repo root (`"type": "module"`); the completed backend at root
`src/` was **not touched** (protecting its 95/95 suite).

| Area | Delivery |
|------|----------|
| Build/dev tool | **Vite 6** + `@vitejs/plugin-react` (HMR dev server, prod build, env injection, dev proxy) |
| Language/config | **TypeScript strict** (`tsconfig.json`: `moduleResolution: bundler`, `jsx: react-jsx`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`) |
| Test framework | **Vitest 3 + React Testing Library + jsdom**, co-located `*.test.ts[x]`; `src/test/setup.ts` imports jest-dom |
| API client (`src/api/client.ts`) | The **only** module that calls `fetch`: `getBoards()` / `getBoard(id)` / `getCards(boardId)`; base URL read per-call from `import.meta.env.VITE_API_BASE_URL` (default same-origin `/api`); discriminated `ApiResult<T>` = `ok` / `http` (with status, incl. 404) / `network`; ids `encodeURIComponent`-escaped; JSON-parse-on-2xx failures reclassified as `network` |
| Wire types (`src/api/types.ts`) | `Board` / `Card` / `CardStatus`; timestamps typed as `string` (ISO wire format, not `Date`); **no `labels`** field |
| CORS resolution | **Vite dev-server proxy** (`vite.config.ts`): `/api/*` → `VITE_API_PROXY_TARGET` (default `http://localhost:3000`), `/api` prefix stripped. Same-origin in the browser → CORS never engages, backend untouched; also sidesteps the `/boards` API-vs-route collision |
| App shell | `main.tsx` (createRoot + StrictMode), `App.tsx` placeholder, `index.css` minimal base; routing + pages deferred to Phases 2-3 |
| Docs | `frontend/README.md` (setup, commands, env template, CORS rationale, layout); `techContext.md` frontend `[TBD]`s filled (paths, Vite/Vitest, commands, shared-types decision) |

### Files created
```
frontend/package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html, .gitignore, README.md
frontend/src/main.tsx, App.tsx, index.css, vite-env.d.ts
frontend/src/api/types.ts, client.ts, client.test.ts
frontend/src/test/setup.ts
```
Plus: `memory-bank/agent-rules-index.md` (generated), `techContext.md` (updated).

---

## Tests

**8/8 passing** in `src/api/client.test.ts` (fetch stubbed — no live backend, mirroring the backend's stub pattern):
- Base URL from `VITE_API_BASE_URL` (×2: custom value + `/api` default) — AC-HAPPY-1
- Request shaping: `GET /boards/:id`, `GET /cards?board_id=` (×2)
- Result normalization (×4): 200→`ok`+data; 404→`http` status 404 (AC-ERROR-3 support); 500→`http`; thrown fetch→`network`

---

## Verification

| Check | Result |
|-------|--------|
| Vitest | 8/8 PASS |
| Type-check (`tsc --noEmit`) | Clean |
| Build (`vite build`) | PASS — bundle 143.86 kB / **46.23 kB gzip** (well within the <1s load budget) |
| Dev server boot | PASS — "VITE v6.4.3 ready in 312 ms" @ `http://localhost:5173/` |
| `npm audit` | **0 vulnerabilities** |
| Code review (ecc:typescript-reviewer) | APPROVE — 2 non-blocking fixes applied |

---

## Lessons Learned

1. **Vitest/Vite version alignment is a build-blocker, not just a warning.** Vitest 2.1.9 nested its own `vite@5` while `@vitejs/plugin-react` pulled `vite@6`; the two `Plugin` types are structurally distinct, so `tsc` failed on `defineConfig({ plugins: [react()] })`. Bumping Vitest 2→3 deduped everything onto `vite@6` — and, as a bonus, cleared 5 npm advisories (3 moderate/1 high/1 critical) that lived in the nested `vite@5`/esbuild chain. **Takeaway**: for a Vite+Vitest project, pin Vitest to a major that shares the same Vite major as the app, and check `npm ls vite` shows a single deduped version before trusting the build.

2. **A dev-server proxy beats CORS middleware when you control both origins.** Resolving the CORS gap with a Vite proxy (config-only) kept the completed backend and its 95/95 suite untouched, avoided a per-environment origin allowlist, and yielded an environment-agnostic build artifact (default base `/api`). The `/api` prefix also incidentally solved the `/boards` API-path vs. `/boards/:id` client-route collision — one decision, three wins.

3. **Read per-call, not at module load, for testable 12-factor config.** Reading `import.meta.env.VITE_API_BASE_URL` inside the request helper (not a top-level `const`) let `vi.stubEnv` drive the base-URL tests deterministically. A module-load read would have frozen the value before the stub applied.

4. **The DI/stub testing principle transfers cleanly backend→frontend.** The one learned rule that carried over (Testing Patterns) maps the backend's "inject I/O, stub in tests" directly onto "the API client is the single injectable seam; stub it, never hit a live backend." No new pattern needed.

---

## Deviations & Follow-Ups

- **Deviation (env example)**: no committed `frontend/.env.example` — the repo tooling guards `.env*`
  paths. The env template lives in `frontend/README.md` instead. Both `VITE_API_BASE_URL` and
  `VITE_API_PROXY_TARGET` have safe defaults, so the app runs with no `.env` in the standard setup.
- **Deviation (documented in creative)**: frontend-owned wire types instead of a shared types
  package (wire `Date`→`string` mismatch + backend-restructure cost). Promotion path recorded in
  `techContext.md` and the Architecture creative (Q5).
- **Open follow-up**: human live-verify `cd frontend && npm run dev` + a real `/api/boards`
  round-trip against the running API (dev proxy → `localhost:3000`).
- **Not pushed**: Phase 1 is committed locally on the feature branch only; remote push/merge is
  deferred to the final Task Archive per the project's branch-flow convention.

---

## Next

`/banyan-build TASK-004` → **Phase 2: Board list page (`/`)** — React Router setup + `BoardListPage`
with fetch/render/navigate/empty/error/loading, per the A1 (semantic link list) UI/UX decision.
