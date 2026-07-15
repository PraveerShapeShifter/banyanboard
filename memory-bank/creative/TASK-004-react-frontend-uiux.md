# UI/UX Decision: React Frontend (BanyanBoard) — Board List & Board View

**Created**: 2026-07-13
**Status**: DECIDED
**Decision Type**: UI/UX

## User Context

### Target Users
- **Primary**: Priya (Team Lead / Project Coordinator) — opens the app frequently to see the whole team's status at a glance; needs the board list and the three columns to be scannable in seconds, on desktop or tablet.
- **Secondary**: Marco (Team Member) — checks what's assigned/in progress, often on the go (phone/tablet); needs the board view usable one-handed on a narrow screen. Sam (Stakeholder/Observer) — glances at progress without editing; needs zero learning curve since he visits infrequently.

All three personas are **read-only consumers** in this iteration — no persona needs create/edit/delete/drag affordances, so none are designed.

### User Goals
1. Quickly find and open the right board from a list (Priya, Marco, Sam).
2. See, at a glance, how many cards are in each status and what they are (Priya's "see status at a glance").
3. Recover gracefully from network hiccups or a stale/bad link without getting stuck on a blank or broken screen.

### Use Cases
| Use Case | User | Goal | Frequency |
|----------|------|------|-----------|
| UC1: Open the app | Priya | Land on the board list immediately, no extra clicks | Daily |
| UC2: Pick a board | Marco | Click a board name to see his work | Several times/day |
| UC3: Scan columns | Priya | See To Do / In Progress / Done counts and titles | Daily |
| UC4: Check a specific card's due date | Marco | Find a card, read its due date | Daily |
| UC5: Recover from a dead link | Sam | Land on `/boards/:id` for a deleted board, get back to the list | Occasional |
| UC6: Recover from a flaky connection | Any | Retry a failed fetch without reloading the whole app | Occasional |

### Constraints
- **Devices**: Modern evergreen browsers (Chrome/Firefox/Safari/Edge, latest 2 versions); responsive web from ~360px (small phone) up through desktop; no native app.
- **Accessibility**: WCAG 2.1 AA — status/column meaning must not depend on color alone; visible focus indicators; correct semantic roles/names; full keyboard operability for every interactive element (links, retry buttons, back link).
- **Existing Patterns**: No frontend exists yet (greenfield) and no design system/component library is chosen. `systemPatterns.md` Guiding Principles mandate **simplicity-first, shallow layers, no unnecessary abstraction** — this applies to UI architecture too (favor native HTML semantics over a heavyweight component library).
- **Out of scope**: no drag-and-drop, no create/edit/delete affordances, no label chips (not in schema), no auth UI, no realtime indicators.

## User Flow

### Flow Diagram
```
[App root "/"] → [BoardListPage loads] → GET /boards
                        │
          ┌─────────────┼──────────────┐
          ▼              ▼              ▼
     [Loading]      [Error+Retry]   [Empty "no boards"]
          │
          ▼ (success, boards.length > 0)
   [List of boards rendered]
          │ user clicks a board
          ▼
 [Navigate to "/boards/:id"] → [BoardViewPage loads] → GET /boards/:id + GET /cards?board_id=:id
                                         │
              ┌──────────────┬──────────┼───────────────┬─────────────┐
              ▼               ▼          ▼               ▼             ▼
         [Loading]      [Error+Retry] [404 Not Found] [3 columns render, empty columns show "no cards"]
                                              │
                                              ▼
                                     [Link back to board list]
```

### Flow Description
1. **Entry**: User opens the app's root URL → `BoardListPage` is the landing route (AC-ENTRY-1); no intermediate splash/nav required.
2. **Step 1**: `BoardListPage` fires `GET /boards` on mount; shows a loading indicator until it resolves (AC-ASYNC-1).
3. **Step 2**: On success with `boards.length > 0`, each board renders as a single clickable row (name + optional description). On success with `[]`, an explicit empty state renders (AC-HAPPY-5). On failure, an error message + Retry button renders (AC-ERROR-1).
4. **Decision Point**: User clicks/activates (mouse or keyboard) a board row → client-side navigation to `/boards/:id` (AC-HAPPY-3).
5. **Step 3**: `BoardViewPage` fires `GET /boards/:id` and `GET /cards?board_id=:id` (can run in parallel). While either is in flight, a loading indicator renders. If `GET /boards/:id` returns 404, a distinct "board not found" state renders with a link back to `/` (AC-ERROR-3). If either request fails for another reason, an error + Retry renders and no column silently appears empty (AC-ERROR-2). On success, the header shows the board `name` and three columns always render (To Do / In Progress / Done), each populated by filtering cards on `status`; a column with zero matches still renders its header + an explicit "no cards" line (AC-HAPPY-6).
6. **Exit**: User either navigates away via the browser (back button works because routes are real URLs), or — from an error/not-found state — uses the provided Retry/Back control.

### Error States
| Error | Cause | User Recovery |
|-------|-------|----------------|
| Board list fetch fails | Network error / non-2xx from `GET /boards` | Explicit error message + "Retry" button re-fires the fetch in place (AC-ERROR-1) |
| Board/cards fetch fails | Network error / non-2xx from `GET /boards/:id` or `GET /cards?board_id=` | Explicit error message + "Retry" button re-fires both fetches (AC-ERROR-2) |
| Board not found | `GET /boards/:id` → 404 | Distinct "Board not found" panel, separate from the generic error state, with a link back to the board list (AC-ERROR-3) |
| Empty boards list | `GET /boards` → `[]` | Explicit "No boards yet" message, not a blank page (AC-HAPPY-5) |
| Empty column | Zero cards with that `status` | Column still renders header + "No cards" line, not omitted (AC-HAPPY-6) |

## Options Explored

Two independent layout decisions are explored: (A) how the **board list** presents boards, and (B) how the **three-column board view** lays out and reflows on narrow screens. Each gets its own option set below, followed by one evaluation matrix each, since they are separable design surfaces that combine into the final decision.

---

### A. Board List Page — Presentation Options

### Option A1: Semantic Link List (single-column rows)
- **Approach**: A single unordered list (`<ul>`) where each board is one `<li>` containing a full-row `<Link>`/`<a>` to `/boards/:id`. Name renders as the row's visible heading-weight text; description (if present) renders as secondary text beneath it. No card chrome, no grid — just a clean, dense list, similar to an email inbox or a file list.
- **Wireframe/Layout**:
  ```
  ┌─────────────────────────────────────┐
  │  BanyanBoard                         │
  ├─────────────────────────────────────┤
  │  Boards                              │
  │  ┌─────────────────────────────────┐ │
  │  │ Marketing Launch            →   │ │
  │  │ Q3 campaign planning            │ │
  │  ├─────────────────────────────────┤ │
  │  │ Engineering Sprint 12        →  │ │
  │  ├─────────────────────────────────┤ │
  │  │ Onboarding Revamp            →  │ │
  │  │ New-hire flow redesign          │ │
  │  └─────────────────────────────────┘ │
  └─────────────────────────────────────┘
  ```
- **User Flow**: Tab/click any row → navigate. Screen reader announces "link, Marketing Launch, Q3 campaign planning" as one unit.
- **Pros**:
  - Simplest possible markup — one `<ul>`/`<li>`/`<a>` per board, near-zero CSS needed for correctness
  - Naturally responsive (block rows reflow with viewport width without any breakpoint code)
  - Excellent a11y by default: native list + link semantics, single tab stop per board
- **Cons**:
  - Visually plain; no strong visual separation between boards beyond a border/divider
  - Doesn't scale well to a "gallery" feel if the product later wants richer board previews (out of scope now, but worth naming)
- **Usability**: High
- **Accessibility**: High
- **Implementation Complexity**: Low

### Option A2: Card Grid
- **Approach**: Boards render as a responsive grid of visually distinct "tile" cards (border, padding, subtle shadow), each containing name + description, wrapped in a single link. Grid auto-flows (e.g., `repeat(auto-fill, minmax(240px,1fr))`).
- **Wireframe/Layout**:
  ```
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │ Marketing   │ │ Engineering │ │ Onboarding  │
  │ Launch      │ │ Sprint 12   │ │ Revamp      │
  │ Q3 campaign │ │             │ │ New-hire... │
  └─────────────┘ └─────────────┘ └─────────────┘
  ```
- **Pros**:
  - More visually engaging "product landing page" feel
  - Scales reasonably to many boards without becoming a long scroll
- **Cons**:
  - Grid reflow (columns-per-row) needs explicit CSS work the list doesn't
  - Slightly more component/CSS surface for a read-only MVP feature — cuts against simplicity-first
  - No functional benefit over A1 for the stated goal ("find and open the right board quickly")
- **Usability**: High
- **Accessibility**: High (same underlying link/list semantics, more visual styling to keep contrast-compliant)
- **Implementation Complexity**: Medium

### Option A3: Data Table
- **Approach**: An HTML `<table>` with columns for Name, Description, (maybe Created date), each row clickable/row-level link.
- **Pros**: Great for scanning many boards with multiple attributes at once.
- **Cons**: Tables reflow poorly on phones (require horizontal scroll or a card-collapse hack); `Board` only has two user-facing fields today, so a table's extra structure buys nothing; clickable table rows are a known a11y anti-pattern (the whole `<tr>` isn't natively focusable/activatable — requires extra ARIA work to do correctly).
- **Usability**: Medium
- **Accessibility**: Medium (achievable but requires more deliberate ARIA than A1/A2)
- **Implementation Complexity**: Medium-High

