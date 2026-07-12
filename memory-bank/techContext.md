# Technology Context

This file documents the technology stack, infrastructure, and tooling used in this project.

## Component Structure

### Components/Modules

```
Component Name: Web Frontend
- Path: [TBD, e.g. frontend/ or apps/web]
- Language: TypeScript (React)
- Test Directory: [TBD]
- Test Framework: [TBD, e.g. Vitest + React Testing Library]

Component Name: API Backend
- Path: [TBD, e.g. backend/ or apps/api]
- Language: TypeScript (Node.js, Express)
- Test Directory: [TBD]
- Test Framework: [TBD, e.g. Jest or Vitest + Supertest]

Component Name: Database
- Path: [TBD — migrations/schema location]
- Language: PostgreSQL (SQL)
- Test Directory: N/A
- Test Framework: N/A
```

> Exact directory layout is not yet established. Update these paths once the
> repository structure is scaffolded (first build task).

### Shared/Common Code

- Location: [TBD — e.g. shared types package for API/UI contract]
- Purpose: Shared TypeScript types for the board/column/card domain (recommended to keep frontend and backend in sync)

## Development Commands

### Local Environment (Docker Compose)

```bash
# Bring up the full stack (frontend + backend + PostgreSQL)
docker compose up

# Tear down
docker compose down
```

### Linting

```bash
# TBD — e.g. npm run lint (per component)
```

### Type Checking

```bash
# TBD — e.g. tsc --noEmit (per component)
```

### Building

```bash
# TBD — e.g. npm run build (per component)
```

### Testing

```bash
# TBD — e.g. npm test (per component)
```

> Concrete lint/type-check/build/test commands will be filled in as the toolchain
> is established during the first build task.

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

- Build tool: [TBD — e.g. Vite for frontend]
- Testing frameworks: [TBD]
- Code quality: [TBD — e.g. ESLint + Prettier]

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
