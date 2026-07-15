# BanyanBoard Frontend

A read-only React single-page app for BanyanBoard. It consumes the existing REST
API and provides two views (arriving across build phases):

- `/` — **board list**: all boards, click through to open one
- `/boards/:id` — **board view**: the board's cards grouped into three fixed
  columns (To Do / In Progress / Done)

Built with **Vite + React + TypeScript**, tested with **Vitest + React Testing
Library**. Architecture and UI/UX decisions are recorded in
`../memory-bank/creative/TASK-004-react-frontend-architecture.md` and
`../memory-bank/creative/TASK-004-react-frontend-uiux.md`.

## Prerequisites

- Node.js 20+ and npm
- The BanyanBoard API running locally (default `http://localhost:3000`) — see the
  repo root `README.md` / `docker-compose.yml`.

## Setup

```bash
cd frontend
npm install
```

### Environment (12-factor)

The API base URL is read from the environment at build time — never hardcoded.
Create a local `.env` file in `frontend/` (it is git-ignored) with:

```dotenv
# Base path the SPA uses for all API calls. Defaults to same-origin `/api`, which
# the dev-server proxy forwards to the API. Leave as `/api` for the standard
# same-origin topology; set to an absolute URL only for a genuinely cross-origin
# API (which then also requires CORS on the backend).
VITE_API_BASE_URL=/api

# Where the Vite dev-server proxy forwards `/api/*` — the running Express API.
# Dev-only; not baked into the production build.
VITE_API_PROXY_TARGET=http://localhost:3000
```

Both variables have safe defaults (`/api` and `http://localhost:3000`), so the
app runs with **no `.env` file** in the standard local setup. A `.env` is only
needed to override those defaults.

> The usual `.env.example` template lives here in the README instead of a
> committed `.env.example` file (the repo's tooling guards `.env*` paths). Copy
> the block above into `frontend/.env` to customize.

## Commands

| Command            | What it does                                                         |
| ------------------ | ------------------------------------------------------------------- |
| `npm run dev`      | Start the Vite dev server (HMR) with the `/api` → API proxy         |
| `npm run build`    | Type-check (`tsc --noEmit`) then produce a production build (`dist/`) |
| `npm run preview`  | Serve the production build locally                                   |
| `npm run test`     | Run the component/unit test suite once (Vitest)                     |
| `npm run test:watch` | Run tests in watch mode                                            |
| `npm run typecheck` | Type-check only (`tsc --noEmit`)                                    |

## How the API is reached (CORS)

The SPA always calls a **same-origin** path prefixed with `/api`. In development,
Vite's dev-server proxy (`vite.config.ts`) forwards `/api/*` to the API and
strips the `/api` prefix, so the browser never makes a cross-origin request —
**CORS never engages and the backend is untouched**. The `/api` prefix also
avoids the `/boards` API-path vs. `/boards/:id` client-route collision. In
production, serve the built SPA behind a reverse proxy (or from the API itself)
that routes `/api/*` to the API, keeping everything same-origin.

## Project layout

```
frontend/
├── index.html
├── vite.config.ts        # React plugin + Vitest config + /api dev proxy
├── tsconfig.json
├── src/
│   ├── main.tsx          # createRoot + <App/>
│   ├── App.tsx           # app shell (routing added in Phase 2)
│   ├── api/
│   │   ├── types.ts      # Board, Card, CardStatus (wire types)
│   │   ├── client.ts     # getBoards/getBoard/getCards — the only fetch caller
│   │   └── client.test.ts
│   └── test/setup.ts     # @testing-library/jest-dom
```