### Evaluation Matrix — Board List
| Criteria | A1: Link List | A2: Card Grid | A3: Table |
|----------|----|----|----|
| Usability | High | High | Medium |
| Accessibility | High | High | Medium |
| Consistency (simplicity-first) | High | Medium | Low |
| Responsiveness | High (free) | Medium (needs grid breakpoints) | Low (needs collapse pattern) |
| Performance | High | High | High |
| Implementation Effort | Low | Medium | Medium-High |

---

### B. Board View — Three-Column Layout & Mobile Reflow Options

### Option B1: CSS Grid, Stacked Reflow on Mobile
- **Approach**: Desktop/tablet: `display:grid; grid-template-columns: repeat(3, 1fr)` — three fixed columns side by side, board-shaped. Below a breakpoint (e.g. `<640px`), the grid switches to `grid-template-columns: 1fr` (single column), so the three column `<section>`s stack **vertically in DOM order** (To Do, then In Progress, then Done), each still full-width with its own header and card list.
- **Wireframe/Layout** (desktop):
  ```
  ┌─────────────────────────────────────────────────────┐
  │ ← Boards        Marketing Launch                     │
  ├─────────────┬─────────────────┬─────────────────────┤
  │ To Do (2)   │ In Progress (1) │ Done (0)             │
  │ ┌─────────┐ │ ┌─────────────┐ │ No cards             │
  │ │Card A   │ │ │Card C       │ │                      │
  │ │due 8/1  │ │ │             │ │                      │
  │ └─────────┘ │ └─────────────┘ │                      │
  │ ┌─────────┐ │                 │                      │
  │ │Card B   │ │                 │                      │
  │ └─────────┘ │                 │                      │
  └─────────────┴─────────────────┴─────────────────────┘
  ```
  Wireframe (phone, stacked):
  ```
  ┌───────────────────┐
  │ ← Boards           │
  │ Marketing Launch   │
  ├───────────────────┤
  │ To Do (2)          │
  │ ┌───────────────┐  │
  │ │Card A due 8/1 │  │
  │ └───────────────┘  │
  │ ┌───────────────┐  │
  │ │Card B         │  │
  │ └───────────────┘  │
  ├───────────────────┤
  │ In Progress (1)    │
  │ ┌───────────────┐  │
  │ │Card C         │  │
  │ └───────────────┘  │
  ├───────────────────┤
  │ Done (0)           │
  │ No cards           │
  └───────────────────┘
  ```
