import type { Pool } from 'pg';
import type { CardActivity, RecordActivityInput } from './activity.types';

/**
 * Data-access contract for card activity (TASK-005). The HTTP capture hook
 * and the (Phase 2) SSE transport depend on this interface — not the
 * concrete Postgres class — so both are testable with an in-memory stub.
 * Mirrors `CardsRepository`.
 */
export interface ActivityRepository {
  /** Persists one real status transition. */
  record(input: RecordActivityInput): Promise<CardActivity>;
  /**
   * Bounded backfill for a fresh connect: the most recent `limit` events for
   * a board, returned oldest->newest so the feed can render top-to-bottom
   * immediately.
   */
  findRecentByBoard(boardId: number, limit: number): Promise<CardActivity[]>;
  /**
   * Replay for a reconnect: events after `cursorId` (the last `id` a client
   * saw, i.e. SSE `Last-Event-ID`) for a board, ascending.
   */
  findAfter(boardId: number, cursorId: number, limit: number): Promise<CardActivity[]>;
}

/** The full column projection, kept identical across every read for a stable row shape. */
const COLUMNS =
  'id, board_id, card_id, card_title, from_status, to_status, triggered_by, rule_id, created_at';

/** Map a raw `pg` row onto the `CardActivity` domain shape (guards against stray columns). */
function toActivity(r: {
  id: number;
  board_id: number;
  card_id: number | null;
  card_title: string;
  from_status: CardActivity['from_status'];
  to_status: CardActivity['to_status'];
  triggered_by: CardActivity['triggered_by'];
  rule_id: number | null;
  created_at: Date;
}): CardActivity {
  return {
    id: r.id,
    board_id: r.board_id,
    card_id: r.card_id,
    card_title: r.card_title,
    from_status: r.from_status,
    to_status: r.to_status,
    triggered_by: r.triggered_by,
    rule_id: r.rule_id,
    created_at: r.created_at,
  };
}

/**
 * Postgres-backed `ActivityRepository`. All statements are parameterized
 * (never string-interpolated) to stay injection-safe. The identity PK
 * doubles as the backfill/replay cursor (architecture Q3): `findRecentByBoard`
 * queries `ORDER BY id DESC LIMIT n` (cheapest access path for "most recent
 * n") then reverses in memory to the oldest->newest display order;
 * `findAfter` queries ascending directly since replay is already in the
 * order a client should append it. Mirrors `PostgresCardsRepository`.
 */
export class PostgresActivityRepository implements ActivityRepository {
  constructor(private readonly pool: Pool) {}

  async record(input: RecordActivityInput): Promise<CardActivity> {
    const result = await this.pool.query(
      `INSERT INTO card_activity (board_id, card_id, card_title, from_status, to_status, triggered_by, rule_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
      [
        input.board_id,
        input.card_id,
        input.card_title,
        input.from_status,
        input.to_status,
        input.triggered_by ?? 'manual',
        input.rule_id ?? null,
      ],
    );
    return toActivity(result.rows[0]);
  }

  async findRecentByBoard(boardId: number, limit: number): Promise<CardActivity[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM card_activity WHERE board_id = $1 ORDER BY id DESC LIMIT $2`,
      [boardId, limit],
    );
    return result.rows.map(toActivity).reverse();
  }

  async findAfter(boardId: number, cursorId: number, limit: number): Promise<CardActivity[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM card_activity WHERE board_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
      [boardId, cursorId, limit],
    );
    return result.rows.map(toActivity);
  }
}
