# Product Roadmap

## Summary

- **Total Features**: 5
- **Released Versions**: 0
- **Active Version**: none
- **Planning Backlog**: next (5 features)

## Versions

### next (Planning)

- **Status**: planning
- **Description**: Backlog of features not yet assigned to a committed version
- **Features**:
  - FEAT-001: Project Foundation (complete) [Level 2]
  - FEAT-002: Board CRUD API (planned) [Level 3]
  - FEAT-003: Card CRUD API (complete) [Level 3]
  - FEAT-004: React Frontend (planned) [Level 3]
  - FEAT-005: Realtime Activity Feed (planned) [Level 4]

## Features

### FEAT-001: Project Foundation

- **Version**: next
- **Status**: complete
- **Priority**: high
- **Complexity**: Level 2
- **Description**: Establish the project foundation for BanyanBoard — a TypeScript/Express REST API skeleton, Docker Compose orchestration for a PostgreSQL database, a `/health` check endpoint with automated tests, and a basic clean-architecture project structure (favoring simplicity over clever abstractions). This foundation is the prerequisite for all subsequent board/column/card features.
- **Acceptance Criteria**:
  - Express API runs in TypeScript with a documented start command
  - `docker compose up` brings up the API and a PostgreSQL database
  - `GET /health` returns a healthy status (and reports DB connectivity)
  - Health endpoint is covered by passing automated tests
  - Project directory structure is in place (clean-architecture separation, kept shallow)
- **Linked Tasks**: TASK-001 (complete)
- **Branch**: feature/FEAT-001-project-foundation
- **Created**: 2026-07-10

### FEAT-002: Board CRUD API

- **Version**: next
- **Status**: planned
- **Priority**: high
- **Complexity**: Level 3
- **Description**: Introduce the Board domain model with full CRUD REST endpoints (GET all, GET by id, POST, PATCH, DELETE) and comprehensive tests. Includes the boards table/schema, a repository/data-access layer over the existing `pg` pool, input validation, and 404/error handling. Prerequisite for all board-scoped features (columns, cards).
- **Dependencies**: FEAT-001 (Project Foundation — DB pool + app factory)
- **Linked Tasks**: TASK-002 (planning)
- **Branch**: feature/FEAT-002-board-crud
- **Created**: 2026-07-10

### FEAT-003: Card CRUD API

- **Version**: next
- **Status**: complete
- **Priority**: high
- **Complexity**: Level 3
- **Description**: Add the Card domain model with full CRUD REST endpoints, a foreign key to Board (`board_id` → `boards.id`), and input validation. Includes the cards table/schema with the FK constraint and delete behavior (cascade/restrict — to be decided in creative), repository layer, validation, and comprehensive tests.
- **Dependencies**: FEAT-002 (Board CRUD API — Card FK references boards.id); FEAT-001 (foundation). Board CRUD code is present in the codebase (`src/boards/`, `db/init/001_boards.sql`), so the dependency is satisfied in practice.
- **Linked Tasks**: TASK-003 (complete)
- **Branch**: feature/FEAT-003-card-crud (merged to main)
- **Created**: 2026-07-10
- **Completed**: 2026-07-13 — Card CRUD API delivered (`ON DELETE CASCADE` FK, `?board_id=` filter, status enum, app-level FK check); 95/95 tests. Archive: `memory-bank/archive/archive-TASK-003.md`

### FEAT-004: React Frontend

- **Version**: next
- **Status**: planned
- **Priority**: high
- **Complexity**: Level 3
- **Description**: Introduce a React single-page frontend for BanyanBoard consuming the existing REST API. Delivers two views: (1) a **board list page** showing all boards with the ability to open one, and (2) a **board view** rendering the selected board's cards grouped into three fixed columns — To Do / In Progress / Done. Includes frontend tech-stack and build-tooling setup (bundler, routing, API client), UI/UX layout for the board/column presentation, loading/empty/error states, and component structure. Read-oriented in this iteration (card drag-and-drop and card creation from the UI are out of scope unless a later feature adds them).
- **Acceptance Criteria**:
  - A React app builds and runs with a documented start command, configured against the API base URL via environment (12-factor)
  - Board list page fetches and displays all boards; selecting a board navigates to its board view
  - Board view renders the board's cards in three columns (To Do / In Progress / Done) based on card status
  - Loading, empty, and error states are handled for both views
  - Frontend is covered by automated component/UI tests
- **Dependencies**: FEAT-002 (Board CRUD API — board list + board fetch); FEAT-003 (Card CRUD API — cards to populate columns, including a status field for column grouping). **Depends on both API features being available.**
- **Linked Tasks**: TASK-004 (planning)
- **Branch**: feature/FEAT-004-react-frontend
- **Created**: 2026-07-12

### FEAT-005: Realtime Activity Feed

- **Version**: next
- **Status**: planned
- **Priority**: medium
- **Complexity**: Level 4
- **Description**: Track and display a realtime activity feed of card movements between columns. Captures a card-movement event whenever a card's `status` changes (To Do ↔ In Progress ↔ Done — the `PATCH /cards/:id { status }` path from FEAT-003), persists it as an activity/event record, and pushes it live to connected clients so the frontend can render a continuously-updating feed without polling. Introduces the project's first realtime push transport (WebSocket or SSE) — a new server capability with connection-lifecycle management, event fan-out to subscribers, and reconnection/backfill semantics — plus an activity persistence model and a frontend live-feed UI. Expected to be phased (event capture + store → push transport → frontend feed) with multiple creative phases (transport architecture, event/activity model, feed UX).
- **Dependencies**: FEAT-003 (Card CRUD API — card `status` changes are the events being tracked); FEAT-004 (React Frontend — the surface that renders the live feed). FEAT-001 (foundation — Express app factory, `pg` pool, logger).
- **Linked Tasks**: None
- **Branch**: feature/FEAT-005-realtime-activity-feed
- **Created**: 2026-07-13