- **User Flow**: Read top-to-bottom (mobile) or left-to-right (desktop); no interaction required to see every column's contents.
- **Pros**:
  - All three columns' contents are always visible with plain scrolling — matches Priya's "see status at a glance" goal even on a phone
  - Zero extra interaction/state (no tabs, no swipe/scroll-snap JS) — simplest possible implementation, one CSS breakpoint
  - Natural DOM/tab order = natural reading order on every screen size; nothing extra needed for keyboard users or screen readers
  - No custom touch-gesture handling to get wrong from an a11y perspective
- **Cons**:
  - Loses the classic "kanban board" side-by-side visual metaphor on phones (columns become sections in a long scroll)
  - A board with many cards in one status makes the page long to scroll on mobile — acceptable at MVP card volumes, revisit if boards grow to hundreds of cards
- **Usability**: High
- **Accessibility**: High
- **Implementation Complexity**: Low

### Option B2: Horizontal Scroll-Snap (Trello-style) on Mobile
- **Approach**: Columns stay side-by-side at all widths; on narrow screens the column container becomes a horizontally scrollable strip with CSS `scroll-snap-type: x mandatory`, so swiping snaps one column into view at a time.
- **Pros**: Preserves the spatial "board" metaphor across all breakpoints; feels native to users coming from Trello.
- **Cons**: Only one column visible at a time on a phone — actively works against "see status at a glance" (user must swipe to see In Progress/Done); horizontal swipe gestures are harder to discover for keyboard-only and some screen-reader users, and scroll-snap containers need extra ARIA/testing care to keep fully keyboard-operable; more implementation and cross-browser testing surface for zero net accessibility or task-completion benefit here since there's no drag-drop to preserve spatial mental model for.
- **Usability**: Medium (mobile requires an extra gesture to see all data)
- **Accessibility**: Medium (achievable, but higher risk of keyboard-trap / focus-order bugs)
- **Implementation Complexity**: Medium

