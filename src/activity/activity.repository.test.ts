import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { PostgresActivityRepository } from './activity.repository';
import type { CardActivity } from './activity.types';

/**
 * Unit tests for `PostgresActivityRepository` against a mocked `pg` Pool.
 *
 * Mirrors `cards.repository.test.ts`/`boards.repository.test.ts`: assert the
 * SQL contract (parameterized queries — no string interpolation, `RETURNING`
 * on the insert, board-scoped + ordered reads for backfill/replay) and the
 * row -> `CardActivity` mapping, without a live database.
 *
 * Grounded in the architecture decision
 * (`memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`,
 * Q3): identity PK doubles as the cursor; `findRecentByBoard` queries
 * `ORDER BY id DESC LIMIT n` but hands back oldest->newest (ready for the feed
 * to render top-to-bottom on connect); `findAfter` replays `id > cursor`
 * ascending.
 */

/** A canonical DB row as `pg` would return it for the `card_activity` table. */
const row = (over: Partial<CardActivity> = {}): CardActivity => ({
  id: 1,
  board_id: 10,
  card_id: 5,
  card_title: 'Write spec',
  from_status: 'todo',
  to_status: 'in_progress',
  triggered_by: 'manual',
  rule_id: null,
  created_at: new Date('2026-07-15T00:00:00.000Z'),
  ...over,
});

/** Build a mock Pool whose `query` returns the supplied results in order. */
function mockPool(...results: Array<Partial<QueryResult>>): {
  pool: Pool;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const r of results) {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0, ...r });
  }
  return { pool: { query } as unknown as Pool, query };
}

describe('PostgresActivityRepository', () => {
  describe('record', () => {
    it('issues a parameterized INSERT ... RETURNING and maps the created row', async () => {
      const { pool, query } = mockPool({ rows: [row()], rowCount: 1 });
      const repo = new PostgresActivityRepository(pool);

      const event = await repo.record({
        board_id: 10,
        card_id: 5,
        card_title: 'Write spec',
        from_status: 'todo',
        to_status: 'in_progress',
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into card_activity/i);
      expect(sql).toMatch(/returning/i);
      // Values are parameterized ($1..$7), never interpolated into the SQL text.
      expect(sql).toContain('$1');
      expect(sql).toContain('$7');
      expect(sql).not.toContain('Write spec');
      // The two TASK-006 columns are persisted; omitted fields default to the
      // manual, ruleless move (matching the DB column defaults).
      expect(sql).toMatch(/triggered_by/i);
      expect(sql).toMatch(/rule_id/i);
      expect(params).toEqual([10, 5, 'Write spec', 'todo', 'in_progress', 'manual', null]);
      expect(event).toEqual(row());
      expect(event.id).toBe(1);
      expect(event.created_at).toBeInstanceOf(Date);
    });

    it('persists an explicit rule-driven move (triggered_by:\'rule\' + rule_id) as params $6/$7', async () => {
      const ruleRow = row({ triggered_by: 'rule', rule_id: 42 });
      const { pool, query } = mockPool({ rows: [ruleRow], rowCount: 1 });
      const repo = new PostgresActivityRepository(pool);

      const event = await repo.record({
        board_id: 10,
        card_id: 5,
        card_title: 'Write spec',
        from_status: 'todo',
        to_status: 'in_progress',
        triggered_by: 'rule',
        rule_id: 42,
      });

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([10, 5, 'Write spec', 'todo', 'in_progress', 'rule', 42]);
      expect(event.triggered_by).toBe('rule');
      expect(event.rule_id).toBe(42);
    });

    it('maps triggered_by/rule_id back off the returned row', async () => {
      const { pool } = mockPool({ rows: [row({ triggered_by: 'rule', rule_id: 7 })], rowCount: 1 });
      const repo = new PostgresActivityRepository(pool);

      const event = await repo.record({
        board_id: 10,
        card_id: 5,
        card_title: 'Write spec',
        from_status: 'todo',
        to_status: 'in_progress',
        triggered_by: 'rule',
        rule_id: 7,
      });

      expect(event.triggered_by).toBe('rule');
      expect(event.rule_id).toBe(7);
    });
  });

  describe('findRecentByBoard', () => {
    it('issues a board-scoped, bounded, DESC-ordered query and returns oldest-to-newest for display', async () => {
      // Postgres returns newest-first (ORDER BY id DESC LIMIT n); the
      // repository hands back oldest->newest per the architecture contract,
      // so the feed can render top-to-bottom immediately on connect.
      const dbOrder = [row({ id: 3 }), row({ id: 2 }), row({ id: 1 })];
      const { pool, query } = mockPool({ rows: dbOrder, rowCount: 3 });
      const repo = new PostgresActivityRepository(pool);

      const result = await repo.findRecentByBoard(10, 3);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/from card_activity/i);
      expect(sql).toMatch(/where board_id = \$1/i);
      expect(sql).toMatch(/order by id desc/i);
      expect(sql).toMatch(/limit \$2/i);
      expect(params).toEqual([10, 3]);
      expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('returns an empty array when the board has no activity', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresActivityRepository(pool);

      expect(await repo.findRecentByBoard(999999, 50)).toEqual([]);
    });
  });

  describe('findAfter', () => {
    it('issues a cursor-scoped replay query (board_id + id > cursor), ascending, for one board', async () => {
      const events = [row({ id: 6 }), row({ id: 7 })];
      const { pool, query } = mockPool({ rows: events, rowCount: 2 });
      const repo = new PostgresActivityRepository(pool);

      const result = await repo.findAfter(10, 5, 50);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/from card_activity/i);
      expect(sql).toMatch(/where board_id = \$1 and id > \$2/i);
      expect(sql).toMatch(/order by id asc/i);
      expect(params).toEqual([10, 5, 50]);
      expect(result).toEqual(events);
    });
  });
});
