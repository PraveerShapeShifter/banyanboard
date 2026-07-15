/**
 * Wire types for the BanyanBoard REST API, typed to the JSON wire format.
 *
 * NOTE: the backend domain types use JS `Date` for the timestamp/date fields,
 * but `res.json()` serializes them to ISO strings — so on the wire these arrive
 * as `string`, not `Date`. These are frontend-owned (a documented deviation from
 * the shared-types recommendation; see the Architecture creative, Q5). `Card`
 * has no `labels` field — it does not exist in the `cards` schema.
 */

export type CardStatus = 'todo' | 'in_progress' | 'done';

export interface Board {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: number;
  board_id: number;
  title: string;
  description: string | null;
  status: CardStatus;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One card-movement event as pushed over the realtime activity stream
 * (TASK-005). `card_id` is nullable — the activity record survives its card's
 * deletion (`card_id` FK is `ON DELETE SET NULL`); `card_title` is
 * denormalized specifically so the feed still reads correctly in that case.
 */
export interface CardActivity {
  id: number;
  board_id: number;
  card_id: number | null;
  card_title: string;
  from_status: CardStatus;
  to_status: CardStatus;
  created_at: string;
}
