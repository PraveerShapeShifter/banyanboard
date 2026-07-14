# Reflection: TASK-004 — React Frontend

**Date**: 2026-07-14
**Task Complexity**: Level 3 (FEAT-004)
**Total Phases**: 3 (scaffold + API client · board list · board view + columns)
**Duration**: 2026-07-13 (plan) → 2026-07-13 (creative) → 2026-07-13 (all 3 build phases, single day) → 2026-07-14 (reflection)
**Branch**: feature/FEAT-004-react-frontend (no worktree; local-merge candidate per projectbrief Git Configuration)

**Ratings** — Task Quality: **High** · Ecosystem Effectiveness: **Good**

---

## Executive Summary

TASK-004 delivered BanyanBoard's first user-facing surface: a read-only React SPA with a board list (`/`) and a board view (`/boards/:id`) that groups cards into three fixed status columns, consuming the already-complete Board/Card REST API (FEAT-002/003, 95/95 backend tests, untouched by this task). It is also the project's first frontend task in an otherwise all-backend (Express/TypeScript) repository, which made it a genuine test of whether the Banyan workflow — and the six existing `_learned/` rules, all backend-scoped — would transfer to a materially different tech stack.

The result is a clean, precedent-conscious Level 3 execution. Two creative phases (Architecture, UI/UX) resolved seven open design questions before any code was written, and the implementation held to those decisions with no material drift: Vite + React Router + a hand-rolled `fetch` client, a dev-server proxy instead of backend CORS changes, frontend-owned wire types, and a WCAG 2.1 AA-oriented component set (semantic list, CSS Grid columns, shared Loading/Error/Empty/NotFound states, status conveyed by persistent text labels rather than color). All 11 acceptance criteria are satisfied across 3 phases, landing 20/20 Vitest+RTL tests, a clean `tsc --noEmit`, a `vite build` well under the bundle-size expectation (69.5 kB gzip), and 0 `npm audit` vulnerabilities.

The task also surfaced two genuinely frontend-specific implementation challenges with no backend precedent to draw on: a jsdom/undici incompatibility with React Router's data-router `AbortSignal` handling (worked around by testing through the declarative `MemoryRouter`), and a Vitest 2→3 major bump forced by a nested-`vite@5` dependency conflict. Both were resolved cleanly and are documented as reusable lessons below. The main honest gap is that the DI/stub-testing and 12-factor learned rules were the *only* backend rules that transferred meaningfully; most of the six `_learned/` files (SQL parameterization, FK-existence checks, cascade-via-linked-stubs) had zero applicability to a client that makes no writes and touches no database — a finding the reflection treats as expected rather than a workflow failure, but one worth stating plainly rather than glossing over.

---

## Dimension 1: Task Implementation Quality

### Requirements Achievement

**Status**: ✅ All Met (code + automated tests); two follow-ups deliberately deferred to human/UAT

| AC | Status | Evidence |
|----|--------|----------|
| AC-ENTRY-1 (board list is the landing view) | ✅ | `/` route renders `BoardListPage`; journey test lands there first |
| AC-HAPPY-1 (app builds/runs via documented command, API base URL from env) | ✅ | `npm run dev`/`build`/`test` documented in README + `techContext.md`; `VITE_API_BASE_URL` read per-call in `client.ts`, never hardcoded |
| AC-HAPPY-2 (board list fetches + renders all boards) | ✅ | `BoardListPage.test.tsx` asserts rendered count matches `GET /boards` response |
| AC-HAPPY-3 (selecting a board navigates to its view) | ✅ | `BoardListItem` wraps the row in a `<Link>`; journey test clicks through and asserts columns render |
| AC-HAPPY-4 (cards grouped into 3 fixed columns by status, no card in >1 or 0 columns) | ✅ | `groupCardsByStatus` pure fn; test asserts each card appears in exactly one `region` and not in the others |
| AC-HAPPY-5 (explicit empty state when no boards) | ✅ | `EmptyState` renders "No boards yet." on `[]` |
| AC-HAPPY-6 (empty column shows header + "no cards", never omitted) | ✅ | `Columns` seeds all 3 keys; test asserts `region` count stays 3 and "No cards" renders |
| AC-ERROR-1 (board list fetch failure → error + retry) | ✅ | `ErrorState` with `role="alert"` + working Retry button |
| AC-ERROR-2 (board/cards fetch failure → error + retry, no silent-empty column) | ✅ | `getBoardView` composes both fetches; either failure → error state, not a partial render; retry test confirms recovery |
| AC-ERROR-3 (404 on nonexistent board → distinct not-found, with a way back) | ✅ | `NotFoundState` (no Retry, back-link) rendered only on `httpStatus === 404`, distinct from generic `ErrorState` |
| AC-ASYNC-1 (loading indicator, never blank/stale while pending) | ✅ | `useApiResource` state machine forces a `switch`-style render; `Loading` renders immediately, replaced only on resolution |

