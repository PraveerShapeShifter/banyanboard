# UI/UX Decision: Board Settings → Automation Tab (Card Workflow Automation)

**Created**: 2026-07-15
**Status**: DECIDED
**Decision Type**: UI/UX
**Task**: TASK-006 / FEAT-006 (Level 3)
**Scope of this doc**: The Phase-4 frontend surface ONLY — (1) the entry point/navigation into the Automation tab, (2) the rule-creation form + client validation, (3) the rule list with enable/disable + delete-confirmation, (4) the read-only trigger-execution + webhook-delivery history, (5) the `frontend/src/api/` seam + hooks, and (6) accessibility, file list, and testing. It consumes the **FROZEN** backend contract (rule CRUD, coded error envelope, history read endpoints, delivery-status enum) and does **not** redesign any API, schema, or the dispatcher.

---

## Context

Phase 4 adds a **Board Settings → Automation tab** to the existing React SPA (`frontend/`, Vite + React 18 + TS, React Router 6, RTL + Vitest). It lets Priya (Team Lead / board owner) create, list, toggle, and delete auto-move rules and inspect execution + webhook-delivery history — backed by the rule CRUD + read endpoints delivered in Phases 1–3.

### The one fact that dominates this design
**The SPA is read-only today.** `frontend/src/api/client.ts` is "the single I/O seam: the only module that calls `fetch`", and it exposes **only** `getBoards`/`getBoard`/`getCards` via a private `getJson<T>` — every response is a GET, and the `ApiResult<T>` union models only `http`/`network` failure. There is **no `POST`/`PATCH`/`DELETE` anywhere in `frontend/`** (grep confirms zero mutating fetches), no form, no submit handler, and no parser for the backend's error bodies. The Automation tab is therefore the **first mutation surface in the SPA**, and its dominant new-pattern cost is *introducing a disciplined write path* (mutation seam + coded-error parsing + optimistic/pending list state) that future features (board create, card CRUD UI) can reuse — not the visual layout.

### System Requirements (from TASK-006 §Invocation Method "UI element (Phase 4)", AC-HAPPY-1/3, AC-ASYNC-3)
- Reach an **Automation tab** from Board Settings on the board view (`BoardViewPage`, route `/boards/:id`).
- A **rule-creation form**: `name`, condition **status** select, `target_status` select, optional `webhook_url`, `enabled` toggle → `POST /rules`.
- A **per-board rule list**: enable/disable (`PATCH /rules/:id {enabled}`), delete with confirmation (`DELETE /rules/:id`), and display of the rule's condition / target / `webhook_url`.
- A **read-only history view**: trigger executions (`GET /trigger-executions?board_id=`) and webhook deliveries (`GET /webhook-deliveries?rule_id=`), surfacing delivery `status ∈ pending|delivered|failed|exhausted` and `last_error`.
- Reuse the existing `EmptyState` / `ErrorState` / `Loading` components and mirror `ActivityFeed`'s state-machine + a11y discipline.

### FROZEN backend contract this UI consumes (do NOT redesign)
- **Rules CRUD**: `POST /rules {board_id, name, condition:{field:'status',operator:'eq',value}, target_status, enabled?, webhook_url?}`; `GET /rules?board_id=`; `GET/PATCH/DELETE /rules/:id`. `condition` is status-equality only (`field:'status'`, `operator:'eq'`, `value ∈ todo|in_progress|done`); `target_status ∈` same enum; `webhook_url` optional absolute `http(s)` or `null`.
- **Coded error envelope (NEW pattern, deliberate divergence)**: `400 {code:'INVALID_RULE', message, details:[{field,error}]}`, `400 {code:'BOARD_NOT_FOUND', message}` (no `details`), `404 {code:'RULE_NOT_FOUND', message}`. This is NOT the `{error,details:[{field,message}]}` shape `cards`/`boards` use — the client must parse `code` + `details[].field` + `details[].error`.
- **History reads**: `GET /trigger-executions?board_id=&rule_id=`; `GET /webhook-deliveries?rule_id=&trigger_execution_id=&status=`; `GET /webhook-deliveries/:id`. Read-only (a client never advances a delivery). Delivery lifecycle `pending → delivered | failed → exhausted`; `last_error` is the serialized coded `{code,message,details}`. **No SSE for deliveries** (AC-ASYNC-3) — history is polled/refreshed, unlike the live activity feed.

### Non-Functional Requirements (productBrief.md)
- **Accessibility**: WCAG 2.1 AA — keyboard-operable, screen-reader-compatible, status **never conveyed by color alone**, visible focus, accessible names/roles. (Same bar the board view already meets.)
- **i18n**: English-only at MVP; keep copy in a small labels module (mirror `statusLabels.ts`) so it is extractable later; dates via `toLocaleDateString` (mirror `ActivityFeedItem`).
- **Browsers**: modern evergreen; responsive down to phone width.
- **Performance**: p95 < 200ms is a *server* budget; on the client, mutations show pending state within 100ms and never block typing.
- **RBAC**: none exists in the codebase (matches boards/cards posture) — the tab is available to any board viewer.

