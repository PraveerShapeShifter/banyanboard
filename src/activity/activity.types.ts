import type { CardStatus } from '../cards/cards.types';

/**
 * Whether a captured transition was a manual move (`PATCH /cards/:id` by a
 * client) or a rule-driven auto-move (the FEAT-006 engine). Persisted as
 * `card_activity.triggered_by VARCHAR(10) NOT NULL DEFAULT 'manual'`.
 */
export type ActivityTrigger = 'manual' | 'rule';

/**
 * Activity domain model and input shapes.
 *
 * A `CardActivity` is a single persisted record of a real card status
 * transition (TASK-005). This module holds only the data shapes — the
 * data-access layer (`activity.repository.ts`) and the HTTP capture hook in
 * `cards.routes.ts` depend on these types but not on each other's concrete
 * implementations. Mirrors `cards.types.ts`.
 */

/** A persisted activity record, as returned by the repository. */
export interface CardActivity {
  id: number;
  /** FK to `boards.id`. `ON DELETE CASCADE` — activity dies with its board. */
  board_id: number;
  /**
   * FK to `cards.id`, nullable. `ON DELETE SET NULL` — a card's movement
   * history survives the card being deleted (the denormalized `card_title`
   * keeps the record readable).
   */
  card_id: number | null;
  /** Denormalized snapshot of the card's title at capture time. */
  card_title: string;
  from_status: CardStatus;
  to_status: CardStatus;
  /**
   * How the move was triggered (TASK-006): `'manual'` for a client PATCH,
   * `'rule'` for a rule-driven auto-move. Optional on the type (the DB column
   * defaults to `'manual'`), so consumers can distinguish automated moves.
   */
  triggered_by?: ActivityTrigger;
  /**
   * The automation rule that drove this move when `triggered_by === 'rule'`;
   * `null`/absent for a manual move (`ON DELETE SET NULL` keeps history after a
   * rule is deleted).
   */
  rule_id?: number | null;
  /** Set once on insert. Postgres `TIMESTAMPTZ`, surfaced as a JS `Date`. */
  created_at: Date;
}

/**
 * The wire/event shape pushed to subscribers (`ActivityEmitter.emit`) and, in
 * Phase 2, framed over SSE. Identical to `CardActivity` today — kept as a
 * distinct alias so the transport layer can diverge from the persistence
 * shape later without touching the repository contract.
 */
export type ActivityEvent = CardActivity;

/** Fields required to capture one real card status transition. */
export interface RecordActivityInput {
  board_id: number;
  card_id: number;
  card_title: string;
  from_status: CardStatus;
  to_status: CardStatus;
  /** Defaults to `'manual'` when omitted (matches the DB column default). */
  triggered_by?: ActivityTrigger;
  /** The driving rule for a `'rule'` move; `null`/omitted for a manual move. */
  rule_id?: number | null;
}
