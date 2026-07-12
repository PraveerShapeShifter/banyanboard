# BanyanBoard

A lightweight kanban board for small teams. Create boards with columns (To Do,
In Progress, Done) and move cards between them.

**Stack**: React frontend · TypeScript/Express backend · PostgreSQL · Docker Compose.

## Status

Early foundation (FEAT-001), the Board CRUD API (FEAT-002), and the Card CRUD
API (FEAT-003). Backend API skeleton, `/health` endpoint with PostgreSQL
connectivity, Docker Compose orchestration, and full CRUD REST endpoints for
boards and cards are in place.

> **Database schema (first run)**: the `boards` table is created by
> `db/init/001_boards.sql` and the `cards` table by `db/init/002_cards.sql`
> (numbered so it runs after boards — its `board_id` foreign key needs the
> `boards` table first), both mounted into the Postgres container's
> `/docker-entrypoint-initdb.d/`. Those scripts run **only against an empty data
> directory**, so if you have a `db-data` volume from a previous run, recreate it
> once with `docker compose down -v` for the schema to be applied. This is fine
> for a pre-release dev database.

## Quick Start (Docker Compose)

The fastest way to run the full stack (API + PostgreSQL). Requires Docker with
Compose v2.

```bash
docker compose up --build        # build the API image and start api + postgres
```

Compose starts a `postgres:16-alpine` database, waits until it is healthy, then
starts the API wired to it via `DATABASE_URL`. Once up:

```bash
curl -i http://localhost:3000/health
# -> 200 {"status":"ok","db":"connected"}
```

Tear down (add `-v` to also drop the database volume):

```bash
docker compose down
```

Compose reads these variables from your shell/`.env` (sensible local defaults are
built in, so none are required):

| Variable            | Default      |
|---------------------|--------------|
| `POSTGRES_USER`     | `banyan`     |
| `POSTGRES_PASSWORD` | `banyan`     |
| `POSTGRES_DB`       | `banyanboard`|
| `LOG_LEVEL`         | `info`       |

> The built-in credentials are for **local development only**. Override them for
> any non-local environment.

## Getting Started (backend)

Requires Node.js 20+.

```bash
npm install         # install dependencies
npm run dev         # start the API in watch mode (http://localhost:3000)
npm run build       # compile TypeScript to dist/
npm start           # run the compiled server
npm test            # run the test suite (Vitest)
```

Configuration is read from environment variables (12-factor). Set them in your
shell or a local `.env` file (not committed):

| Variable       | Purpose                     | Default                                              |
|----------------|-----------------------------|------------------------------------------------------|
| `PORT`         | HTTP port                   | `3000`                                               |
| `LOG_LEVEL`    | Log verbosity               | `info`                                               |
| `DATABASE_URL` | PostgreSQL connection string| `postgres://banyan:banyan@localhost:5432/banyanboard`|

## API

| Method & Path | Description | Responses |
|---------------|-------------|-----------|
| `GET /`       | Service info | `200 { "name": "banyanboard", "status": "running" }` |
| `GET /health` | Liveness + database connectivity probe | `200 { "status": "ok", "db": "connected" }` when PostgreSQL is reachable · `503 { "status": "degraded", "db": "disconnected" }` when it is not (the process stays up) |

### Boards

A board has `{ id, name, description, created_at, updated_at }`. `name` is
required (non-blank, ≤120 chars); `description` is optional.

| Method & Path        | Description        | Responses |
|----------------------|--------------------|-----------|
| `POST /boards`       | Create a board     | `201` created board · `400` invalid/malformed body |
| `GET /boards`        | List all boards    | `200` JSON array |
| `GET /boards/:id`    | Fetch one board    | `200` board · `404 { "error": "Board not found" }` |
| `PATCH /boards/:id`  | Partial update     | `200` updated board · `400` invalid body · `404` if missing |
| `DELETE /boards/:id` | Delete a board     | `204` no content · `404` if missing |

### Cards

A card belongs to exactly one board and has
`{ id, board_id, title, description, status, due_date, created_at, updated_at }`.
`board_id` (a positive integer referencing an existing board) and `title`
(non-blank, ≤200 chars) are required. `status` is one of `todo` (default),
`in_progress`, `done`. `description` and `due_date` (an ISO date) are optional.
`board_id` is fixed once created — it is not accepted on update. Deleting a
board cascades to its cards (`ON DELETE CASCADE`).

| Method & Path            | Description                                   | Responses |
|--------------------------|-----------------------------------------------|-----------|
| `POST /cards`            | Create a card                                 | `201` created card · `400` invalid body or `board_id` referencing no board |
| `GET /cards`             | List all cards (or one board's via `?board_id=`) | `200` JSON array · `400` malformed `board_id` filter |
| `GET /cards/:id`         | Fetch one card                                | `200` card · `404 { "error": "Card not found" }` |
| `PATCH /cards/:id`       | Partial update (title/description/status/due_date) | `200` updated card · `400` invalid body · `404` if missing |
| `DELETE /cards/:id`      | Delete a card                                 | `204` no content · `404` if missing |

On an unexpected server-side failure (e.g. the database is unreachable), the API
responds `500 { "error": "Internal server error" }` without leaking internals.

Quick check once the server is running:

```bash
curl -i http://localhost:3000/health
curl -i -X POST http://localhost:3000/boards \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sprint Board","description":"Q3 sprint"}'
curl -i http://localhost:3000/boards
curl -i -X POST http://localhost:3000/cards \
  -H 'Content-Type: application/json' \
  -d '{"board_id":1,"title":"Write spec","status":"in_progress"}'
curl -i "http://localhost:3000/cards?board_id=1"
```

## Project Structure

```
db/
  init/       SQL schema scripts mounted into Postgres (001_boards.sql, 002_cards.sql)
src/
  config/     env config + logger
  db/         PostgreSQL pool + connection check (pg)
  health/     GET /health router (+ tests)
  boards/     Board CRUD: types, repository (pg), validation, routes (+ tests)
  cards/      Card CRUD: types, repository (pg), validation, routes (+ tests)
  app.ts      Express app factory (no side effects; deps injected)
  server.ts   entry point (reads env, builds pool, starts listening)
```

The `Dockerfile` (multi-stage: TypeScript build → slim runtime, non-root) and
`docker-compose.yml` (api + postgres) live at the repo root — see the Quick Start
above.