### Existing Patterns That MUST Be Respected (systemPatterns.md Guiding Principles + FEAT-004/005 frontend)
- **Single I/O seam** — pages depend on typed functions in `api/`, never on `fetch`/URLs; component tests `vi.mock('../../api/client')` (see `BoardListPage.test.tsx`) or stub the seam.
- **One state value per async read** — `useApiResource` maps `ApiResult` → `loading | success | error`; the page render is a `switch` over `state.status`. "Never show stale/blank content while pending."
- **Status-union hook for a live/stateful concern** — `useActivityStream` is a purpose-built hook owning its own state machine, resettable on id change, fail-safe on transport failure. A hook is warranted when there is real client state to own (here: the *mutable rule list*).
- **Decoupled a11y announcer** — the ONLY `aria-live` element is a visually-hidden announcer, sibling to (never on) the visible list, keyed by a `seq` so identical repeated text re-announces (`ActivityFeed`). Reused verbatim for mutation success/error announcements.
- **`<section aria-labelledby>` + heading** for every region so heading-nav SR users find it (`Column`, `ActivityFeed`).
- **Shared status wording** — `STATUS_LABELS` (`statusLabels.ts`) is the single To Do / In Progress / Done map; the form selects, the rule-condition sentence, and history rows all reuse it so surfaces never drift.
- **Routes table is the single source of truth** (`routes.tsx`), shared by `createBrowserRouter` (app) and the memory router (tests); flat route list today.
- **Simplicity-first** — no component library exists (deps are only `react` + `react-router-dom`); every primitive is plain hand-rolled HTML. Do **not** introduce a UI-kit dependency for this tab.
- **Colocation** — reusable primitives in `components/`; single-consumer view pieces colocated under the page dir (`ActivityFeedStatus` lives under `BoardViewPage/`, not `components/`).

---

## User Context

### Target Users
- **Primary**: **Priya** (Team Lead / board owner) — configures automation so cards "keep flowing to Done" without babysitting columns. Creates/edits/deletes rules; checks that automation is actually firing (and that webhooks are landing) via history.
- **Secondary**: **Sam** (stakeholder/observer) and **Marco** (contributor) — may open the Automation tab read-mostly to understand *why* a card auto-moved; they primarily consume the history view and the live activity feed (AC-ASYNC-1, already shipped).

### User Goals
1. Create a rule that auto-moves a card to a target status when it reaches a given status, in under a minute, without reading API docs.
2. See at a glance which rules exist, whether each is on/off, and whether any post to a webhook.
3. Confirm automation is working — see recent firings and whether webhook deliveries succeeded or exhausted, with the failure reason.
4. Safely turn a rule off (reversible) or delete it (irreversible, must confirm).

### Use Cases
| Use Case | User | Goal | Frequency |
|----------|------|------|-----------|
| Create an auto-move rule (+ optional webhook) | Priya | Automate a column transition | Occasional (setup) |
| Toggle a rule off temporarily | Priya | Pause automation without losing config | Occasional |
| Delete a stale rule | Priya | Remove obsolete automation | Rare |
| Review firing + delivery history | Priya / Sam | Verify automation ran; diagnose a failed webhook | Periodic |

### Constraints
- **Devices**: desktop-primary (a configuration surface), responsive to phone. Tables → stacked cards on narrow widths (ux-patterns Mobile Adaptation).
- **Accessibility**: WCAG 2.1 AA (see NFR above).
- **Existing patterns**: all of "Existing Patterns That MUST Be Respected" above.

---

## User Flow

### Flow Diagram
```
Board view (/boards/:id)
   │  BoardHeader nav: [ Board ]  [ Automation ]   ← new tab link (aria-current)
   ▼  click "Automation"
Automation page (/boards/:id/automation)
   │  loading → (board 404 → NotFoundState) → (other error → ErrorState+Retry) → ready
   ▼
 ┌─ tablist: [ Rules ]  [ History ] ────────────────────────────────┐
 │                                                                   │
 │  RULES tab (default)                                              │
 │   ├─ RuleForm  (name, when-status, move-to, webhook?, enabled)    │
 │   │     submit → POST /rules                                      │
 │   │        ├─ 201 → prepend to list, reset form, announce success │
 │   │        ├─ 400 INVALID_RULE → map details[].field → inline     │
 │   │        └─ 400 BOARD_NOT_FOUND / network → form banner + retry  │
 │   └─ RuleList                                                     │
 │        ├─ empty → EmptyState "No rules yet…"                      │
 │        ├─ per row: condition→target sentence, webhook badge,      │
 │        │           enable/disable toggle (PATCH), Delete button   │
 │        └─ Delete → ConfirmDialog(role=alertdialog) → DELETE       │
 │                                                                   │
 │  HISTORY tab                                                      │
 │   ├─ trigger executions (GET /trigger-executions?board_id=)       │
 │   │     loading / error+Retry / empty / list of firings          │
 │   └─ per firing: expand → deliveries (GET /webhook-deliveries)    │
 │        delivery status badge (text+color) + last_error reason     │
 │   └─ [ Refresh ] (no SSE — AC-ASYNC-3)                            │
 └───────────────────────────────────────────────────────────────────┘
   │  BoardHeader nav "Board" → back to /boards/:id
```

