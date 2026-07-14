# UI/UX Decision: Realtime Activity Feed (Frontend)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: UI/UX
**Task**: TASK-005 (Level 4, FEAT-005)
**Scope**: Frontend feed UX only — resolves creative Q5 (surface/placement, content/ordering, the five connection states, accessibility). Transport, capture, persistence, and fan-out (Q1–Q4) are already decided in `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md` and are treated as fixed inputs here.

## User Context

### Target Users
- **Primary**: Priya (Team Lead / Project Coordinator) — her core goal is "see status at a glance… keep cards flowing to Done." A live feed is a direct, passive expression of that goal: she should not have to do anything to notice work moving.
- **Secondary**: Marco (Contributor) — his own moves appear in the feed, closing the "did that register?" loop; frequently on a phone, where screen space for a live feed is scarcest. Sam (Stakeholder/Observer) — glances at progress without editing; benefits from ambient awareness without needing to learn a new interaction.

All three are **read-only consumers** of the feed (per Scope Boundaries, no write actions from the feed; jump-to-card is at most a COULD, not designed here).

### User Goals
1. Notice a card move on "my" board without refreshing or hunting for it (Priya, Sam).
2. Confirm my own move registered (Marco).
3. Trust the feed even when the connection hiccups — see that it's catching up, not conclude the app is broken (all three).

### Use Cases
| Use Case | User | Goal | Frequency |
|----------|------|------|-----------|
| UC1: Ambient watch | Priya | Glance at the board and feed together while other work happens | Continuous, while a board tab is open |
| UC2: Confirm my move | Marco | See his own status change appear after a `PATCH` | Several times/day |
| UC3: Reopen after time away | Priya/Sam | Re-open a board and see recent history, not a blank feed | Daily |
| UC4: Ride out a network blip | Any | See a clear "reconnecting" cue, not silence or a scary error | Occasional |
| UC5: Cope with a hard outage | Any | Understand the feed is degraded (not that nothing has happened) while the rest of the board keeps working | Rare |

