# Technology Context

This file documents the technology stack, infrastructure, and tooling used in this project.

## Component Structure

### Components/Modules

```
Component Name: Web Frontend
- Path: frontend/ (standalone package at repo root, "type": "module"; Vite + React SPA)
- Language: TypeScript (React 18)
- Build tool: Vite 6 (+ @vitejs/plugin-react); dev-server proxies /api → the API (CORS-free, backend untouched)
- Test Directory: co-located (src/**/*.test.ts[x]), e.g. src/api/client.test.ts
- Test Framework: Vitest 3 + React Testing Library + jsdom

Component Name: API Backend
- Path: src/ (at repo root; root package.json "type": "commonjs")
- Language: TypeScript (Node.js, Express)
- Test Directory: co-located (src/**/*.test.ts)
- Test Framework: Vitest + Supertest

Component Name: Database
- Path: db/init/ (numbered SQL init scripts run in order on first container start: 001_boards.sql, 002_cards.sql, 003_card_activity.sql)
- Language: PostgreSQL (SQL)
- Test Directory: N/A (repositories are unit-tested over a mocked pg pool; route tests use in-memory stubs — no live DB)
- Test Framework: N/A

Backend modules under src/: config/ (env, logger), db/ (pg pool), health/, boards/, cards/, activity/ (TASK-005 — activity.types/repository/emitter: card-movement capture + in-process fan-out seam).
```

> Exact directory layout is not yet established. Update these paths once the
> repository structure is scaffolded (first build task).

### Shared/Common Code

- Location: None (deliberate). Frontend owns its wire types in `frontend/src/api/types.ts`; backend owns its domain types in `src/**`.
- Purpose: A shared package was evaluated and declined for TASK-004 (Architecture creative Q5): the wire format serializes `Date` fields to `string`, so a single shared literal type would be inaccurate for one side, and a shared package would force a monorepo restructure of the completed backend. Promotion path: introduce a `contract/` package with explicit wire-DTO types if/when the frontend gains writes (FEAT-005+) or the contract starts changing.

## Development Commands

### Local Environment (Docker Compose)

```bash
# Bring up the full stack (frontend + backend + PostgreSQL)
docker compose up

# Tear down
docker compose down
```

### Frontend (frontend/)

```bash
cd frontend
npm install            # first-time setup
npm run dev            # Vite dev server (HMR) at http://localhost:5173, proxies /api → the API
npm run build          # tsc --noEmit (type-check) then vite build → dist/
npm run preview        # serve the production build
npm run test           # Vitest run (component/unit tests)
npm run typecheck      # tsc --noEmit only
```

Config: API base URL from `VITE_API_BASE_URL` (default `/api`); dev proxy target from
`VITE_API_PROXY_TARGET` (default `http://localhost:3000`). See `frontend/README.md`
(the `.env.example` template lives there — the repo tooling guards `.env*` paths).

### Backend (repo root)

```bash
npm test               # Vitest + Supertest (95/95 passing)
npm run build          # tsc (strict)
```

### Linting

No dedicated linter is configured (frontend or backend). Static checking is via
`tsc --noEmit` (strict), run standalone (`npm run typecheck`) and as the first
step of the frontend `build`.

## Technology Stack

### Runtime Environment

- Node.js — CommonJS at repo root today (`"type": "commonjs"`); backend/frontend packages TBD
- Docker + Docker Compose — local orchestration of frontend, backend, and database

### Languages & Frameworks

- **TypeScript** — primary language for both frontend and backend
- **React** — web frontend (SPA)
- **Express** — backend REST API (TypeScript)

### Data Layer

- **PostgreSQL** — primary relational database (boards, columns, cards, labels, users)
- Query layer: **`pg`** (node-postgres) — raw SQL via a connection pool (`src/db/pool.ts`), chosen for simplicity at the foundation stage; an ORM can be layered on later if needed

### API & Communication

- **REST** over HTTP — Express API consumed by the React frontend
- API schema/contract location: [TBD]

### Infrastructure & Deployment

- **Docker Compose** — local development and self-hosted deployment
- CI/CD: [TBD]

### Development Tools

- Build tool: Vite 6 (frontend); tsc (backend)
- Testing frameworks: Vitest 3 + React Testing Library + jsdom (frontend); Vitest + Supertest (backend)
- Code quality: TypeScript strict mode (`tsc --noEmit`) both sides; no ESLint/Prettier configured yet

### External Services

- None at MVP — the core loop requires no third-party APIs

## Architectural Guidance

- **Clean architecture, simplicity-first**: separate concerns (domain / application / infrastructure / delivery) but keep abstractions shallow. Add layers only when a concrete need appears — favor readable, direct code over clever indirection.

<!-- AUTO-MANAGED: c4-references-start -->
## C4 References

<!--
  This section is auto-managed by /banyan-c4. Run /banyan-c4 to populate or refresh.
-->

C4 architecture documentation has not been generated for this project yet.

<!-- AUTO-MANAGED: c4-references-end -->

---

## Notes

- Keep this file updated during the BUILD phase when new technologies are introduced
- Document the "why" behind technology choices, not just the "what"
- Update Component Structure section (paths) once the repo is scaffolded
- Replace all [TBD] placeholders as the toolchain solidifies