### Flow Description
1. **Entry**: On the board view, `BoardHeader` renders a two-item nav — **Board** (current) and **Automation**. Clicking Automation navigates to `/boards/:id/automation`.
2. **Load**: The Automation page fetches the board (to render the same `<h1>` + validate the id) via the existing `getBoard` seam → `loading` → `NotFoundState` on 404 (mirrors `BoardViewPage`) → `ErrorState + Retry` on other failure → ready.
3. **Rules tab (default)**: form on top, list below (ux-patterns Forms: single column mobile, up to 2-col desktop; empty-state with a primary CTA is the form itself).
4. **Create**: submit → optimistic pending → 201 prepends the new rule; coded 400 maps to inline field errors; a form-level banner covers `BOARD_NOT_FOUND`/network with a retry.
5. **Toggle / Delete**: toggle is reversible and immediate (PATCH, pending state on the control); Delete is destructive → **confirmation dialog** before `DELETE`.
6. **History tab**: two-level read — firings, each expandable to its deliveries; a manual **Refresh** (no realtime push for deliveries).
7. **Exit**: nav "Board" returns to `/boards/:id`; the board view and its live activity feed are unchanged.

### Error States
| Error | Cause | User Recovery |
|-------|-------|---------------|
| Inline field error | `400 INVALID_RULE` `details[].field` (name/target_status/webhook_url/condition) | Fix the flagged field; error clears on edit, re-validates on submit |
| Form banner | `400 BOARD_NOT_FOUND`, unmapped `details` field (e.g. `body`), or network failure on submit | Message + the form stays filled; resubmit (banner is `role="alert"`) |
| Toggle failed | `PATCH` network/HTTP error | Toggle reverts to prior value; inline "Couldn't update — try again" on the row |
| Delete failed | `DELETE` network/HTTP error, or `404 RULE_NOT_FOUND` (already gone) | 404 → treat as success (remove row); other → dialog shows error, row stays |
| History load failed | `GET` failure | `ErrorState` + **Retry** in the affected panel |
| Board 404 | `/boards/:id/automation` for a missing board | `NotFoundState` (no Retry), same as board view |

---

## Decision 1 — Entry point & navigation

