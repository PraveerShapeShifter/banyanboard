/**
 * Card domain model and input shapes.
 *
 * A Card is a unit of work that lives on a Board. This module holds only the
 * data shapes — the HTTP layer (`cards.routes.ts`) and data-access layer
 * (`cards.repository.ts`) depend on these types but not on each other's
 * concrete implementations. Mirrors `boards.types.ts`.
 */

/**
 * The fixed set of columns a card can live in. Persisted as
 * `cards.status VARCHAR(20)` guarded by a CHECK constraint; consumed by
 * FEAT-004's board view to group cards into three columns.
 */
export type CardStatus = 'todo' | 'in_progress' | 'done';

/** A persisted card, as returned by the repository. */
export interface Card {
  id: number;
  /** FK to `boards.id`. Immutable after creation (not exposed on update). */
  board_id: number;
  title: string;
  description: string | null;
  status: CardStatus;
  /** Optional due date. Postgres `DATE`, surfaced as a JS `Date` (or null). */
  due_date: Date | null;
  /** Set once on insert. Postgres `TIMESTAMPTZ`, surfaced as a JS `Date`. */
  created_at: Date;
  /** Bumped on every successful update. */
  updated_at: Date;
}

/**
 * Fields accepted when creating a card. `board_id` and `title` are required;
 * `status` defaults to `'todo'` when omitted; `description`/`due_date` are
 * optional. `due_date` is carried as an ISO date string on the wire.
 */
export interface CreateCardInput {
  board_id: number;
  title: string;
  description?: string | null;
  status?: CardStatus;
  due_date?: string | null;
}

/**
 * Fields accepted when partially updating a card. Every field is optional; an
 * omitted field is left unchanged. `board_id` is intentionally absent — a card
 * cannot be moved to a different board. A `description`/`due_date` of `null`
 * explicitly clears it.
 */
export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  status?: CardStatus;
  due_date?: string | null;
}
