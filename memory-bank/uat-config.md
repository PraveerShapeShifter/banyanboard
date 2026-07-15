# UAT Configuration

**Status**: Configured
**Last Updated**: 2026-07-15

Project-specific UAT infrastructure for `/banyan-uat`: base URLs, auth strategy,
persona-role → test-account map, viewports, parallelism, and isolation.

> **Note on auth**: BanyanBoard has **no authentication** today (no auth middleware
> in `src/app.ts`; auth is an Open Question in productBrief.md). All UAT walkers
> therefore share a single anonymous session — persona differentiation is
> **role-play only** (the feed attributes every card movement to "Someone" until
> auth lands). There are no real test accounts and no login flow to drive.

## Environments

| Name    | Base URL                | Default | Notes                                                                 |
|---------|-------------------------|---------|-----------------------------------------------------------------------|
| dev     | http://localhost:5173   | yes     | Vite dev server (React SPA). Proxies `/api` → backend `:3000` (SSE feed traverses this proxy unchanged). Requires `docker compose up` OR (`npm run dev` in `frontend/` + backend on `:3000` + Postgres). |

> No staging or prod environment configured. **No prod UAT** is permitted regardless.

## Auth

- **strategy**: none — the app has no authentication; walkers navigate directly to
  protected-looking routes without logging in.
- **vault**: `.auth/` (recorded for forward-compatibility; unused today — in `.gitignore`).
- **file_pattern**: `<persona>.json` (unused today).
- **login_selectors**: N/A (no login UI).
- **post_login_wait**: N/A.

## Persona Map

Personas are **role-play only** (no credentials). A walker "as Priya" simply exercises
the board-view/observer flow; the app cannot distinguish them.

| Role        | Persona | Test Account | Auth Reference | Notes                                                        |
|-------------|---------|--------------|----------------|--------------------------------------------------------------|
| team_lead   | Priya   | (none)       | (none)         | Primary actor — watches the activity feed on the board view. |
| contributor | Marco   | (none)       | (none)         | Moves cards (`PATCH /cards/:id { status }`) — the event source. |
| stakeholder | Sam     | (none)       | (none)         | Read-only observer; glances at board progress.               |

## Viewports

| Name    | Width × Height | Notes                                                       |
|---------|----------------|-------------------------------------------------------------|
| desktop | 1280 × 720     | >1024px — feed is a 4th CSS Grid track right of the columns. |
| tablet  | 768 × 1024     | 640–1024px — feed is a full-width row below the columns.     |
| mobile  | 375 × 667      | <640px (iPhone SE) — feed is a 4th stacked section after Done. |

## Execution

- **max_parallel_tabs**: 4
- **isolation_strategy**: auto (probe for incognito; fall back to same-persona-only).
  Cross-persona cookie collision is **not a real risk here** — no auth means no session
  cookies to collide — but `auto` is the recommended safe default.
- **auth_cookies_to_clear**: (none — app sets no auth cookies)
- **logout_url**: (none — no logout route)
- **screenshot_retention**: keep 10 most recent runs