### Options Explored
**Option 1A: In-page tab via `useState` on `BoardViewPage`** ("Board" / "Automation" toggled with local state, no URL change).
- Pros: no route change; simplest wiring.
- Cons: **not deep-linkable / not back-button-able** (Priya can't bookmark or share the automation view); breaks the app's URL-driven model; forces `BoardViewPage` to own a second, unrelated data domain; harder to test in isolation (the route-table test pattern in `BoardListPage.test.tsx` no longer reaches it directly).
- Usability: Medium · Accessibility: Medium · Complexity: Low

**Option 1B: Dedicated route `/boards/:id/automation` reached via a nav link in `BoardHeader`** (CHOSEN).
- Pros: deep-linkable, back/forward works, bookmarkable/shareable; each route owns one data domain (board view vs automation) — matches `BoardListPage`/`BoardViewPage` separation exactly; testable through the shared route table (`routes.tsx`) the same way `BoardListPage.test.tsx` renders the whole table; the `BoardHeader` nav doubles as the "which view am I in" affordance with `aria-current="page"`.
- Cons: adds one route + a `BoardHeader` change; a second `getBoard` fetch on the automation page (cheap, and gives a correct 404 path for free).
- Usability: High · Accessibility: High · Complexity: Low-Med

**Option 1C: Drawer / modal overlay over the board** (slide-in settings panel).
- Pros: keeps board context visible behind it.
- Cons: ux-patterns anti-pattern — a full management surface (form + list + two-level history) is too large for a drawer; a modal that the user must reference the board behind is explicitly discouraged; no dialog/drawer primitive exists (would be net-new). Not deep-linkable.
- Usability: Medium · Accessibility: Medium (focus-trap burden) · Complexity: Med-High

### Chosen: Option 1B — dedicated route + `BoardHeader` nav link
**Rationale**: It is the only option consistent with the app's URL-as-state model and the "routes table is the single source of truth" convention, and it gives deep-linking, the back button, and a free 404 path — all at Low-Med cost. The word "tab" in the spec is honored by the **`BoardHeader` nav rendered as a tab strip** ("Board" | "Automation") using route `<Link>`s with `aria-current="page"` on the active one — the semantically correct pattern for tabs that are *navigations* (route changes), as opposed to an ARIA `tablist` which is for in-page view switches. (The intra-page **Rules / History** switch, which is *not* a navigation, uses a true ARIA `tablist` — see Decision 4.)

`routes.tsx` gains: `{ path: '/boards/:id/automation', element: <AutomationPage /> }`. `BoardHeader` gains a `<nav aria-label="Board views">` with the two links; it needs the board `id` (currently it only receives `name`) — `BoardViewPage`/`AutomationPage` pass `id`.

---

## Decision 2 — Rule-creation form & client validation

### Options Explored
**Option 2A: "Dumb" form — POST, let the server be the only validator, render whatever `details[]` comes back.**
- Pros: zero duplication of validation logic; server is authoritative.
- Cons: a round-trip for every trivially-catchable mistake (blank name, self-loop, bad URL) — poor perceived latency; ux-patterns wants inline client validation on blur/submit; a self-loop (`condition.value === target_status`) is a *known* `INVALID_RULE` we can prevent before submit.
- Usability: Medium · Accessibility: Medium · Complexity: Low

**Option 2B: Mirror the backend field checks client-side, submit only when locally valid, AND still map server `details[]` back onto fields** (CHOSEN).
- Pros: instant inline feedback (ux-patterns: inline, below field, red on submit/blur-after-touch, never block typing); the server remains authoritative — any server `INVALID_RULE.details[].field` still maps onto the matching control (defense in depth, and covers checks the client didn't replicate); mirrors the backend's own hand-rolled `checkTitle`/`checkStatus` style (no validator lib, consistent with `rules.validation.ts`).
- Cons: light duplication of rules (name ≤120, enum, URL, self-loop) between `frontend` and `backend` — accepted, and localized to one `rulesValidation.ts` module mirroring the backend one.
- Usability: High · Accessibility: High · Complexity: Med

### Chosen: Option 2B
**Fields & controls** (single column mobile; 2-col desktop for the two status selects):
| Field | Control | Notes |
|-------|---------|-------|
| `name` | `<input type="text">` (required, `*`) | ≤120 chars (matches `boards.name`); required indicator not color-alone |
| condition status ("When a card's status is…") | `<select>` of `STATUS_LABELS` (To Do / In Progress / Done) | maps to `condition:{field:'status',operator:'eq',value}`; `field`/`operator` are fixed (frozen single-value enums) so they are **not** shown as controls — just the value |
| `target_status` ("…move it to") | `<select>` of `STATUS_LABELS` | must differ from condition value (self-loop guard) |
| `webhook_url` | `<input type="url">` (optional) | placeholder `https://…`; empty → send `null`/omit |
| `enabled` | `<input type="checkbox">` labelled "Enabled" | defaults **checked** (backend default `true`) |

**Client validation (mirrors AC-ERROR-2 exact strings so client and server messages read identically):**
- `name`: non-blank string, ≤120 → `'name must not be blank'` / `'name must be at most 120 characters'`.
- `target_status`: within enum (guaranteed by the select) → `'target_status must be one of: todo, in_progress, done'` as backstop.
- **self-loop**: `condition value === target_status` → inline error on `target_status` (`'a rule cannot move a card to the status it is already in'`), matching the backend's self-loop `INVALID_RULE` reject; prevents a guaranteed-400 submit.
- `webhook_url` (only when non-empty): absolute `http(s)`, ≤2048 → `'webhook_url must be an absolute http(s) URL'` / `'webhook_url must be at most 2048 characters'`.

**Validation timing**: do not block typing; show a field's error on blur-after-touch and on submit; clear it on next edit; re-run on submit (ux-patterns Forms).

**Submit → success/error handling** (via the new mutation seam, Decision 5):
- **201**: prepend the returned rule to the list (single source of truth is the `useRules` list state), reset the form, and set a **success announcement** (visually-hidden `aria-live`, reusing the `ActivityFeed` announcer pattern — "Rule '{name}' created").
- **400 `INVALID_RULE`**: for each `details[].field`, map to the matching control (`name`, `target_status`, `webhook_url`, and `condition`/`condition.field`/`condition.operator` → the condition select; unknown/`body` → form banner). Set `aria-invalid` + `aria-describedby` on each mapped control.
- **400 `BOARD_NOT_FOUND`** / **network** / other HTTP: **form-level banner** (`role="alert"`) at top of form ("Couldn't create the rule."); the form keeps its values; resubmit is the retry.

---

## Decision 3 — Rule list: toggle, delete-confirmation, and display

### Options Explored (delete confirmation)
**Option 3A: `window.confirm()`** — native browser dialog.
- **Rejected.** ux-patterns mandates `AlertDialog` (`role="alertdialog"`) for destructive actions; the `/banyan-uat` severity rubric classifies a **native browser dialog blocking flow as a Required (PASS-blocking) finding**. Not accessible/consistent, not stylable, not testable via RTL.

**Option 3B: Hand-rolled confirmation dialog with `role="alertdialog"`** (CHOSEN).
- A small reusable `ConfirmDialog` in `components/`: `role="alertdialog"`, `aria-labelledby`/`aria-describedby`, focus moved to the dialog on open and returned to the trigger on close, **focus-trapped**, closes on ESC and outside-click (ux-patterns Modals; exception: stays open while the delete request is in flight, showing a spinner). Primary (destructive) action "Delete", secondary "Cancel".
- Pros: matches ux-patterns exactly; accessible; testable (`getByRole('alertdialog')`); reusable by future destructive actions (board/card delete) — pays down the "first mutation surface" cost.
- Cons: net-new component (~40 lines) — but it is the correct primitive and there is no library alternative.

### Chosen: Option 3B (hand-rolled `role="alertdialog"` `ConfirmDialog`)

### Toggle (enable/disable)
- A labelled control per row (a `<button role="switch" aria-checked>` OR a checkbox with a visible label — chosen: **`<button role="switch">`** with visible "Enabled"/"Disabled" text so state is not color-alone). On activate → `PATCH /rules/:id {enabled:!current}`.
- **Optimistic with rollback**: flip immediately (perceived-latency), mark the row pending; on failure revert and show an inline ret`ry` message on the row (mirrors productBrief's optimistic-UI-with-reconcile principle for card DnD). This is the reversible counterpart to the confirmed, irreversible delete.

### Row display
- **Condition→target sentence** built from a shared labels helper (mirror `formatActivitySentence`): e.g. *"When status is **In Progress**, move to **Done**."* — reuses `STATUS_LABELS`, so it can never drift from the columns/feed.
- **Webhook indicator**: if `webhook_url` set, a small badge "Webhook" + the host (truncated, `title`/`aria-label` full URL); if the History data is available for that rule, show its latest delivery status badge inline. If `null`, no badge.
- **Enabled state**: text ("Enabled"/"Disabled"), not color alone.

---

## Decision 4 — History views (trigger executions + webhook deliveries)

### Options Explored (layout)
**Option 4A: Two flat lists side-by-side / stacked.** Simple but forces the user to manually correlate a delivery to its firing.
**Option 4B: Master-detail — firings list, each expandable to its deliveries** (CHOSEN). Matches the data's parent/child shape (`trigger_execution_id` FK), keeps the default view compact, loads deliveries lazily per firing.

### Options Explored (freshness)
- **No SSE** (AC-ASYNC-3 is explicit: no realtime push for deliveries; the FEAT-005 feed carries only auto-move events). So history is a **plain `useApiResource` read with a manual `Refresh` button** — *not* a `useActivityStream`-style live hook. This is a deliberate divergence from the activity feed and is called out so a build agent doesn't wire an EventSource here.

### Chosen: 4B master-detail, `useApiResource` + Refresh
- **Firings** (`GET /trigger-executions?board_id=`): rows read *"'{card_title}' moved {from}→{to} · {time}"* (reuse `STATUS_LABELS` + the `ActivityFeedItem` absolute-time formatter), with the firing `status` (`executed`/`failed`) as text.
- **Deliveries** (`GET /webhook-deliveries?trigger_execution_id=` on expand, or `?rule_id=`): a **`DeliveryStatusBadge`** rendering `pending | delivered | failed | exhausted` as **text + icon + color** (never color alone; WCAG). `attempts`, `last_status_code`, and the **`last_error` reason** (the coded body's `message`, with `details[].error` as detail) are shown for `failed`/`exhausted`. `delivered_at` shown when delivered.
- **States** reuse `Loading` / `ErrorState` (+Retry) / `EmptyState` ("No automation has fired yet on this board.").

### Intra-page tab: Rules / History
Rules vs History is a **true ARIA `tablist`** (`role="tablist"` / `role="tab"` `aria-selected` / `role="tabpanel"` `aria-labelledby`), because it is an in-page switch between mutually-exclusive views of the same resource (ux-patterns Tabs rule) — *not* a navigation, so it is not route-backed and not `aria-current`. (Contrast Decision 1's `BoardHeader` Board/Automation switch, which *is* a navigation and uses route links + `aria-current`.) Rules is the default tab.

---

## Decision 5 — `api/` seam & hooks (the first mutation path)

### Options Explored
**Option 5A: Add rule mutations into `client.ts` and reuse `ApiResult<T>`.**
- Con: `ApiResult<T>` only models `http`/`network`; it cannot carry the coded `{code,message,details}` body a `400 INVALID_RULE` needs (the form must read `details[].field`). Overloading `client.ts` (documented as the read seam) with writes also muddies it.

**Option 5B: Extend the seam with a mutation helper + a richer result union, in module-per-concern files** (CHOSEN).
- Add a private `mutateJson<T>(method, path, body)` to `client.ts` (keeps "only `client.ts` calls `fetch`" true) returning a new union:
  ```ts
  export interface CodedError { code: string; message: string; details?: { field: string; error: string }[]; }
  export type MutationResult<T> =
    | { ok: true; data: T }
    | { ok: false; kind: 'validation'; error: CodedError }   // 400 with a coded body
    | { ok: false; kind: 'http'; status: number }             // other non-2xx (incl. 404)
    | { ok: false; kind: 'network'; error: unknown };
  ```
  `mutateJson` parses a `400`/`404` JSON body into `CodedError` when it has a `code`, else falls back to `http`.
- New concern-scoped seam modules mirroring the backend module split and the `api/activityStream.ts` precedent:
  - `api/rules.ts`: `getRules(boardId)` → `ApiResult<AutomationRule[]>`; `createRule(input)`, `updateRule(id, patch)` → `MutationResult<AutomationRule>`; `deleteRule(id)` → `MutationResult<void>`.
  - `api/webhooks.ts`: `getTriggerExecutions(boardId)` → `ApiResult<TriggerExecution[]>`; `getWebhookDeliveries({ruleId?, triggerExecutionId?, status?})` → `ApiResult<WebhookDelivery[]>` (read-only).
- Wire types added to `api/types.ts`: `AutomationRule`, `RuleCondition`, `TriggerExecution`, `WebhookDelivery`, `DeliveryStatus`.

### Hook: `useRules(boardId)` (CHOSEN — a hook IS warranted here)
Reads (board fetch, history) use the existing `useApiResource` (single-read state machine). But the **rule list is mutable client state** (create prepends, toggle flips, delete removes) with per-item pending/error — this is exactly the "real client state to own" case that justified `useActivityStream`. `useRules(boardId)` owns:
- `status: 'loading' | 'ready' | 'error'` for the initial `getRules`, `reload()` for retry (mirrors `useApiResource` discipline);
- `rules: AutomationRule[]` list state;
- `create(input)`, `toggle(id)`, `remove(id)` — each returns a result the caller can use to drive form errors / dialog state, and each updates the list on success (optimistic + rollback for `toggle`, prepend for `create`, remove for `remove`, treating `404` on delete as success);
- resets on `boardId` change (mirrors `useActivityStream`'s in-place board switch reset).
History stays a plain `useApiResource` read (no bespoke hook) since it is read-only with a manual refresh.

---

## Component Breakdown

| Component | Location | Purpose |
|-----------|----------|---------|
| `AutomationPage` | `pages/AutomationPage/AutomationPage.tsx` | Route `/boards/:id/automation`. Fetches board via `getBoard` (loading→404→error→ready, mirroring `BoardViewPage`); renders `BoardHeader` (with nav) + the Rules/History tablist. |
| `AutomationTabs` | `pages/AutomationPage/AutomationTabs.tsx` | ARIA `tablist` (Rules/History), owns selected-tab state, renders the two `tabpanel`s. |
| `RuleForm` | `pages/AutomationPage/RuleForm.tsx` | The create form + client validation + inline/banner error rendering; calls `useRules().create`. |
| `RuleList` | `pages/AutomationPage/RuleList.tsx` | Renders `EmptyState` or the `<ul>` of `RuleListItem`; owns the delete `ConfirmDialog` open/target state. |
| `RuleListItem` | `pages/AutomationPage/RuleListItem.tsx` | One rule: condition→target sentence, webhook badge, `role="switch"` enable/disable, Delete trigger. |
| `HistoryView` | `pages/AutomationPage/HistoryView.tsx` | `useApiResource(getTriggerExecutions)` master list + Refresh; expands rows to deliveries. |
| `TriggerExecutionItem` | `pages/AutomationPage/TriggerExecutionItem.tsx` | One firing row; on expand fetches + renders its `WebhookDelivery` rows. |
| `DeliveryStatusBadge` | `pages/AutomationPage/DeliveryStatusBadge.tsx` | `pending/delivered/failed/exhausted` as text+icon+color (never color-alone). |
| `ConfirmDialog` | `components/ConfirmDialog.tsx` | Reusable `role="alertdialog"` (focus-trap, ESC/outside-click, in-flight lock). Shared primitive. |
| `automationLabels.ts` | `src/automationLabels.ts` | `formatRuleSentence(rule)` + delivery-status labels (mirror `statusLabels.ts`), reusing `STATUS_LABELS`. |
| `rulesValidation.ts` | `pages/AutomationPage/rulesValidation.ts` | Client field checks mirroring backend `rules.validation.ts` exact strings. |
| `useRules` | `hooks/useRules.ts` | Mutable rule-list state machine (create/toggle/remove) + initial load/reload. |

---

## Data Flow

```
RuleForm ──create(input)──▶ useRules ──createRule──▶ api/rules.ts ──mutateJson('POST','/rules')──▶ client.ts fetch
   ▲  inline errors ◀── MutationResult(validation → details[].field map)  │
   │                                                                      ▼
   └─────────── 201 → useRules prepends rule ──▶ RuleList re-renders ──▶ announcer("Rule created")

RuleListItem ─toggle(id)─▶ useRules (optimistic flip) ─updateRule('PATCH',{enabled})─▶ … (rollback on failure)
RuleListItem ─Delete────▶ RuleList opens ConfirmDialog ─confirm─▶ useRules.remove ─deleteRule('DELETE')─▶ … (404≈success)

HistoryView ─useApiResource(getTriggerExecutions?board_id=)─▶ list; Refresh = reload()
TriggerExecutionItem ─(expand)─ getWebhookDeliveries?trigger_execution_id= ─▶ DeliveryStatusBadge + last_error
```

Single-source-of-truth: `useRules.rules` is the only list state; the form and toggles mutate through it, never keep their own copy. All wire I/O funnels through `client.ts`.

---

## Accessibility (mirrors `ActivityFeed`/`Column` discipline + WCAG 2.1 AA)

- **Regions & headings**: `AutomationPage` renders `BoardHeader`'s `<h1>` (board name); each panel is a `<section aria-labelledby>` with an `<h2>` ("Rules", "History") so heading-nav SR users land the same way they do on "To Do"/"Activity".
- **Nav vs tabs, used correctly**: Board/Automation = route `<Link>`s with `aria-current="page"` (navigation). Rules/History = ARIA `tablist`/`tab`/`tabpanel` with `aria-selected` and arrow-key roving tabindex (in-page view switch).
- **Form**: every control has a `<label>`; the condition/target selects use `STATUS_LABELS` text; required `name` marked with `*` (not color-alone). Errors are inline `<p id>` below the field, wired via `aria-describedby`, with `aria-invalid` on the control; the form-level server-error banner is `role="alert"`. Validation never blocks typing.
- **Mutation feedback**: reuse the **decoupled visually-hidden `aria-live="polite"` announcer** keyed by a `seq` (verbatim `ActivityFeed` pattern) for "Rule created / updated / deleted"; the visible list carries no `aria-live` (so DOM insertions don't double-announce).
- **Switch control**: `role="switch"` `aria-checked`, with visible "Enabled/Disabled" text; keyboard operable; pending state via `aria-busy`.
- **ConfirmDialog**: `role="alertdialog"`, `aria-labelledby`+`aria-describedby`, focus moved in on open / restored to trigger on close, focus-trapped, ESC + outside-click close (locked while the delete is in flight). **No native `confirm()`.**
- **Delivery status**: text label + icon + color (color never the sole signal) — the badge reads e.g. "Failed" not just a red dot; `last_error` reason is plain text.
- **Focus & keyboard**: entire flow operable without a pointer; visible focus indicators (existing global styles); Retry/Refresh are real `<button>`s.

---

## Edge, Error, Empty & Loading States

| State | Where | Treatment |
|-------|-------|-----------|
| Loading (board) | AutomationPage | `Loading` (mirrors BoardViewPage) |
| Board 404 | AutomationPage | `NotFoundState` (no Retry) |
| Board other error | AutomationPage | `ErrorState` + Retry (`reload`) |
| Loading rules | RuleList | `Loading label="Loading rules…"` |
| Rules load error | RuleList | `ErrorState` + Retry |
| No rules | RuleList | `EmptyState "No rules yet. Create one above to auto-move cards."` (the form is the CTA — ux-patterns empty-state-with-CTA) |
| Submitting | RuleForm | submit button `aria-busy`/disabled + spinner; inputs stay editable=false during flight |
| Field-level 400 | RuleForm | inline errors mapped from `details[].field` |
| Form-level 400/network | RuleForm | `role="alert"` banner, values retained |
| Toggle pending / fail | RuleListItem | `aria-busy`; on fail revert + inline "Couldn't update — try again" |
| Delete confirm | RuleList | `ConfirmDialog`; in-flight spinner; error shown in dialog, row retained |
| Delete 404 | useRules.remove | treated as success (already gone) → remove row |
| Loading history | HistoryView | `Loading label="Loading history…"` |
| History error | HistoryView | `ErrorState` + Retry |
| No firings | HistoryView | `EmptyState "No automation has fired yet on this board."` |
| Firing w/ no webhook | TriggerExecutionItem | show firing only; "No webhook configured" (no delivery rows) |
| Delivery failed/exhausted | DeliveryStatusBadge | status text+icon + `attempts`/`last_status_code` + `last_error` reason |

---

## File List (build phase — under `frontend/src/`)

**New files:**
- `pages/AutomationPage/AutomationPage.tsx`
- `pages/AutomationPage/AutomationTabs.tsx`
- `pages/AutomationPage/RuleForm.tsx`
- `pages/AutomationPage/RuleList.tsx`
- `pages/AutomationPage/RuleListItem.tsx`
- `pages/AutomationPage/HistoryView.tsx`
- `pages/AutomationPage/TriggerExecutionItem.tsx`
- `pages/AutomationPage/DeliveryStatusBadge.tsx`
- `pages/AutomationPage/rulesValidation.ts`
- `components/ConfirmDialog.tsx`
- `hooks/useRules.ts`
- `api/rules.ts`
- `api/webhooks.ts`
- `automationLabels.ts`
- **Tests**: `pages/AutomationPage/AutomationPage.test.tsx`, `RuleForm.test.tsx`, `RuleList.test.tsx`, `HistoryView.test.tsx`; `components/ConfirmDialog.test.tsx`; `hooks/useRules.test.ts`; `api/rules.test.ts`; `pages/AutomationPage/rulesValidation.test.ts`

**Edited files:**
- `routes.tsx` — add `{ path: '/boards/:id/automation', element: <AutomationPage /> }`
- `api/client.ts` — add private `mutateJson` + export `MutationResult`/`CodedError`
- `api/types.ts` — add `AutomationRule`, `RuleCondition`, `TriggerExecution`, `WebhookDelivery`, `DeliveryStatus`
- `pages/BoardViewPage/BoardHeader.tsx` — accept `id`, render Board/Automation nav
- `pages/BoardViewPage/BoardViewPage.tsx` — pass `id` to `BoardHeader`
- (optional) `App.tsx`/global CSS — styles for tabs/badge/dialog (no new dependency)

> **Deviation flagged**: TASK-006 §Test Strategy tentatively named the panel test `pages/BoardViewPage/AutomationTab.test.tsx`. Because Decision 1 makes this a **route** (`AutomationPage`), the component and its tests live under a new `pages/AutomationPage/` directory (consistent with `BoardListPage`/`BoardViewPage`), and the test is `AutomationPage.test.tsx`. Same coverage, cleaner location — recorded so it is a decision, not drift.

---

## Testing Strategy (RTL + Vitest — mirrors `ActivityFeed.test.tsx` / `BoardListPage.test.tsx`)

**Conventions reused**: `vi.mock('../../api/client')` (or mock `api/rules.ts`/`api/webhooks.ts`) as the single stubbed seam; render through the shared route table via `MemoryRouter` + `Routes` for the page test (exactly as `BoardListPage.test.tsx` does — avoids the data-router AbortSignal issue noted there); `@testing-library/user-event` for interactions; query by role/name/text, never by class.

- **`AutomationPage.test.tsx`** — reachable at `/boards/:id/automation`; loading→ready; board 404 → `NotFoundState`; Rules/History tablist switches panels (`role="tab"` `aria-selected`); nav "Board" link points to `/boards/:id`.
- **`RuleForm.test.tsx`** — happy submit → `createRule` called with the right body (`condition:{field:'status',operator:'eq',value}`), success prepends + announcer text; client validation blocks blank name / self-loop / bad URL with the exact inline strings; server `400 INVALID_RULE` `details:[{field:'target_status',…},{field:'webhook_url',…}]` maps to the right fields (`aria-invalid`); `400 BOARD_NOT_FOUND` + network → `role="alert"` banner, values retained; submitting disables + `aria-busy`.
- **`RuleList.test.tsx`** — empty → `EmptyState`; renders condition→target sentence + webhook badge; toggle → `updateRule({enabled})`, optimistic flip, rollback on failure; Delete opens `role="alertdialog"` (NOT `window.confirm`), confirm → `deleteRule`, row removed; delete 404 → row removed; `role="switch"` `aria-checked` state.
- **`ConfirmDialog.test.tsx`** — `role="alertdialog"`, labelled/described; focus moves in and restores on close; ESC + outside-click close; locked (no close) while `pending`; Cancel vs Delete callbacks.
- **`HistoryView.test.tsx`** — loading/error+Retry/empty; firings list phrasing; expand → `getWebhookDeliveries`, `DeliveryStatusBadge` renders each status **with text** (assert "Failed"/"Delivered" text, not color); `last_error` reason shown for failed/exhausted; Refresh re-fetches. **No EventSource** asserted (read-only, AC-ASYNC-3).
- **`useRules.test.ts`** — initial load/reload; create prepends; toggle optimistic + rollback; remove (incl. 404-as-success); resets on `boardId` change.
- **`api/rules.test.ts`** — `mutateJson` parses a coded `400` body → `{kind:'validation', error:{code,details}}`; `404` → `validation`/`http` per body; network reject → `{kind:'network'}`; correct method/path/`Content-Type: application/json`/body serialization (mirrors `client.test.ts`).
- **`rulesValidation.test.ts`** — each field check returns the exact backend string; self-loop; `null`/empty webhook accepted.

**What NOT to test** (per project convention): `fetch`/router internals; the backend contract itself (covered by backend suites); real network (seam is always stubbed).

---

## Validation Checklist

- [x] Meets all user goals (create/list/toggle/delete rules; view firing + delivery history)
- [x] Accessible per WCAG 2.1 AA — roles/labels/live-region/focus-trap; status never color-alone; no native dialogs
- [x] Consistent with existing patterns — single I/O seam, `useApiResource` state machine, `useActivityStream`-style hook only where mutable state warrants it, decoupled announcer, `<section aria-labelledby>`, shared `STATUS_LABELS`, routes-table SoT, no new dependency
- [x] Respects systemPatterns.md Guiding Principles (simplicity-first, DI-at-seam, testability by construction) and ux-patterns.md (AlertDialog for destructive; tabs for mutually-exclusive views; inline validation; empty-state-with-CTA; loading discipline)
- [x] Consumes the FROZEN backend contract exactly (coded error envelope, delivery lifecycle, read-only history, no delivery SSE) — redesigns nothing
- [x] Responsive (2-col→1-col form; tables→stacked cards)
- [x] Error/empty/loading states enumerated for every async surface, reusing `EmptyState`/`ErrorState`/`Loading`/`NotFoundState`
- [x] Implementation feasible with react + react-router-dom only

## Next Steps
1. `/banyan-build TASK-006` Phase 4 against this doc (after Phases 1–3 land the API + engine + dispatcher).
2. Build the mutation seam (`mutateJson` + `MutationResult`) first — it unblocks `RuleForm` and `useRules` and is the reusable write-path foundation.
3. Recommended follow-up (out of scope here): promote the `MutationResult`/coded-error pattern to a shared client convention if/when board & card CRUD get a UI.

---

## NEW_TERMS_INTRODUCED
- **Automation page / Automation tab** — the `/boards/:id/automation` route reached from the `BoardHeader` Board/Automation nav; the Phase-4 rule-management + history surface.
- **Mutation seam (`mutateJson` / `MutationResult` / `CodedError`)** — the first write path in the SPA: a private `POST`/`PATCH`/`DELETE` helper in `client.ts` and a result union that carries the backend's coded `{code,message,details}` `400` body so a form can map `details[].field` to inline errors.
- **`useRules(boardId)`** — a purpose-built hook owning the mutable rule-list state (load/reload + create/toggle/remove with optimistic-rollback), the mutation counterpart to the read-only `useApiResource`, following `useActivityStream`'s state-machine discipline.
- **`ConfirmDialog` (`role="alertdialog"`)** — the hand-rolled, focus-trapped confirmation primitive replacing native `window.confirm` for destructive delete (ux-patterns AlertDialog rule).
- **`DeliveryStatusBadge`** — renders the webhook delivery lifecycle (`pending/delivered/failed/exhausted`) as text+icon+color (never color-alone).
- **`formatRuleSentence` / `automationLabels.ts`** — the shared condition→target phrasing helper (mirror of `formatActivitySentence`/`statusLabels.ts`), reusing `STATUS_LABELS`.
