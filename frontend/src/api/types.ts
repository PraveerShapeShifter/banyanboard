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
