# Product Roadmap

## Summary

- **Total Features**: 3
- **Released Versions**: 0
- **Active Version**: none
- **Planning Backlog**: next (3 features)

## Versions

### next (Planning)

- **Status**: planning
- **Description**: Backlog of features not yet assigned to a committed version
- **Features**:
  - FEAT-001: Project Foundation (complete) [Level 2]
  - FEAT-002: Board CRUD API (planned) [Level 3]
  - FEAT-003: Card CRUD API (planned) [Level 3]

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
- **Status**: planned
- **Priority**: high
- **Complexity**: Level 3
- **Description**: Add the Card domain model with full CRUD REST endpoints, a foreign key to Board (`board_id` → `boards.id`), and input validation. Includes the cards table/schema with the FK constraint and delete behavior (cascade/restrict — to be decided in creative), repository layer, validation, and comprehensive tests.
- **Dependencies**: FEAT-002 (Board CRUD API — Card FK references boards.id); FEAT-001 (foundation). **BLOCKED until FEAT-002 ships.**
- **Linked Tasks**: None
- **Branch**: feature/FEAT-003-card-crud
- **Created**: 2026-07-10