### Constraints
- **Devices**: Same as FEAT-004 — evergreen browsers, responsive web from ~360px through desktop (`memory-bank/productBrief.md` Browser/Platform Support).
- **Accessibility**: WCAG 2.1 AA — status not by color alone, visible focus, correct roles/names, and (new to this feature) a live region that announces new items **without** interrupting or overwhelming assistive tech (AC-HAPPY-2).
- **Existing Patterns that must be respected** (from `memory-bank/creative/TASK-004-react-frontend-uiux.md` and `frontend/src/`):
  - Board view is a single page (`BoardViewPage.tsx`) rendering `<BoardHeader/>` + `<Columns/>` inside `<main className="board-view">`; the 3-column CSS Grid (`.columns`) collapses to one column below 640px (`frontend/src/index.css`).
  - Shared state components: `Loading` (`aria-live="polite"`), `ErrorState` (`role="alert"`, optional Retry), `EmptyState` (plain text), `NotFoundState`. Reused, not reinvented, where they fit.
  - Async state is modeled as one state-machine value, not ad hoc booleans (`useApiResource`'s `ResourceState`); the new stream hook should mirror this shape.
  - Plain CSS, no component library, shallow component tree, one file per responsibility (`Column.tsx`, `Card.tsx`, etc.) — matches `systemPatterns.md`'s simplicity-first Guiding Principle.
  - Column status is conveyed by a **persistent text heading**, never color alone — the feed must follow the same rule for card moves.
- **Fixed architecture inputs** (from the Architecture creative — not re-decided here):
  - Transport: native `EventSource` against `GET /api/activity/stream?board_id=`.
  - Backfill: most recent `ACTIVITY_BACKFILL_LIMIT` (default 50) events sent on connect, oldest→newest.
  - Reconnect: browser-native, resends `Last-Event-ID`; missed events replay automatically, oldest→newest, as ordinary `card_moved` frames — the wire protocol does **not** distinguish "this is backfill/replay" from "this is a brand-new live event." That distinction, where it matters for UX, is made client-side (see Accessibility below).
  - Payload: `id`, `board_id`, `card_id` (nullable — survives card deletion), `card_title` (denormalized, always present), `from_status`, `to_status`, `created_at`.
  - No actor/no auth: every item must read correctly with no user identity available.

## User Flow

### Flow Diagram
```
[BoardViewPage success state] → [ActivityFeed mounts with board id]
        │
        ▼
   [connecting] ── EventSource opens, awaiting first frames
        │
        ▼ (backfill frames arrive, silently rendered)
   [open, has items] ◀────────────────────────────┐
        │  new card_moved frame arrives            │
        ▼                                          │
   [item prepended to top, announced to AT]         │
        │                                          │
        │  connection drops                        │
        ▼                                          │
   [reconnecting] — banner shown ABOVE existing list │
        │  EventSource auto-reconnects,             │
        │  resends Last-Event-ID                    │
        ├─ success → replay frames arrive ──────────┘ (silent catch-up, same as backfill)
        │
        └─ repeated failure past threshold
                 ▼
           [degraded] — explicit offline banner, list frozen but visible,
                        rest of board (columns) unaffected
```

### Flow Description
1. **Entry**: `BoardViewPage` reaches its `success` state (board + cards loaded) → `<ActivityFeed boardId={id} />` mounts next to `<Columns />` (AC-ENTRY-1). The feed never mounts on a loading/error/404 board view — there is no valid board to scope it to yet.
2. **Step 1 (connecting)**: `useActivityStream` opens the `EventSource`; until the first frame (or a decision that none exist) arrives, the region shows the shared `Loading` component with feed-specific copy.
3. **Step 2 (backfill, silent)**: Up to 50 historical frames arrive rapidly; rendered into the list, newest-first, with **no** assistive-tech announcement (a wall of history read aloud on page load would be worse than useless — see Accessibility).
4. **Step 3 (open, streaming)**: Once the initial burst settles, the feed is "armed" — the next `card_moved` frame is a genuinely new live event: prepended to the top of the list and announced once, politely, to assistive tech (AC-HAPPY-1/2).
5. **Decision Point — connection health**: On a network drop, the hook enters `reconnecting`; the existing list stays exactly as it was (nothing hidden, nothing cleared) with a small non-blocking banner. If the browser's automatic retries keep failing past a client-side threshold, the hook enters `degraded` (AC-ERROR-1).
6. **Exit**: There is no "exit" the user performs — the feed lives for as long as the board view is mounted; navigating away (back to `/` or to another board) unmounts it, closing the `EventSource` cleanly.

### Error States
| Error | Cause | User Recovery |
|-------|-------|----------------|
| Feed never leaves "connecting" | Slow first response / server briefly unavailable at page load | No action needed — the connection keeps trying; if it exceeds the degraded threshold it surfaces the degraded banner rather than spinning forever |
| Reconnecting shown | Network blip, server restart | None required — auto-recovers; existing items remain visible and interactive throughout |
| Degraded/offline shown | Transport repeatedly fails to (re)establish | None required from the user; the rest of the board (columns, cards) is unaffected and remains fully usable. The banner clears itself automatically once a frame is received again |
| Empty feed (connected, no history) | Board genuinely has no card-movement events yet | Not an error — calm "No activity yet" message, distinct in wording and tone from the degraded banner |

## Options Explored

Three placement/surface options were considered, each evaluated with both a desktop and a mobile sketch, since the existing 3-column grid (`.columns`) already collapses at 640px and any new region must slot into — not fight — that reflow.

---

### Option 1: Persistent Side Panel (always rendered, reflows by breakpoint)
- **Approach**: The feed is a 4th region, always present, occupying a fixed-width column to the right of the 3 status columns on desktop; it moves below the columns as a full-width band on tablet; it stacks as the final section (after Done) on mobile — extending exactly the same reflow logic FEAT-004 already established for the 3 columns, just adding one more region to the same responsive scheme.
- **Wireframe (desktop, >1024px)**:
  ```
  ┌────────────────────────────────────────────────────────────────────────┐
  │ ← Boards        Marketing Launch                                       │
  ├─────────────┬─────────────────┬──────────────┬─────────────────────────┤
  │ To Do (2)   │ In Progress (1) │ Done (0)     │ Activity                │
  │ ┌─────────┐ │ ┌─────────────┐ │ No cards     │ Someone moved           │
  │ │Card A   │ │ │Card C       │ │              │ "Deploy pipeline" from  │
  │ │due 8/1  │ │ │             │ │              │ In Progress to Done     │
  │ └─────────┘ │ └─────────────┘ │              │ Jul 15, 2:41 PM         │
  │ ┌─────────┐ │                 │              │ ──────────────────     │
  │ │Card B   │ │                 │              │ Someone moved "Card A"  │
  │ └─────────┘ │                 │              │ from To Do to Done …   │
  └─────────────┴─────────────────┴──────────────┴─────────────────────────┘
  ```
- **Wireframe (mobile, <640px)**:
  ```
  ┌───────────────────┐
  │ ← Boards           │
  │ Marketing Launch   │
  ├───────────────────┤
  │ To Do (2)          │
  │  … cards …         │
  ├───────────────────┤
  │ In Progress (1)    │
  │  … cards …         │
  ├───────────────────┤
  │ Done (0)           │
  │ No cards           │
  ├───────────────────┤
  │ Activity           │
  │ Someone moved      │
  │ "Deploy pipeline"  │
  │ from In Progress   │
  │ to Done · 2:41 PM  │
  └───────────────────┘
  ```
- **Pros**:
  - Zero new interaction pattern — no toggle, no route, no ARIA disclosure widget to get right; extends B1's proven reflow instead of inventing a second one.
  - Ambient by construction — the entire point of a live feed (notice without acting) is served by default, matching Priya's "at a glance" goal.
  - Same DOM/tab order = reading order on every breakpoint, exactly like the existing columns.
- **Cons**:
  - Permanently consumes vertical space on mobile, pushing nothing above it out of the way (it's the last section, so this is minor) but does lengthen the page.
  - A very chatty board has no way to collapse the feed if a user wants to reclaim space (accepted trade-off, see Decision).
- **Usability**: High
- **Accessibility**: High
- **Implementation Complexity**: Low

### Option 2: Collapsible Drawer (toggle open/closed)
- **Approach**: A button in the board header ("Activity") toggles a panel: inline 4th column on desktop when open, an off-canvas/bottom-sheet overlay on mobile when open. Closed by default on narrow screens to preserve column width.
- **Wireframe (desktop, open)**: same visual as Option 1's desktop sketch, plus a `<button aria-expanded="true" aria-controls="activity-feed">Activity ▲</button>` in the header.
- **Wireframe (mobile, closed → open)**:
  ```
  ┌───────────────────┐        ┌───────────────────┐
  │ ← Boards [Activity]│  tap → │ ░░░ overlay ░░░░░░ │
  │ Marketing Launch   │        │ Activity      [X] │
  ├───────────────────┤        │ Someone moved      │
  │ To Do (2)          │        │ "Deploy pipeline"  │
  │  … cards …         │        │ from In Progress   │
  │  (columns unaffected)      │ to Done · 2:41 PM  │
  └───────────────────┘        └───────────────────┘
  ```
- **Pros**: Never crowds the primary column view when closed; one interaction pattern (disclosure) scales to every breakpoint.
- **Cons**: Adds a stateful open/close affordance, focus management on open/close (return focus to the toggle on dismiss), and — critically — if the panel is closed by default and the `EventSource` is only opened on first expand, a user who never opens it never sees the live confirmation AC-HAPPY-1 wants ("without her reloading the page **or taking any action**"). Keeping the stream connected even while closed (to satisfy that AC) means building an unread-count/badge affordance to avoid feeling broken ("it says there's activity but I have to click to see what") — real added scope no AC asks for. Meaningfully more component and test surface (disclosure ARIA, focus trap on mobile overlay) for a feature whose explicit design goal is passive awareness.
- **Usability**: Medium (extra step to see content by default)
- **Accessibility**: Medium (disclosure + focus-trap patterns are well-known but non-trivial to get fully right, versus Option 1's zero new patterns)
- **Implementation Complexity**: Medium

### Option 3: Dedicated Route (`/boards/:id/activity`)
- **Approach**: A separate page reachable via a link from the board view; the board view itself carries no feed content, only a nav link out.
- **Wireframe**: Board view unchanged (as in FEAT-004's B1); a new full page shows only the feed, with a back-link to the board.
- **Pros**: Zero crowding of the board view at all; simplest possible per-page code, consistent with the existing `pages/` split (`BoardListPage`, `BoardViewPage`).
- **Cons**: **Directly conflicts with the Specification.** AC-ENTRY-1 requires the feed region to be visible "on the board view" at `/boards/:id`, and the task's own Success Criteria states the panel must be "Verifiable at: The Activity panel **on `/boards/:id`**" — a link to a different route does not satisfy either sentence as written; a strict test at `/boards/:id` would find no feed region present. It also structurally prevents the exact AC-HAPPY-1 scenario (Priya watching the feed **and** the columns update together) without a navigation round-trip, undermining the "board feels live" vision statement in the task's Architectural Plan.
- **Usability**: Low (for this feature's stated goal — an extra navigation is the opposite of "at a glance")
- **Accessibility**: High (a full page is trivial to make accessible in isolation) but this scores irrelevant given the Usability/fit failure above
- **Implementation Complexity**: Low

## Evaluation Matrix

| Criteria | Option 1: Persistent Panel | Option 2: Collapsible Drawer | Option 3: Dedicated Route |
|----------|----|----|----|
| Usability | High | Medium | Low (fails "at a glance" goal) |
| Accessibility | High | Medium | High (in isolation; moot) |
| Consistency (simplicity-first, extends B1) | High | Medium | Low (new page for zero benefit) |
| Responsiveness | High (reuses existing breakpoint scheme + one addition) | Medium (needs overlay/focus-trap on mobile) | High (board view untouched) |
| Performance | High (static layout, no gesture JS) | Medium (open/close transition, focus management) | High |
| Implementation Effort | Low | Medium-High | Low (but wrong shape — fails ACs) |
| Satisfies AC-ENTRY-1 / Success Criteria literally | Yes | Yes | **No** |

## Decision

**Chosen**: **Option 1 — Persistent Side Panel**, reusing and extending the exact responsive reflow pattern FEAT-004 established for the 3-column grid.

### Rationale
- **User-centered**: The feed's entire value proposition is passive, ambient awareness ("the board updates itself" — Architectural Plan Vision). Any interaction required to see it (Option 2's toggle) or any navigation away from the columns (Option 3's route) works against that vision for exactly the personas who benefit most: Priya glancing while doing other work, Sam observing without editing.
- **Spec-literal fit**: Option 3 is rejected on more than preference — it does not satisfy AC-ENTRY-1 or the Success Criteria's explicit "on `/boards/:id`" language. Option 1 and 2 both satisfy it (same route either way), but Option 1 satisfies it **by default**, with no user action, matching AC-HAPPY-1's "without her reloading the page or taking any action."
- **Simplicity-first (systemPatterns.md Guiding Principle)**: Option 1 introduces exactly one new responsive rule extending a scheme that already exists (3 columns → 3 columns + 1 panel), with no new interaction primitive (no disclosure widget, no focus trap, no overlay). Option 2's toggle is a second UI pattern the FEAT-004 UI/UX doc deliberately avoided introducing for tabs/scroll-snap on the same grounds ("no custom keyboard or gesture handling to get wrong").
- **Accessibility**: Fewer new ARIA responsibilities (no `aria-expanded`/focus-trap to get right) means less surface area for a11y regressions, directly serving the WCAG 2.1 AA mandate with the least implementation risk — the same argument FEAT-004's UI/UX doc used to reject its own tab-switcher option.

### Trade-offs Accepted
- **No collapse/hide affordance in this iteration**: a very chatty board has no way to shrink the feed to reclaim space. No AC requires this. If board activity volume becomes a real problem, a lightweight `<details>`-based collapse (native disclosure semantics, no custom JS) is the natural, cheap follow-up — flagged as a future enhancement, not built now.
- **Permanent vertical cost on mobile**: the feed is the last section after Done, lengthening the page. Accepted because it never displaces the columns (which stay first in DOM/reading order) and matches the "supplementary, not primary" information hierarchy AC-ENTRY-1 implies ("distinct from the three status columns").

## Design Specifications

### Layout
- **Desktop (>1024px)**: `.columns` grid extends from `repeat(3, 1fr)` to `repeat(3, 1fr) minmax(260px, 320px)`; the feed occupies the 4th track, full column height, its own internal scroll region only if it grows past a generous max-height (avoids the page growing unboundedly tall on a very active board while still not adding scroll-snap/gesture complexity — a plain `overflow-y: auto` block, no custom scrollbar styling).
- **Tablet (640–1024px)**: the 3 status columns keep their existing `repeat(3, 1fr)` row (unchanged from FEAT-004); the feed drops to a **new row below**, full width, so the status columns are never squeezed to accommodate it. This is one new grid row, not a new breakpoint concept — same `.columns` grid, extra content flows into a `grid-column: 1 / -1` region beneath.
- **Mobile (<640px)**: identical structural idea, but the whole grid is already `1fr` (columns stacked per FEAT-004's B1); the feed is simply the 4th stacked section, after Done, in DOM order.

### Key Components
| Component | Purpose | Behavior |
|-----------|---------|----------|
| `ActivityFeed` (`frontend/src/pages/BoardViewPage/ActivityFeed.tsx`) | The feed region; owns `useActivityStream(boardId)` and renders the correct state | `<section aria-labelledby="activity-feed-heading">` with `<h2 id="activity-feed-heading">Activity</h2>`, mirroring `Column`'s `aria-labelledby` pattern exactly. Renders `Loading` (connecting, no items yet), `EmptyState` (open, zero items), the item list + hidden announcer (has items), and `ActivityFeedStatus` layered above the list during reconnecting/degraded |
| `useActivityStream` (`frontend/src/hooks/useActivityStream.ts`) | Client state machine over the SSE connection | Mirrors `useApiResource`'s single-state-value discipline: `{ status: 'connecting' \| 'open' \| 'reconnecting' \| 'degraded', items: ActivityEvent[], announcement: { seq: number; text: string } \| null }`. Manages the backfill/live "arming" heuristic (see Accessibility) and the degraded-threshold timer |
| `frontend/src/api/activityStream.ts` | Single seam that opens `new EventSource('/api/activity/stream?board_id=' + id)` | Mirrors the `api/client.ts` discipline — the only place in the frontend that touches `EventSource` directly, so `useActivityStream.test.ts` can substitute a fake |
| `ActivityFeedItem` (`frontend/src/pages/BoardViewPage/ActivityFeedItem.tsx`) | One rendered event | Renders the phrased sentence + a `<time dateTime={created_at}>` formatted timestamp; pure/presentational, one per `<li>` |
| `ActivityFeedStatus` (`frontend/src/pages/BoardViewPage/ActivityFeedStatus.tsx`) — **new, feed-local** | The reconnecting/degraded banner, layered above the list (never replacing it) | `tone: 'reconnecting' \| 'degraded'` prop controls copy + role (`status` vs `alert`); colocated under `pages/BoardViewPage/` rather than `components/` because it is SSE-connection-specific wording with exactly one consumer today — promoting it to a shared component is deferred until a second realtime surface needs it (same "add abstraction only on concrete need" principle FEAT-004 already applied) |
| `Loading` (existing, reused) | Connecting state, first-ever connect only | `<Loading label="Loading activity…" />` — no change to the component itself |
| `EmptyState` (existing, reused) | Open + zero items | `<EmptyState message="No activity yet. Card moves on this board will appear here." />` — no change to the component itself |
| `BoardViewPage` (extended) | Mounts `ActivityFeed` alongside `Columns` | Only in the `success` branch — the feed never mounts against a loading/error/404 board |

### Interactions
| Trigger | Action | Feedback |
|---------|--------|----------|
| `BoardViewPage` reaches `success` | `ActivityFeed` mounts, `EventSource` opens | `Loading` shown immediately, feed-scoped |
| Backfill frames arrive (fresh connect) | Rendered into the list, newest-first | No announcement (silent catch-up); `Loading` replaced by the list (or `EmptyState` if the board has no history) |
| A live `card_moved` frame arrives while `open` | Prepended to the top of the list; oldest trimmed past `ACTIVITY_FEED_MAX_ITEMS` (100) | The hidden announcer's text is set to that item's sentence — announced once, politely, without moving focus |
| Connection drops | Hook transitions to `reconnecting` | `ActivityFeedStatus tone="reconnecting"` banner appears above the still-visible, still-interactive list; nothing is hidden or cleared |
| Reconnect succeeds, replay frames arrive | Merged into the list (deduped by `id`), same silent "catch-up" treatment as backfill | Banner clears once a frame is received; hook returns to `open` |
| Reconnecting persists past `ACTIVITY_DEGRADED_AFTER_MS` | Hook transitions to `degraded` | `ActivityFeedStatus tone="degraded"` banner (`role="alert"`) replaces the reconnecting banner; list stays visible/frozen; rest of the board (columns) is unaffected |
| Connection recovers from `degraded` | Hook transitions back to `open` on the next successful frame | Banner disappears; feed resumes live appends normally |
| Navigate away from the board | `ActivityFeed` unmounts | `EventSource.close()` called in the hook's cleanup — no leaked connection |

### Responsive Behavior
| Breakpoint | Changes |
|------------|---------|
| < 640px | `.columns` grid stays `1fr` (unchanged from FEAT-004); the Activity section is the 4th stacked block, after Done, full width |
| 640–1024px | The 3 status columns keep `repeat(3, 1fr)` unchanged; Activity becomes a new full-width row below them (`grid-column: 1 / -1`) rather than a 4th narrow track, so card content is never squeezed |
| > 1024px | `.columns` grid becomes `repeat(3, 1fr) minmax(260px, 320px)`; Activity occupies the 4th track, full column height, with its own `overflow-y: auto` once content exceeds a generous max-height |

### Accessibility Requirements
- [x] Keyboard navigation support — the feed region introduces no new interactive controls in the base design (no toggle, no buttons); if/when a future "jump to card" link is added, it will be a native `<a>`/`<button>` per the existing pattern.
- [x] Screen reader compatibility — `<section aria-labelledby>` + `<h2>` mirrors `Column`'s pattern exactly, so heading-navigation users find "Activity" the same way they find "To Do"/"In Progress"/"Done".
- [x] Color contrast compliance (WCAG AA) — reuses the existing text/background palette (`.column`, `.card` styles); no new colors introduced, no color-only status cue (see below).
- [x] Visible focus indicators — N/A for the base design (no focusable elements added); preserved for any future interactive addition per the existing `:focus-visible` convention.
- [x] Error messages accessible — the degraded banner uses `role="alert"`, matching `ErrorState`'s existing convention exactly; the reconnecting banner uses `role="status"` (implicit polite + atomic), a deliberately gentler register for a transient, self-healing condition.
- [x] Status/movement not color-alone — every item's sentence names both the from and to columns as **text** ("from In Progress to Done"); no colored dot/badge is the sole indicator of anything.

## Content, Ordering & Phrasing

- **Ordering**: newest-first in the rendered list (new items prepended to the top). Backfill arrives oldest→newest from the server; the client reverses insertion order (or inserts each at index 0 as received) so the net visual order is newest-first regardless of whether an item came from backfill, live push, or reconnect replay.
- **Item phrasing** — one template used for every item, today and after a future `actor` field ships:
  > **`{actor} moved "{card_title}" from {From Label} to {To Label}`**
  - Today, `{actor}` is always **"Someone"** (no auth exists — Scope Boundaries). This is a direct, forward-compatible rendering of the no-actor fallback the Specification itself names ("Marco moved…", degrading to "someone moved…"): only the `{actor}` token changes when a real actor ships; no other part of the sentence or component needs to change.
  - `{From Label}`/`{To Label}` are the same human labels already used for columns ("To Do", "In Progress", "Done") — reusing `Columns.tsx`'s `COLUMNS` label map rather than inventing new copy, so the feed and the columns never disagree on a status's name.
  - Example: **"Someone moved "Deploy pipeline" from In Progress to Done"**.
- **Deleted card (`card_id: null`)**: rendered with **identical phrasing** — `card_title` is denormalized specifically so historical items keep reading correctly after the card is gone (architecture decision). No special-cased "(deleted)" annotation is added: no AC requires distinguishing this, jump-to-card is out of scope, and a conditional render branch for a cosmetic-only distinction would add test surface for no behavioral benefit (simplicity-first). If jump-to-card is ever built, that is the natural point to also add a "(this card was later deleted)" affordance — not before.
- **Timestamp**: absolute, not relative. Rendered as `<time dateTime={created_at}>Jul 15, 2:41 PM</time>`, extending the exact formatting convention `Card.tsx`'s `formatDueDate` already established (`toLocaleDateString`), adding a time component. Relative timestamps ("2m ago") were considered and rejected: they require a ticking re-render (`setInterval`) to stay accurate, which is unnecessary complexity for a feed whose whole point is that new items already convey recency by appearing at the top live — no AC asks for relative time, and `Card.tsx` already sets the absolute-timestamp precedent for this codebase.
- **Item count/retention**: backfill delivers the server's `ACTIVITY_BACKFILL_LIMIT` (default 50, from the architecture doc) on connect. The client additionally caps total retained items at **`ACTIVITY_FEED_MAX_ITEMS = 100`** (a client-only constant, not an env var — this is a rendering/memory concern, not a transport config surface), trimming the oldest (bottom of the newest-first list) once exceeded. Trimming is silent — no announcement, no visual transition — matching how any long-lived live feed (chat, activity log) quietly bounds its own history.

## Accessibility Deep-Dive: `aria-live` and the "Chatty Feed" Risk

This is the highest-risk part of the design and is addressed explicitly, per the Specification's own callout.

**The risk**: naively wrapping the entire visible `<ul>` in `aria-live="polite"` means (a) the 50-item backfill burst on every page load gets read aloud in full — genuinely unusable for screen-reader users, and (b) every subsequent live append re-triggers screen-reader attention to a growing/reordering list, which is a well-known anti-pattern for high-frequency live regions.

**The design**:
1. **Decouple the announcement channel from the visible list.** A single visually-hidden element, sibling to the visible `<ul>` — `<div aria-live="polite" aria-atomic="true" className="visually-hidden" />` — is the **only** thing screen readers are told to watch. The visible `<ul>` itself carries no `aria-live` attribute, so DOM insertions/reordering in the visible list never themselves trigger an announcement.
2. **Politeness = `polite`, never `assertive`.** Per the Specification's explicit instruction, a feed that appends frequently must not interrupt whatever the user is currently doing (assertive regions cut off in-progress speech). `polite` queues the announcement to play after the current utterance — appropriate for a feed that is informative, not urgent.
3. **`aria-atomic="true"`** ensures the whole sentence is read as one utterance, not a diff of the DOM patch, even though the technique in point 4 already guarantees a full text replacement.
4. **Backfill and replay are silent by design; only genuinely new live events are announced.** Because the wire protocol sends backfill, replay, and live pushes as identical `card_moved` frames (per the architecture doc — there is no wire-level flag distinguishing them), the distinction is made client-side with an **arming heuristic**: after the hook enters `open` (fresh connect) or re-enters `open` from `reconnecting` (post-gap), incoming frames are treated as a silent "catch-up" burst until a short quiet period (`ACTIVITY_ANNOUNCE_ARM_DELAY_MS`, e.g. 250ms with no new frame) has elapsed. Only frames received after arming update the hidden announcer. This means: 50 backfilled items on page load → 0 announcements; a single genuine live move a minute later → exactly 1 announcement; a reconnect that replays 6 missed events in a burst → 0 announcements (still catch-up), then the next real live move → 1 announcement.
5. **Guaranteed re-announcement on repeated identical text.** Because two different moves can legitimately produce the same sentence (e.g. the same card bouncing back and forth), the announcer's text is cleared to `''` and then set to the real sentence on the next tick/frame, so assistive tech reliably re-announces even when the visible text is unchanged from the previous announcement (a standard technique for repeated-content live regions).
6. **Focus is never moved.** No element receives programmatic `.focus()` on append, connect, reconnect, or degrade — the entire mechanism is announce-only, exactly matching AC-HAPPY-2's requirement without side effects on keyboard focus position.
7. **State-transition banners use their own, coarser-grained live semantics** (`role="status"` for reconnecting, `role="alert"` for degraded — see Design Specifications above) — these fire at most once per state transition, not once per item, so they carry no chattiness risk of their own.

## Implementation Guidelines

### For Developers
1. Build `frontend/src/api/activityStream.ts` first (the `EventSource` seam) and `frontend/src/hooks/useActivityStream.ts` second, unit-testing the hook's state machine (connecting → open → reconnecting → degraded, arming heuristic, item cap/trim) against a fake `EventSource` before wiring any rendering — mirrors how `useApiResource` was built and tested independently of its consuming pages.
2. `ActivityFeed` should be a thin rendering switch over `useActivityStream`'s `status`, exactly like `BoardViewPage`'s existing switch over `useApiResource`'s `status` — do not reintroduce ad hoc booleans.
3. Add a single `.visually-hidden` utility class to `frontend/src/index.css` (standard clip-based hidden-but-announced pattern) — this does not exist yet and is needed for the announcer element.
4. Reuse `Columns.tsx`'s `COLUMNS` label map (or extract it to a small shared constant) for the From/To labels in item phrasing, so the feed can never drift from the columns' own wording.
5. The degraded threshold (`ACTIVITY_DEGRADED_AFTER_MS`) and the arming delay (`ACTIVITY_ANNOUNCE_ARM_DELAY_MS`) are UI-only constants (not env vars, not part of the architecture doc's transport contract) — define them once in the hook module with a short comment explaining each, so a future tuning pass has one place to look.
6. Do not attach `aria-live` to the visible `<ul>` — attach it only to the dedicated hidden announcer element (see Accessibility Deep-Dive). This is the single most important review checkpoint for this feature's accessibility.
7. `ActivityFeedStatus`'s two tones (`reconnecting`/`degraded`) should share one small component with a `tone` prop rather than two near-duplicate components — but keep it out of `components/` until a second realtime surface needs it (see Key Components table rationale).

### Component Structure
```
frontend/src/
├── api/
│   └── activityStream.ts          (new — EventSource seam, mirrors api/client.ts)
├── hooks/
│   └── useActivityStream.ts       (new — connection state machine)
│   └── useActivityStream.test.ts  (new)
└── pages/
    └── BoardViewPage/
        ├── BoardViewPage.tsx      (extended — mounts ActivityFeed in the success branch)
        ├── ActivityFeed.tsx       (new)
        ├── ActivityFeed.test.tsx  (new)
        ├── ActivityFeedItem.tsx   (new)
        └── ActivityFeedStatus.tsx (new)
```
(`components/Loading.tsx`, `components/EmptyState.tsx` are reused unmodified.)

### Recommended Libraries/Patterns
- **No new dependency** — native `EventSource` (already the architecture decision) and plain CSS/React state are sufficient, matching the project's "no component library" precedent.
- **CSS Grid** extension of the existing `.columns` rule (new 4th track / new row), not a second, separate layout system.
- **Native `<time dateTime>`** for the timestamp — semantic HTML, no date library needed for the "Jul 15, 2:41 PM" format (matches `Card.tsx`'s existing `toLocaleDateString` precedent, extended with time options).

## Validation Checklist

- [x] Meets all user goals — ambient live awareness (Priya/Sam), self-confirmation of own moves (Marco), calm recovery cues (all) without any required interaction
- [x] Accessible per requirements — decoupled announcer avoids the chatty-feed anti-pattern; polite (never assertive) new-item announcements; role="status"/"alert" correctly differentiated; status never color-only
- [x] Consistent with existing patterns — reuses `Loading`/`EmptyState` verbatim, extends (does not duplicate) the `.columns` responsive scheme, mirrors `Column`'s `aria-labelledby` pattern and `useApiResource`'s single-state-value discipline
- [x] Respects Guiding Principles and component architecture in systemPatterns.md — no new interaction primitive, no premature `components/` abstraction for `ActivityFeedStatus`, shallow component tree
- [x] Responsive across devices — extends the existing single-breakpoint-plus-row scheme with one addition (4th track ↔ new row ↔ stacked section), no new breakpoint concept invented
- [x] Performance acceptable — static layout, no gesture/animation JS beyond the existing spinner; item cap bounds memory on long sessions
- [x] Implementation feasible — matches Phase 3 of `tasks/TASK-005.md`'s roadmap; no dependency on anything not already decided in the Architecture creative

## Next Steps

1. Phase 3 build: implement `activityStream.ts` + `useActivityStream` (with its state-machine tests) before any rendering component, per Implementation Guidelines #1.
2. Implement `ActivityFeed`/`ActivityFeedItem`/`ActivityFeedStatus` and wire into `BoardViewPage`'s success branch; extend `index.css` with the 4th-track/new-row/stacked responsive rules and the `.visually-hidden` utility.
3. `frontend/src/pages/BoardViewPage/ActivityFeed.test.tsx` should specifically assert: newest-first order, the exact phrasing template (including the deleted-card case rendering identically), zero announcements during backfill, exactly one announcement per genuine live event, and that the visible `<ul>` itself carries no `aria-live`.
4. `/banyan-uat` should specifically walk: a live move appearing without reload (screen + screen-reader observation), a simulated reconnect (existing items must not disappear), and the degraded state's wording/role, per this doc's Accessibility Deep-Dive.

---

## NEW_TERMS_INTRODUCED
- **`ActivityFeed`** — the board-view region component rendering the live feed.
- **`ActivityFeedItem`** — one rendered card-movement sentence + timestamp.
- **`ActivityFeedStatus`** — the reconnecting/degraded banner component, colocated with the feed (not promoted to `components/` yet).
- **`useActivityStream`** — the client hook/state machine over the `EventSource` connection (`connecting`/`open`/`reconnecting`/`degraded`).
- **`activityStream.ts`** — the single client seam that opens the `EventSource` (mirrors `api/client.ts`).
- **Arming heuristic / "armed" state** — the client-side distinction between silent catch-up frames (backfill or reconnect replay) and genuinely new live frames, used solely to gate the `aria-live` announcer.
- **`ACTIVITY_ANNOUNCE_ARM_DELAY_MS`** — client-only constant (proposed 250ms) governing the arming heuristic.
- **`ACTIVITY_DEGRADED_AFTER_MS`** — client-only constant governing how long sustained `reconnecting` must persist before the UI declares `degraded`.
- **`ACTIVITY_FEED_MAX_ITEMS`** — client-only constant (proposed 100) capping retained feed items, trimming oldest first.
- **`.visually-hidden`** — new CSS utility class for the hidden `aria-live` announcer element (does not exist in `index.css` today).

---

UI/UX CREATIVE COMPLETE
Document: memory-bank/creative/TASK-005-realtime-activity-feed-uiux.md
Decision: Persistent side-panel Activity feed (desktop: 4th grid column; tablet: full-width row below columns; mobile: final stacked section) — newest-first, "Someone moved "{title}" from {From} to {To}" phrasing (identical for deleted cards), absolute timestamps, five distinct connecting/open/empty/reconnecting/degraded states built from the existing Loading/EmptyState plus one new ActivityFeedStatus banner, and a decoupled hidden `aria-live="polite"` announcer (never the visible list) that stays silent during backfill/replay and fires exactly once per genuine live event to avoid the chatty-feed anti-pattern.