No scope creep: card labels correctly not rendered (absent from the `cards` schema per the spec's documented gap), no drag-and-drop, no create/edit/delete UI, no auth UI — all explicitly out of scope and respected.

**Deliberately deferred (not gaps in the delivered work, but open follow-ups)**:
- Human live-verify: `npm run dev` against the actually-running API (round-trip smoke test) — same category of deferred manual verification as TASK-001/002/003's `docker compose up` checks.
- `/banyan-uat TASK-004` — a browser-based accessibility walk (keyboard traversal, screen-reader column-header/count announcements, non-color status legibility at each breakpoint) was flagged as the right follow-up in both creative docs and the Phase-3 progress entry, but has not yet been run. This matters more here than for prior tasks because TASK-004 is the first task with a UI and therefore the first task where `/banyan-uat`'s accessibility-focused walk is actually applicable — its absence from the workflow-to-date is a genuine gap, not a formality.

### Code Quality Assessment

**Overall Rating**: Excellent

- **Maintainability**: High. The codebase is organized exactly as the Architecture creative specified — `api/` (single fetch seam + wire types), `hooks/` (one state-machine hook reused by both pages), `components/` (four shared state components), `pages/BoardListPage/` and `pages/BoardViewPage/` each with small, single-purpose files (`BoardHeader`, `Columns`, `Column`, `Card`, `groupCardsByStatus`). Every file carries a short doc comment stating *why*, not just what (e.g. `useApiResource`'s comment ties the design directly back to AC-ASYNC-1).
- **Architecture**: The single I/O seam (`api/client.ts` is the only module that calls `fetch`) is a faithful frontend mirror of the backend's DI/driver-isolation pattern, and it held up under scrutiny: `BoardViewPage`'s `getBoardView(id)` composes `getBoard`/`getCards` locally rather than adding a second fetch path, preserving the seam. The discriminated `ApiResult<T>` (`ok | http | network`) cleanly separates the three failure modes the UI must distinguish (network vs. HTTP vs. 404-as-not-found) without try/catch sprawl in the pages.
- **Error Handling**: Every async boundary is explicit — `getJson` catches transport failures and also treats a 2xx-with-unparseable-body as a network-kind failure (a small but real edge case many implementations miss); `useApiResource` never leaves a page in an ambiguous state (it is a 3-way `status` union, not booleans); `BoardViewPage` explicitly special-cases `httpStatus === 404` before falling through to the generic error branch, so a board-not-found can never be silently rendered as a generic error or (worse) an empty board.
- **Testing**: Strong and behavior-focused. Tests query by ARIA role/name (`getByRole('region', { name: /To Do/ })`, `role="alert"`, `role="link"`) rather than test-ids or DOM structure, which doubles as an accessibility check per RTL's own philosophy — a good fit for the project's WCAG 2.1 AA requirement. The journey test (list → click → columns) exercises the real route table via the declarative router, not a shortcut. One minor test-design compromise, openly documented: because `createMemoryRouter`'s data-router builds a `fetch` `Request` with an `AbortSignal` that jsdom/undici reject cross-realm, tests drive the same `routes` array through `MemoryRouter`+`Routes` instead of the actual `createBrowserRouter` the app uses in production — a small fidelity gap between test harness and production router, acceptable but worth tracking if React Router's loader/data APIs are adopted later.

### Technical Decisions

**Key Decisions:**
1. **Dev-server proxy instead of backend CORS** — the single most consequential architectural call. It resolved the CORS gap with *zero* backend changes (protecting the 95/95 backend suite), incidentally solved the `/boards` API-vs-route collision via the `/api` prefix, and kept the built artifact environment-agnostic (`VITE_API_BASE_URL` defaults to same-origin `/api`). Outcome: held up cleanly through all 3 phases with no backend touch at all.
2. **Frontend-owned wire types over a shared-types package** — a documented deviation from `techContext.md`'s general shared-types recommendation, justified by the Date-vs-string wire mismatch and the cost of restructuring a completed, tested backend into a workspace for two small interfaces. Outcome: held up; the contract was frozen and small enough that duplication never became a liability this iteration, and a promotion path is documented for if/when writes or contract churn arrive.
3. **One state-machine hook (`useApiResource`) instead of ad hoc booleans per page** — chosen in the UI/UX creative specifically to make "never show stale/blank content while pending" true *by construction* rather than by discipline. Outcome: both pages consume it identically; the AC-ASYNC-1 requirement is enforced structurally, not just tested for.
4. **No data-fetching library (React Query, etc.)** — assessed and explicitly rejected as abstraction ahead of concrete need for a 3-endpoint, read-only, no-revalidation feature. Outcome: correct call; the ~40-line client plus one hook fully covered the requirement with a smaller bundle.

**Trade-offs:**
- **Proxy-based CORS resolution vs. backend CORS middleware**: gained a zero-backend-touch, env-agnostic build; sacrificed a documented production assumption (same-origin topology via reverse proxy or API-served-static) that must hold in deployment — CORS remains the documented escape hatch if a genuinely cross-origin consumer appears later.
- **Frontend-owned types vs. shared package**: gained decoupling and no monorepo restructuring; sacrificed a single source of truth, accepting a drift risk mitigated by the contract being frozen and test-asserted this iteration.
- **Manual state machine vs. data-fetching library**: gained simplicity and bundle size; sacrificed built-in caching/dedupe/retry — acceptable for 3 read-only endpoints, explicitly flagged as revisit-at-FEAT-005 (realtime/writes) territory.
- **Declarative-router tests vs. the actual `createBrowserRouter`**: gained working, deterministic tests around a real jsdom/undici incompatibility; sacrificed exact router-instance parity between test and production code paths — low risk today (no loaders/actions used), worth revisiting if data-router features are adopted.

### What Went Well

1. **The proxy decision cascaded into three separate wins from one choice** — CORS resolution, route-collision avoidance, and an environment-agnostic build all fell out of the single "`/api` same-origin proxy" decision, which is a strong sign the Architecture creative correctly identified the load-bearing question among the seven it explored.
2. **Accessibility was designed in, not bolted on** — the UI/UX creative's non-color-status, `role="alert"`/`aria-live`, semantic-list, and `:focus-visible` requirements were carried through literally into the implementation and are directly exercised by the RTL role-based test queries, rather than being a post-hoc audit item.
3. **The single-fetch-seam discipline survived the trickiest phase** — Phase 3 needed two parallel fetches (board + cards) and could easily have grown a second I/O path; instead `getBoardView` composed the existing `getBoard`/`getCards` functions, keeping the "one place that calls fetch" invariant intact under real pressure.
4. **A real jsdom/router incompatibility was diagnosed and worked around cleanly** rather than papered over — Phase 2's build log records the root cause (`AbortSignal` cross-realm rejection) and the chosen fix (drive tests through the shared `routes` array via `MemoryRouter`+`Routes`), which is exactly the kind of finding worth carrying forward.

### Challenges Encountered

1. **jsdom/undici rejects the data router's `AbortSignal` on navigation** — `createMemoryRouter`'s loader-aware fetch includes a cross-realm `AbortSignal` that jsdom's fetch shim rejects. Resolved by testing the same `routes` array through the declarative `MemoryRouter`+`Routes` instead of the data router, preserving full route-table fidelity while sidestepping the incompatible code path.
2. **Vitest 2→3 forced bump to dedupe onto Vite 6** — greenfield tooling churn risk (flagged explicitly in the plan's Risks section) materialized: `npm audit` surfaced nested `vite@5` advisories from a Vitest 2 pin; bumping to Vitest 3 deduped the dependency tree onto the single Vite 6 the project already used, clearing all advisories to 0 in the same move. Resolved cleanly, and the underlying principle (major-version alignment between a test runner and its host bundler) is now captured as a learned rule.
3. **`.env.example` couldn't be committed** — the repo's own tooling guards `.env*` paths, which blocked the Architecture creative's planned `frontend/.env.example`. Resolved by moving the env template into `frontend/README.md` verbatim (both variables carry safe defaults, so the app runs with zero `.env` file in the standard setup) — a reasonable, low-risk deviation, but one that a future contributor scanning for `.env.example` by habit could miss; worth a `techContext.md` note pointing at the README location.

### Technical Debt & Future Work

- **Live `npm run dev` verification against a running API is still manual/deferred** — consistent with every prior task's deferred Docker/live-DB checks, but the first time this class of gap applies to a user-facing surface rather than an API contract.
- **`/banyan-uat TASK-004` has not been run** — this is the first task where UAT is actually meaningful (a real UI exists), and the specific accessibility questions the creative docs asked for (keyboard traversal, screen-reader column announcements, non-color legibility per breakpoint) are exactly the kind of thing that can look correct in an RTL role-based test and still fail in a real screen reader or a real color-contrast check. This should not be treated as optional polish for this particular task.
- **Test/production router-instance fidelity gap** (`MemoryRouter`+`Routes` in tests vs. `createBrowserRouter` in `main.tsx`) — low risk today, but if a future feature adopts React Router loaders/actions, the workaround will need to be revisited since it currently sidesteps the very router API those features depend on.
- **Frontend-owned wire types will drift if the API contract changes** — explicitly accepted and mitigated (frozen contract, test-asserted fields, documented promotion path to a shared `contract/` package), but worth flagging again now that a frontend consumer exists: any future backend PATCH/POST to `Board`/`Card` shape should trigger a frontend type review, not just a backend test update.

---

## Dimension 2: Claude Code Ecosystem Effectiveness

### Build Session Analysis

**Session logs**: Not task-indexed — `.agent-logs/claude/by-task/TASK-004/` does not exist, the same gap flagged in all three prior reflections (TASK-001/002/003). **Session logs not task-indexed. Run /banyan-init to upgrade.** Build-session tool-utilization and sub-agent-invocation counts are therefore unavailable as hard numbers; the analysis below is reconstructed qualitatively from the task file's per-phase Execution State and `progress.md` entries, consistent with how the prior three reflections handled the same gap.

**Build Sessions**: 3 (`/banyan-build` Phase 1 — scaffold/API client, Phase 2 — board list, Phase 3 — board view/columns), preceded by `/banyan-plan` (Spec Writer agent) and `/banyan-creative` (Architecture + UI/UX agents), followed by this `/banyan-reflect`.
**Sub-Agents Spawned**: Spec Writer (plan) · Architecture Design + UI/UX Design (creative) · Test Writer + Coding Agent (each of Phases 1-3) · Code Reviewer (Phase 1 only, via `ecc:typescript-reviewer`) · orchestrator self-review in place of a code-reviewer sub-agent for Phases 2 and 3.
**Tool Calls**: Not available (no session logs) — qualitatively, heavy `Write`/`Edit` volume in Phase 1 (greenfield scaffold: ~15+ new files) tapering to more `Edit`-weighted, `Read`-heavy work in Phases 2-3 (extending an established structure), plus `Bash` for `npm test`/`npm run build`/`tsc --noEmit`/`npm audit` at each phase's verification gate.
**Errors Recovered**: 2 — the jsdom/`AbortSignal` router incompatibility (Phase 2) and the Vitest 2→3 dependency-conflict bump (Phase 1) — both diagnosed and resolved within the same build session, no cross-phase carryover.

#### Tool Utilization

| Tool | Count | Success Rate | Notes |
|------|-------|--------------|-------|
| Read/Edit/Write/Bash/Task/Grep/Glob | N/A | N/A | Not measurable — no task-scoped session logs exist (see above). Qualitatively: Write-heavy Phase 1 (new package scaffold), Edit-heavy Phases 2-3, Bash used consistently for the test/build/typecheck/audit verification gate every phase. |

#### Sub-Agent Performance

| Agent Type | Invocations | Model | Effectiveness |
|------------|-------------|-------|---------------|
| Spec Writer | 1 (plan) | Sonnet | Effective — produced 11 well-scoped ACs (1 ENTRY/6 HAPPY/3 ERROR/1 ASYNC) and correctly surfaced both codebase gaps (no CORS middleware, `labels` not in schema) that shaped the entire creative phase |
| Architecture Design | 1 (creative) | Sonnet/Opus (per Level 3 model strategy) | Highly effective — resolved all 7 open questions with genuine trade-off analysis (not just picking defaults); the proxy decision in particular was the single highest-leverage call in the task |
| UI/UX Design | 1 (creative) | Sonnet/Opus | Highly effective — the accessibility requirements it specified were concrete enough (role names, `aria-live`, non-color status) to translate directly into passing RTL assertions, not just prose guidance |
| Test Writer | 3 (P1, P2, P3) | Sonnet | Effective across all phases — tests are behavior/role-based, map cleanly to specific ACs by name in comments, and the Phase 3 suite correctly re-validated the Phase 2 nav test once `BoardViewPage` became real |
| Coding Agent | 3 (P1, P2, P3) | Sonnet | Effective — held to the creative decisions with no material drift; Phase 3's `getBoardView` composition is the strongest evidence the single-fetch-seam discipline was actually internalized, not just followed by rote |
| Code Reviewer | 1 (P1 only, `ecc:typescript-reviewer`) | Sonnet | Effective where used — caught 2 real, non-blocking issues (missing `encodeURIComponent`, an under-commented unchecked cast) and both were fixed. **Not invoked as a separate sub-agent in Phases 2-3** (orchestrator self-review instead), continuing the pattern first seen in TASK-003 |
| Documentation | inline, not separately invoked | Haiku | `techContext.md` and `frontend/README.md` updates were handled inline per phase rather than via a dedicated Documentation sub-agent call |

### Command Workflow Evaluation

**Commands Used**: `/banyan-roadmap feature create` (FEAT-004, auto-provisioned TASK-004) → `/banyan-plan TASK-004` → `/banyan-creative TASK-004` (2 phases) → `/banyan-build TASK-004` ×3 → `/banyan-reflect TASK-004` (this run).

**Workflow Efficiency**: Excellent

**Assessment**:
- The full Level 3 sequence (roadmap → plan → creative → build×3 → reflect) was exactly appropriate here, in clear contrast to TASK-002/003 where creative was correctly skipped. This task had genuine, open, LOW-confidence design questions (bundler, router, API-client pattern, CORS-vs-proxy, visual layout, folder/test conventions) rather than narrow technical choices resolvable inline — the complexity/creative-requirement classification was accurate.
- The 3-phase build split (scaffold+client / list / view+columns) tracked the natural dependency order and gave three clean human-review gates, mirroring the discipline of TASK-002/003's 2-phase splits scaled up for one additional phase.
- **A real first**: this is the first task where `/banyan-uat` is genuinely applicable (a real UI exists with documented accessibility requirements to verify), and it has not yet been run despite being flagged as the recommended next step in two separate creative docs and the Phase-3 progress entry. The workflow correctly *identifies* the need (both creative docs end with explicit UAT asks); whether the orchestrator reliably *acts* on that recommendation before archiving is the open question this task raises for the ecosystem.
- No unnecessary steps observed. Reflection is appropriately being run before archive per the workflow, as intended.

### Context File Effectiveness

**Files Loaded**: `tasks/TASK-004.md` (spec, 11 ACs, 3-phase roadmap, full per-phase Execution State), `progress.md`, both creative docs (`TASK-004-react-frontend-architecture.md`, `TASK-004-react-frontend-uiux.md`), the implemented `frontend/` source and tests, `techContext.md` (frontend section, previously `[TBD]`), and all six `_learned/` topic files.

**Assessment**:
- **Helpful**: The two creative docs were unusually strong artifacts for this reflection specifically — because they recorded not just decisions but rejected alternatives with rated trade-off matrices, it was possible to verify from the reflection seat that the implementation actually followed through on stated rationale (e.g., the proxy decision, the single-fetch-seam) rather than merely asserting it did. The task file's Execution State, again, was the single best reconstruction aid for a task with no session logs.
- **Gaps**: The six `_learned/` rule files are entirely backend-scoped (SQL parameterization, FK-existence checks, Express error middleware, Docker/compose verification) and, honestly, only two of the six offered *any* transferable guidance to this frontend task (`testing-patterns.md`'s DI/stub-injection principle, and `configuration.md`'s "read config from env, never hardcode" principle) — see Learned Rules Applied below. There is currently no frontend-scoped guidance file (e.g., component-testing conventions, accessibility-query patterns, or a client-side-state-machine pattern) despite this now being a proven, reusable pattern from this task. As in prior reflections, plugin context/agent methodology files live outside the workspace (`C:/ShapeShifter_code/Banyan_test/BMB1.8.4/...`), a cross-install gap that persisted unchanged for this task.
- **Redundancy**: None material.

### Memory Bank Organization

**Assessment**:
- **Structure**: Adequate and, notably, unchanged in shape despite the stack switch — the same task-file + registry + progress-log + topic-scoped-learned-rules structure that served three backend tasks required zero adaptation to describe a frontend task. That is a good sign for the memory bank's generality.
- **Navigation**: Efficient; the same `tasks.md` → `tasks/TASK-004.md` → creative docs → source path used for the backend tasks worked identically here.
- **Completeness**: The recurring gap (a first-class "deferred runtime verification" tracker, flagged in all three prior reflections) is present again, joined this time by a second, arguably more important recurring gap for UI work specifically: nothing in the memory bank structurally tracks "UAT recommended but not yet run" as a distinct, visible status separate from "reflection not yet run" or "not yet archived" — it currently lives only as prose inside `progress.md` entries and creative-doc "Next Steps" sections.

### Suggested Improvements to Claude Code System

**Note**: Suggestions only — NOT implemented.

**High Priority**:
1. **Task-indexed session logging is still absent** — fourth consecutive task (and the first frontend one) where tool/sub-agent/error-recovery metrics could not be reported quantitatively. This remains the single biggest, most-repeated blind spot across all four reflections to date.
2. **Add a structural "UAT pending" status distinct from reflection/archive status** — TASK-004 is the first task where `/banyan-uat` is actually load-bearing (accessibility claims made in the UI/UX creative are currently *unverified in a real browser*), and the recommendation to run it is currently only discoverable by reading prose in two creative docs and a progress entry. A dedicated Execution State field (e.g., `UAT Status: RECOMMENDED / RUN / SKIPPED`) would make this visible at a glance and prevent it from silently aging out the way the deferred docker/live-DB checks have across three prior tasks.

**Medium Priority**:
3. **Seed a frontend-scoped learned-rule topic proactively** — rather than waiting for a second frontend task to accumulate evidence_count, the ecosystem could recognize "first task in a new stack" as a trigger to scaffold a topic file (e.g. `frontend-patterns.md`) from this task's genuinely reusable decisions (single-fetch-seam, state-machine hook, role-based test queries) so the *next* frontend task inherits guidance instead of starting cold the way this one did.
4. **`.env.example`-guard vs. framework convention conflict should be flagged as a phase-gate warning, not just documented ad hoc** — the repo's own tooling blocking a `.env.example` commit is a reasonable security default, but it collided with a documented convention from the Architecture creative and had to be worked around in Phase 1 with no earlier warning. A pre-build check that diffs "creative doc says commit X" against "tooling guards X" would surface this before implementation starts.
5. **Co-locate/mirror plugin context/agent files into the workspace** — unchanged from TASK-002/003; level-specific rule files at the external install path remain effectively unavailable to in-workspace tooling.

**Low Priority / Nice to Have**:
6. **A lightweight "router/test-harness fidelity" note in the frontend testing guidance** — the `MemoryRouter`+`Routes` vs. `createBrowserRouter` divergence used to work around the jsdom `AbortSignal` issue is a reasonable, well-documented trade-off, but a general callout (test the same route table your app uses, and track any place tests diverge from the production router API) would help future React Router-based tasks recognize the same trade-off faster.

---

## Key Learnings

### Extractable Learnings (for Continuous Learning)

**Format**: `- **[category]** ([scope hint]): [directive]`

1. **frontend-patterns** (`frontend/src/api/*`, `src/hooks/*`): Confine all `fetch` calls to a single client module returning a discriminated result (`ok | http | network`), and model each consuming page's async state as one status union (loading/success/error) rather than boolean flags, so "never render stale/blank content while pending" is enforced by the type/render structure rather than by convention.
2. **testing-patterns** (`*.test.tsx`, React component tests): Query rendered output by ARIA role and accessible name (`getByRole('region', { name: /To Do/ })`, `role="alert"`) rather than test-ids or DOM structure — this doubles as an accessibility check and is more resilient to markup refactors.
3. **configuration** (`vite.config.ts`, frontend build tooling): When a test runner and its host bundler share an engine (e.g., Vitest + Vite), keep their major versions aligned — a mismatched pin can silently pull in a second copy of the bundler and reintroduce advisories the primary version already fixed; verify with a dependency-tree check (e.g. `npm ls <bundler>`) after any test-runner version bump.
4. **error-handling** (`src/pages/**/*.tsx`, async data-driven UI): When a fetch can fail for more than one reason a user must distinguish (e.g., a 404 meaning "this specific resource doesn't exist" vs. any other failure meaning "something went wrong, retry"), branch on the specific status *before* falling through to a generic error state, and give the specific case its own component/copy with no misleading Retry affordance where retrying cannot help.

**Limits**: Level 3 → 2-4 learnings. Four extracted: #1 and #4 are new frontend-specific patterns (no existing frontend topic file exists yet — first evidence toward a future `frontend-patterns.md` and reinforcing `error-handling.md`'s existing generic-handler principle at a UI layer); #2 amends nothing existing (new UI-testing angle, distinct from the backend-only `testing-patterns.md` evidence so far, added as new evidence toward that file); #3 is a configuration-topic addition distinct from the existing `configuration.md` entry (env-defaults-in-compose), addressing tooling-version alignment instead.

### Learned Rules Applied

- **testing-patterns.md** (`Inject external I/O as dependencies … testable with stubs, no live service`): **Applied, translated to the frontend.** `api/client.ts` is the injectable I/O seam; every component test module-mocks it (`vi.mock('../../api/client')`) rather than hitting a live API — the same DI-for-testability principle, ported from backend repository injection to a frontend fetch client.
- **configuration.md** (`app reads from env, defaults live outside app code`): **Applied.** `VITE_API_BASE_URL`/`VITE_API_PROXY_TARGET` are read from the environment with safe defaults, never hardcoded — directly consistent with this rule, though the *mechanism* (Vite's `import.meta.env` + a git-ignored `.env`) differs from the backend's `process.env` + compose-file defaults.
- **error-handling.md** (`centralize request-error handling, guard against leaking internals, never crash`): **Loaded, partially applicable.** The *spirit* transferred (one central place — `getJson` — normalizes all failure modes; the UI never shows a raw stack trace or an unhandled exception), but the rule's literal Express-handler wording (`res.headersSent`, `err.type === 'entity.parse.failed'`) has no frontend equivalent and was not directly reusable.
- **api-design.md** (`unparseable :id → 404`, `FK-existence check before insert`): **Loaded, not applicable.** This is a read-only frontend making no writes and constructing no server-side id-resolution logic; both rules are backend-route-specific and had nothing to attach to here.
- **data-access.md** (`parameterized SQL queries`, `optional filter as findAll(filter?)`): **Loaded, not applicable.** No SQL, no repository layer, no database in this task at all.
- **infrastructure.md** (`docker compose config validation, defer live up to human`): **Loaded, analogous only.** The closest parallel is the equally-deferred "human live-verify `npm run dev` against the running API" follow-up — same category of gap (no live integration environment in the automated build), different tooling.

Net: of six learned rules, one applied directly (`testing-patterns`), one applied with adaptation (`configuration`), one applied in spirit only (`error-handling`), and three had no applicability (`api-design`, `data-access`, `infrastructure` beyond the loose analogy). This is the expected outcome for the first frontend task in a backend-scoped rule set, not a defect in the rules themselves — but it is a concrete illustration of why a frontend-scoped topic file would materially help the *next* frontend task the way `testing-patterns.md` has now helped three consecutive backend tasks.

### For Claude Code Workflow

1. **Creative-phase depth should scale with confidence, not just complexity level** — this task's Level 3 creative phase earned its keep by resolving genuinely open, LOW-confidence questions with real trade-off analysis (unlike TASK-002/003, which correctly skipped creative because their "creative" questions were narrow and resolved inline during planning). The distinguishing signal — LOW confidence explicitly flagged in the spec's Invocation Method section — worked as an accurate trigger here and is worth keeping as the load-bearing heuristic.
2. **A new tech stack should trigger an explicit "which learned rules apply" checkpoint**, not silent inheritance — this task loaded all six backend-scoped learned rules by default and only three offered any value (one fully, one adapted, one in spirit); an explicit applicability note early in the build (rather than reconstructed after the fact in this reflection) would have made the gap visible during the work, not just in hindsight.
3. **UAT readiness should be tracked as a first-class signal once a UI exists** — this is the first task where the workflow's own creative-phase output (twice) recommended a `/banyan-uat` pass that has not yet happened; unlike the deferred docker/live-DB checks in prior tasks (which are genuinely optional manual smoke tests), an unverified WCAG 2.1 AA claim is closer to an unmet acceptance criterion and deserves more workflow visibility before archive.

---

## Conclusion

TASK-004 is a high-quality Level 3 execution and a meaningful proof point that the Banyan workflow generalizes beyond the backend-only work it has handled so far: the same plan → creative → build×N → reflect sequence, the same memory-bank file shapes, and even the same underlying design instincts (single I/O seam, dependency-injected testability, explicit state machines over ad hoc flags) ported cleanly from Express/Postgres to Vite/React with no structural adaptation required. All 11 acceptance criteria are satisfied in code and in a genuinely behavior-focused, accessibility-aware test suite (20/20 passing), the two creative phases made load-bearing decisions that held up under implementation scrutiny, and two real greenfield-tooling challenges (the jsdom/router `AbortSignal` incompatibility, the Vitest/Vite version dedupe) were diagnosed and resolved rather than papered over.

The honest ecosystem finding is twofold: session-log-based metrics remain unavailable for a fourth consecutive task (a now well-established gap), and — more specific to this task — the backend-scoped learned-rule set offered only partial value to a frontend task, which is expected but underscores the value of seeding a frontend-scoped topic file now rather than waiting for a second data point. The most consequential open item is not a code defect but a workflow one: `/banyan-uat TASK-004` has been recommended twice in this task's own artifacts and has not yet run, and this is the first task in the project where that specific gap (an unverified accessibility/UX claim) is more than a nice-to-have.

**Overall Task Success**: ✅ Success

**Overall Workflow Effectiveness**: ✅ Highly Effective (caveats: session-log metrics still unavailable; UAT recommended-but-not-run for the project's first UI task)

**Recommendation**: Ready to archive (`/banyan-archive TASK-004`), but strongly recommend running `/banyan-uat TASK-004` first given it is the first task where UAT closes a real, currently-unverified acceptance gap (WCAG 2.1 AA claims) rather than a purely optional manual check. Carry forward three tracked follow-ups: (1) `/banyan-uat TASK-004` — keyboard traversal, screen-reader column/count announcements, non-color status legibility at each breakpoint; (2) human live-verify `npm run dev` against the running API; (3) seed a frontend-scoped learned-rule topic from this task's genuinely reusable patterns before the next frontend task starts cold.