### Option B3: Tab/Segmented Switcher on Mobile
- **Approach**: On mobile, replace the 3-column grid with a tab strip ("To Do | In Progress | Done") that shows one column's cards at a time; desktop/tablet keeps the 3-column grid.
- **Pros**: Compact; each screen shows one focused list.
- **Cons**: Hides two-thirds of the board's status by default — directly conflicts with the "glance at progress" goal for Sam/Priya on mobile; introduces a stateful tab component (roving tabindex, `aria-selected`, panel show/hide) — meaningfully more component and test surface for a read-only MVP; two different layout paradigms (grid vs. tabs) to build, style, and test instead of one.
- **Usability**: Medium
- **Accessibility**: Medium (tabs are a well-known but non-trivial ARIA pattern to get fully right)
- **Implementation Complexity**: Medium-High

### Evaluation Matrix — Board View
| Criteria | B1: Stacked Reflow | B2: Scroll-Snap | B3: Tab Switcher |
|----------|----|----|----|
| Usability | High | Medium | Medium |
| Accessibility | High | Medium | Medium |
| Consistency (simplicity-first) | High | Medium | Low |
| Responsiveness | High | Medium | Medium |
| Performance | High | High | High |
| Implementation Effort | Low | Medium | Medium-High |

## Decision

**Chosen**: **Option A1 (Semantic Link List)** for the board list page, combined with **Option B1 (CSS Grid with Stacked Mobile Reflow)** for the board view.

### Rationale
- **User-centered**: Priya's core goal is "see status at a glance." B1 is the only board-view option that keeps every column's contents visible with plain scrolling on every device — B2 and B3 both hide two of three columns behind a gesture or tab click on the exact device class (phone) where Marco is most likely to be checking his work. For the board list, A1's plain, information-dense rows let Priya/Marco/Sam scan and pick a board with a single visual pass — a card grid (A2) adds visual polish the read-only MVP doesn't need, and a table (A3) actively fights mobile responsiveness and clickable-row accessibility.
- **Accessibility-first**: Both chosen options rely entirely on native, well-supported HTML semantics (`<ul>/<li>/<a>` for the list; `<section>`/heading/`<ul>` for columns) with zero custom keyboard or gesture handling to get wrong. This directly serves the WCAG 2.1 AA requirement with the least implementation risk. B2/B3 are achievable but demand materially more ARIA and manual-testing effort for a downgrade in "glanceability."
- **Simplicity-first (Guiding Principle)**: A1 + B1 is implementable with one `<ul>` and one CSS Grid + a single breakpoint — no new interactive component (tabs, scroll-snap containers) is introduced. This matches `systemPatterns.md`'s mandate to add abstraction only when a concrete need appears, and keeps the frontend's first component set as shallow as the existing backend's layering.
- **Performance**: Both are static-markup-plus-CSS; no JS-driven layout/gesture logic to execute, keeping first render fast and comfortably under the <1s board-load target.

