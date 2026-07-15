# Product Roadmap

## Summary

- **Total Features**: 6
- **Released Versions**: 0
- **Active Version**: none
- **Planning Backlog**: next (6 features)

## Versions

### next (Planning)

- **Status**: planning
- **Description**: Backlog of features not yet assigned to a committed version
- **Features**:
  - FEAT-001: Project Foundation (complete) [Level 2]
  - FEAT-002: Board CRUD API (planned) [Level 3]
  - FEAT-003: Card CRUD API (complete) [Level 3]
  - FEAT-004: React Frontend (complete) [Level 3]
  - FEAT-005: Realtime Activity Feed (complete) [Level 4]
  - FEAT-006: Card Workflow Automation (planned) [Level 3]

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
- **Status**: complete
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
- **Linked Tasks**: TASK-004 (complete)
- **Branch**: feature/FEAT-004-react-frontend (merged to main)
- **Created**: 2026-07-12
- **Completed**: 2026-07-14 — Read-only React SPA delivered (Vite + React Router + fetch client, dev-proxy for CORS, WCAG 2.1 AA component set); all 11 ACs, 20/20 tests, 0 vulns. Archive: `memory-bank/archive/archive-TASK-004.md`. Follow-up: `/banyan-uat TASK-004` (a11y browser walk) not yet run.

### FEAT-005: Realtime Activity Feed

- **Version**: next
- **Status**: complete
- **Priority**: medium
- **Complexity**: Level 4
- **Description**: Track and display a realtime activity feed of card movements between columns. Captures a card-movement event whenever a card's `status` changes (To Do ↔ In Progress ↔ Done — the `PATCH /cards/:id { status }` path from FEAT-003), persists it as an activity/event record, and pushes it live to connected clients so the frontend can render a continuously-updating feed without polling. Introduces the project's first realtime push transport (WebSocket or SSE) — a new server capability with connection-lifecycle management, event fan-out to subscribers, and reconnection/backfill semantics — plus an activity persistence model and a frontend live-feed UI. Expected to be phased (event capture + store → push transport → frontend feed) with multiple creative phases (transport architecture, event/activity model, feed UX).
- **Dependencies**: FEAT-003 (Card CRUD API — card `status` changes are the events being tracked); FEAT-004 (React Frontend — the surface that renders the live feed). FEAT-001 (foundation — Express app factory, `pg` pool, logger).
- **Linked Tasks**: TASK-005 (complete)
- **Branch**: feature/FEAT-005-realtime-activity-feed (merged to main)
- **Created**: 2026-07-13
- **Completed**: 2026-07-15 — Realtime Activity Feed delivered (SSE push transport, `card_activity` capture on the `PATCH /cards/:id` path, per-board in-process fan-out, accessible live side-panel feed); all 10 ACs + AC-NAV-1, 118/118 backend + 35/35 frontend tests, UAT PASS_WITH_RECOMMENDATIONS (0 Required). Archive: `memory-bank/archive/archive-TASK-005.md`. Deferred follow-ups: Phase 4 E2E impl (spec ready), REC-1 migration path, REC-2 mobile verification + announcer sentinel.

### FEAT-006: Card Workflow Automation

- **Version**: next
- **Status**: planned
- **Priority**: medium
- **Complexity**: Level 3
- **Description**: Introduce **rule-based workflow automation** for cards. A board owner defines automation rules that automatically move a card to a different status/column when a condition is satisfied (e.g., a card's due date passes, or a field changes). A rules engine evaluates persisted `condition → action` rules against card lifecycle events and applies auto-moves through the existing card status-change path — reusing the FEAT-005 activity-capture hook so automated moves surface in the realtime activity feed (distinguishable from manual moves). Scope for this feature is the **rule-based auto-move** capability: rule persistence model, condition/action schema, an evaluation engine with cycle/loop prevention, and rule-management REST endpoints. Trigger→action macros, SLA/time-based automations, and a rule-builder UI are out of scope for this iteration unless a later feature adds them.
- **Acceptance Criteria**:
  - Automation rules can be created, listed, updated, and deleted, each scoped to a board, with a condition and a target-status action
  - When a card's state changes such that a rule's condition is satisfied, the engine automatically transitions the card to the rule's target status
  - The evaluation engine is guarded against infinite loops and cyclic rules (a bounded, terminating pass)
  - Automated moves are recorded in the activity feed (reusing FEAT-005) and are distinguishable from manual moves
  - Invalid rule definitions are rejected with clear validation errors (400)
  - Rules and the engine are covered by automated tests (condition matched / not matched, loop prevention, disabled-rule no-op)
- **Dependencies**: FEAT-003 (Card CRUD API — card `status` is what rules auto-move, and the `PATCH /cards/:id` path is the evaluation trigger); FEAT-002 (Board CRUD API — rules are scoped per board); FEAT-005 (Realtime Activity Feed — automated moves emit activity events). FEAT-001 (foundation — Express app factory, `pg` pool, logger).
- **Linked Tasks**: TASK-006 (planning)
- **Branch**: feature/FEAT-006-card-workflow-automation
- **Created**: 2026-07-15
