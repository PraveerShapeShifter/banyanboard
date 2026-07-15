# UX Patterns

<!--
  CROSS-FILE CONSISTENCY GUARDRAIL (read before editing)

  This file is the canonical source for COMPONENT-USAGE and BEHAVIORAL-UI rules
  (AlertDialog vs Dialog, Drawer vs Modal, Tabs vs Sections, Toast placement,
  empty-state requirements, mobile adaptation). Anything else MUST live where it
  belongs and be REFERENCED here, not restated:

    | Topic                                          | Canonical source       |
    |------------------------------------------------|------------------------|
    | Tech stack, component library version, E2E fw  | techContext.md         |
    | Design tokens (color, spacing, typography)     | techContext.md OR      |
    |                                                | tokens.json /          |
    |                                                | tailwind.config.*      |
    | Architecture patterns, error conventions       | systemPatterns.md      |
    | Testing patterns, what's deliberately untested | systemPatterns.md      |
    | Persona definitions, user roles, NFRs          | productBrief.md        |

  REFERENCE syntax — write `see techContext.md → Design Tokens`, NOT inline copies.
  The /banyan-uat synthesizer follows references when checking conformance; a
  missing reference target itself becomes a finding.

  Why: duplicate facts drift. When ux-patterns.md, systemPatterns.md, and
  techContext.md disagree on the spacing scale, UAT findings become noise and
  trust in the file collapses. Reference once; layer behavior on top.

  ALLOWED: "Form field heights: 40px (≡ --space-10 from techContext.md → Design
  Tokens). Not 36px or 44px." — references the canonical source AND adds a
  UX-specific behavioral rule.

  FORBIDDEN: copy-pasting the spacing scale into this file.
-->

**Last Updated**: 2026-07-15
**Source(s)**: hand-written
**Source hashes**: { }

---

## Dialogs & Modals

### Rule: Confirmation dialogs use `AlertDialog` for destructive actions
- When: deleting, archiving, or anything destructive/irreversible
- Not: plain `Dialog` (no `role="alertdialog"`)
- Reference: [add example screenshot path or `see techContext.md → Component Library`]

### Rule: Modals close on ESC and outside-click
- Exception: in-progress async operation (loading spinner visible)

## Drawer vs Modal

### Rule: Side drawer for contextual detail/inspector panels (≥ 768px)
- Examples: detail inspectors, profile panels
- Anti-pattern: full-screen modal when user needs to reference the list behind it

### Rule: Bottom sheet / drawer for compound forms on mobile (≤ 640px)
- Dismissal: tap outside or explicit close button

## Tabs vs Sections

### Rule: Tabs for switching between mutually exclusive views of the same resource
- Anti-pattern: tabs for "steps" in a wizard — use step indicators instead

### Rule: Sections (accordion or sectioned scroll) for viewing all related info at once

## Forms

### Layout
- Single column on mobile; up to 2-column on desktop
- Required indicator: `*` after label, color not-red-alone
- Field heights: [reference design tokens — e.g., `see techContext.md → Design Tokens`]

### Validation
- Inline, below field
- Red only on submit attempt or blur after touch
- Do not block typing

### Errors
- Error banner top of form for server errors
- Field-level for client-side validation
- Retry action always available

## Empty States

### Rule: Always provide an empty-state view with one primary CTA
- Examples: empty list view → "New X" CTA

## Toasts & Banners

### Rule: Toast top-right, auto-dismiss after [duration]
### Rule: Banner full-width, persistent until dismissed, only for page-wide state

## Loading States

### Rule: Skeleton for content areas (cards, tables)
### Rule: Spinner for explicit async actions (submit, save)
### Rule: Never show raw JSON or "undefined" during load

## Mobile Adaptation

### Breakpoint: [reference token — e.g., `see techContext.md → Breakpoints`]
### Rule: Tables → card list on mobile
### Rule: Multi-column forms → single column
### Rule: Right-side inspectors → bottom drawers

## Tokens

> Tokens (color, spacing, typography) are NOT defined here. Reference the canonical source.
>
> - Color: `see techContext.md → Design Tokens` (or `tailwind.config.ts`)
> - Spacing: `see techContext.md → Design Tokens`
> - Typography: `see techContext.md → Design Tokens`

---

## Conflicts Requiring Resolution

<!--
  Populated by /banyan-ux-ingest when sources disagree (v1.9 multi-source ingest).
  Hand-authored files start with this section empty.

  Example:
  ### CONFLICT: Confirmation dialog type
  - Storybook: `Dialog`
  - Live-walk: `AlertDialog` on destructive actions
  - Design doc: silent
  - Human decision: <empty until resolved>
-->

(none)