### Trade-offs Accepted
- **Long mobile scroll on heavily-loaded columns**: if a single status accumulates dozens of cards, B1 turns that column into a long stack on phones. Acceptable at MVP data volumes (a handful to a few dozen cards per board); if this becomes a real problem, a future iteration can add lightweight column collapsing — not needed now.
- **Less "board" visual metaphor on phones**: B1 reads as stacked sections rather than a side-by-side board on narrow screens. This is an intentional trade favoring glanceability and accessibility over visual metaphor fidelity; the column headers (with counts) preserve the "status buckets" mental model even when stacked.
- **Plainer visual style for the board list (A1 vs A2)**: rows are less "gallery-like" than tiles. Acceptable because the read-only MVP's job is fast selection, not browsing/discovery; a card grid can be revisited later without touching data flow if the product wants a richer landing page.

## Design Specifications

### Layout
- **Desktop (>1024px)**: Board list — single centered column of rows, max-width ~720px, generous row padding. Board view — header bar (`← Boards` back-link + board name as `<h1>`) above a 3-column CSS Grid, equal-width columns with a visible gap and column-header row (label + count) pinned at the top of each column.
- **Tablet (640–1024px)**: Same structural layout as desktop; columns simply narrower (grid is fluid — `1fr 1fr 1fr`), spacing/padding tightened slightly.
- **Mobile (<640px)**: Board list — same single-column row list, full width, edge-to-edge padding. Board view — grid collapses to a single column (`grid-template-columns: 1fr`); the three column `<section>`s stack vertically in fixed order (To Do → In Progress → Done), each retaining its own header + card list; the board header (back-link + name) stays pinned above the stack, not sticky (keep it simple — no sticky-header JS/CSS complexity for MVP).

### Key Components
| Component | Purpose | Behavior |
|-----------|---------|----------|
| `BoardListPage` | Route `/`; orchestrates fetch of `GET /boards` and renders the correct state | Holds `status: 'loading' \| 'success' \| 'error'` derived from the data hook; renders `Loading`, `ErrorState`, `EmptyState`, or `BoardList` |
| `BoardList` | Renders the `<ul>` of boards | Pure presentational; maps `boards[]` to `BoardListItem` |
| `BoardListItem` | One clickable board row | Wraps the whole row in a single `<Link to={`/boards/${id}`}>`; shows `name` (strong/heading weight) and `description` (secondary text) if present |
| `BoardViewPage` | Route `/boards/:id`; orchestrates fetch of `GET /boards/:id` + `GET /cards?board_id=:id` | Combines both requests' status into one state machine: `loading` (either pending) → `notFound` (board 404) → `error` (either failed, non-404) → `success`; renders `BoardHeader` + `Columns` on success |
| `BoardHeader` | Shows board name + back link | `<Link to="/">← Boards</Link>` followed by `<h1>{name}</h1>` |
| `Columns` | Lays out the three fixed columns | Partitions `cards[]` into `todo`/`in_progress`/`done` buckets once (pure function, not per-column re-filter); always renders all three `Column`s regardless of counts |
| `Column` | One status column | Renders a header (`<h2>` label + count, e.g. "To Do (2)") and either a `<ul>` of `Card`s or a `ColumnEmpty` "No cards" message |
| `Card` | One card summary | Renders `title` (e.g. `<h3>` or strong text), optional `description` (truncated/secondary), optional `due_date` (formatted, with a text label like "Due:" — never date-only with a bare color cue) |
| `Loading` (shared) | Loading indicator, reused by both pages | Visible text "Loading…" plus a spinner graphic marked `aria-hidden="true"`; wrapping region uses `aria-live="polite"` so screen readers announce the transition |
| `ErrorState` (shared) | Recoverable error, reused by both pages | Visible error message + a `<button>` "Retry" that re-invokes the failed fetch(es); message region uses `role="alert"` |
| `EmptyState` (shared) | "No boards" / "no cards" | Plain text message component, parameterized by copy (`"No boards yet."` / `"No cards"`) |
| `NotFoundState` (board view only) | Distinct 404 presentation | Visible "Board not found" message, styled/structured distinctly from `ErrorState` (no Retry button, since retrying won't fix a 404), plus a `<Link to="/">Back to boards</Link>` |

### Interactions
| Trigger | Action | Feedback |
|---------|--------|----------|
| Page load (`/` or `/boards/:id`) | Fetch fires | `Loading` renders immediately; replaced on resolution |
| Click/Enter/Space on a board row | Client-side navigation to `/boards/:id` | Browser URL changes; `BoardViewPage` mounts and begins its own loading state |
| Click/Enter/Space on "Retry" | Re-fires the failed fetch(es) in place | Returns to `Loading`, then `success`/`error` again — no full page reload, no state loss elsewhere |
| Click/Enter/Space on "Back to boards" (404 state or header back-link) | Client-side navigation to `/` | `BoardListPage` mounts; if boards were already fetched this session, a simple re-fetch-on-mount is acceptable (no caching requirement at MVP) |
| Keyboard `Tab` | Moves focus between board rows, column cards' links (if any), Retry/Back buttons | Visible focus outline on every focusable element (never `outline: none` without a replacement indicator) |

### Responsive Behavior
| Breakpoint | Changes |
|------------|---------|
| < 640px | Board view: `grid-template-columns: 1fr`; columns stack vertically in fixed order (To Do, In Progress, Done). Board list: unchanged (rows are already full-width and block-level). |
| 640–1024px | Board view: `grid-template-columns: repeat(3, 1fr)`, tighter gaps/padding than desktop. Board list: unchanged, max-width container may shrink to viewport. |
| > 1024px | Board view: `grid-template-columns: repeat(3, 1fr)` with comfortable gap/padding, content max-width centered. Board list: centered column, max-width ~720px. |

### Accessibility Requirements
- [x] Keyboard navigation support — every interactive element is a native `<a>`/`<button>` (board rows, Retry, Back-to-boards); no `onClick`-only `<div>`s; natural DOM order is the tab order on every breakpoint (no CSS-only visual reordering that breaks tab order).
- [x] Screen reader compatibility — board list is a real `<ul>`/`<li>` list (announces item count/position); each board row is one link with an accessible name that includes both name and description (e.g. via visually-hidden text or `aria-label` combining both, so the whole row's context is announced, not just "Marketing Launch"); each column is a `<section aria-labelledby="col-todo-heading">` with its own `<h2>` so screen-reader users can jump column-to-column via heading navigation; cards are list items with the title as the primary announced text.
- [x] Color contrast compliance (WCAG AA) — text/background pairs meet 4.5:1 (normal text) / 3:1 (large text/UI components); any column accent color (e.g., a subtle left-border or header background tint) is decorative only.
- [x] Visible focus indicators — a visible `:focus-visible` outline (browser default retained or a custom outline with sufficient contrast) on every link/button; never removed without a replacement.
- [x] Error messages accessible — `ErrorState` message region uses `role="alert"` so it's announced without requiring focus to move; `NotFoundState` message is a normal heading/text (not urgent, but clearly distinct in wording: "Board not found" vs. generic "Something went wrong").
- [x] Status/column not color-alone — every column always shows its **text label** ("To Do" / "In Progress" / "Done") plus a numeric count as its `<h2>`, regardless of any background/accent color used for visual grouping; card status is therefore conveyed by column membership + a persistent text heading, never by a color chip alone.

## Implementation Guidelines

### For Developers
1. Build the four shared state components (`Loading`, `ErrorState`, `EmptyState`, `NotFoundState`) first, in Phase 1/2 — both pages reuse them, keeping the state-handling logic (and its accessibility behavior) written once.
2. Model each page's data-fetching as a single state machine (`'loading' | 'error' | 'notFound' | 'success'`, plus `'empty'` as a derived case of `'success'` with zero items) rather than ad hoc boolean flags — this keeps the "never show stale/blank content while pending" requirement (AC-ASYNC-1) mechanically enforced: the render function is a switch over one state value.
3. Partition `cards[]` into the three status buckets with one pure function (e.g. `groupCardsByStatus(cards): Record<CardStatus, Card[]>`) called once per render, seeded with all three keys defaulting to `[]` — this guarantees a column with zero matches still renders (never `undefined`/omitted), satisfying AC-HAPPY-6 by construction.
4. Use the router's own `Link`/navigation primitive for every board row and back-link (not a manual `onClick` + `history.push`) so keyboard activation, right-click "open in new tab," and screen-reader link semantics all work for free.
5. Format `due_date` with an explicit text label (e.g., "Due Jul 20") rather than a bare date or a color-only overdue indicator; if a future iteration wants to flag overdue cards, pair any color with a text/icon cue (do not introduce color-only signaling later without revisiting this doc).
6. Do not build a column-count/style variant per status (e.g., don't hardcode "Done is green, To Do is grey" as the only distinguishing feature) — the text heading is the accessible source of truth; color is decoration only.

### Component Structure
```
src/
├── pages/
│   ├── BoardListPage/
│   │   ├── BoardListPage.tsx
│   │   ├── BoardListPage.test.tsx
│   │   ├── BoardList.tsx
│   │   └── BoardListItem.tsx
│   └── BoardViewPage/
│       ├── BoardViewPage.tsx
│       ├── BoardViewPage.test.tsx
│       ├── BoardHeader.tsx
│       ├── Columns.tsx
│       ├── Column.tsx
│       └── Card.tsx
├── components/
│   ├── Loading.tsx
│   ├── ErrorState.tsx
│   ├── EmptyState.tsx
│   └── NotFoundState.tsx
└── hooks/            (or wherever the Architecture creative places data-fetching)
    ├── useBoards.ts
    ├── useBoard.ts
    └── useCards.ts
```
(Exact placement of `hooks/`/`api/` and the bundler/test-runner choice belong to the parallel Architecture Design creative phase; the component tree above is framework-idiomatic React and does not assume a specific router/bundler.)

### Recommended Libraries/Patterns
- **No component/design-system library** (no MUI, Chakra, Ant, etc.) — plain semantic HTML + a small amount of hand-written CSS (plain CSS or CSS Modules, whichever the Architecture creative's bundler makes idiomatic) is sufficient for a two-page, read-only MVP and matches the project's simplicity-first Guiding Principle; pulling in a UI kit for two pages and four shared state components would be the "clever abstraction" the principle warns against.
- **CSS Grid** for the 3-column board layout (native, no layout library needed) with a single mobile breakpoint media query for the stacked reflow.
- **Native `<ul>/<li>/<a>` and `<section>/<h2>`** for lists/columns — no custom "card" or "list" component library needed beyond the project's own `Card`/`Column`/`BoardListItem` components.

## Validation Checklist

- [x] Meets all user goals — glanceable status (B1), fast board selection (A1), graceful recovery (shared state components)
- [x] Accessible per requirements — native semantics throughout, non-color status encoding, visible focus, alert regions for errors
- [x] Consistent with existing patterns — no existing frontend patterns to conflict with; aligns with backend's plain, unadorned style
- [x] Respects Guiding Principles and component architecture in systemPatterns.md — shallow component tree, no premature abstraction, no unneeded library
- [x] Responsive across devices — one breakpoint, CSS-only reflow, no device-specific JS
- [x] Performance acceptable — static markup + CSS, no gesture/tab JS, fits the <1s board-load target
- [x] Implementation feasible — matches the phase plan in `tasks/TASK-004.md` (Phase 2 = list, Phase 3 = view+columns) with no new dependencies required beyond what Architecture creative selects

## Next Steps

1. Architecture Design creative phase finalizes bundler/router/API-client/CORS choices; this doc's component tree slots into that structure without modification.
2. Phase 2 build: implement `BoardListPage` + `BoardList`/`BoardListItem` + shared `Loading`/`ErrorState`/`EmptyState`, per the A1 spec above.
3. Phase 3 build: implement `BoardViewPage` + `BoardHeader`/`Columns`/`Column`/`Card` + `NotFoundState`, per the B1 spec above, including the `groupCardsByStatus` pure function and the mobile stacked-reflow breakpoint.
4. `/banyan-uat` should specifically verify: keyboard-only traversal of both pages, screen-reader announcement of column headers + counts, and the visual (non-screen-reader) confirmation that status is legible without color at each breakpoint.
