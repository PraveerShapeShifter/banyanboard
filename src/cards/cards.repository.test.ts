import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { PostgresCardsRepository } from './cards.repository';
import type { Card } from './cards.types';

/**
 * Unit tests for `PostgresCardsRepository` against a mocked `pg` Pool.
 *
 * These assert the SQL contract (parameterized queries — no string
 * interpolation, `RETURNING` on mutations, `updated_at` bump on update, the
 * optional `board_id` filter on `findAll`) and the row -> `Card` mapping,
 * without a live database (parity with the boards module's no-live-DB suite).
 */

/** A canonical DB row as `pg` would return it for the `cards` table. */
const row = (over: Partial<Card> = {}): Card => ({
  id: 1,
  board_id: 10,
  title: 'Write spec',
  description: 'Draft the card CRUD spec',
  status: 'todo',
  due_date: null,
  created_at: new Date('2026-07-12T00:00:00.000Z'),
  updated_at: new Date('2026-07-12T00:00:00.000Z'),
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

describe('PostgresCardsRepository', () => {
  describe('create', () => {
    it('issues a parameterized INSERT ... RETURNING and maps the row', async () => {
      const { pool, query } = mockPool({ rows: [row()], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.create({
        board_id: 10,
        title: 'Write spec',
        description: 'Draft the card CRUD spec',
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into cards/i);
      expect(sql).toMatch(/returning/i);
      // Values are parameterized ($1..$5), never interpolated into the SQL text.
      expect(sql).toContain('$1');
      expect(sql).toContain('$5');
      expect(sql).not.toContain('Write spec');
      // board_id, title, description, status (default 'todo'), due_date (null).
      expect(params).toEqual([10, 'Write spec', 'Draft the card CRUD spec', 'todo', null]);
      expect(card).toEqual(row());
    });

    it('defaults an omitted status to "todo" and omitted description/due_date to null', async () => {
      const { pool, query } = mockPool({
        rows: [row({ description: null, status: 'todo', due_date: null })],
        rowCount: 1,
      });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.create({ board_id: 10, title: 'Bare card' });

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([10, 'Bare card', null, 'todo', null]);
      expect(card.status).toBe('todo');
      expect(card.description).toBeNull();
      expect(card.due_date).toBeNull();
    });

    it('passes an explicit status and due_date through as parameters', async () => {
      const due = new Date('2026-08-01T00:00:00.000Z');
      const { pool, query } = mockPool({
        rows: [row({ status: 'in_progress', due_date: due })],
        rowCount: 1,
      });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.create({
        board_id: 10,
        title: 'Scheduled',
        status: 'in_progress',
        due_date: '2026-08-01',
      });

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([10, 'Scheduled', null, 'in_progress', '2026-08-01']);
      expect(card.status).toBe('in_progress');
    });
  });

  describe('findAll', () => {
    it('returns all cards ordered by id when no board filter is given', async () => {
      const cards = [row({ id: 1 }), row({ id: 2, title: 'Second' })];
      const { pool, query } = mockPool({ rows: cards, rowCount: 2 });
      const repo = new PostgresCardsRepository(pool);

      const result = await repo.findAll();

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/select .* from cards/i);
      expect(sql).not.toMatch(/where/i);
      expect(params).toBeUndefined();
      expect(result).toEqual(cards);
    });

    it('filters by board_id with a parameterized WHERE when a board is given', async () => {
      const cards = [row({ id: 3, board_id: 42 })];
      const { pool, query } = mockPool({ rows: cards, rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const result = await repo.findAll(42);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where board_id = \$1/i);
      expect(params).toEqual([42]);
      expect(result).toEqual(cards);
    });

    it('returns an empty array when there are no cards', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresCardsRepository(pool);

      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns the mapped card when the row exists', async () => {
      const { pool, query } = mockPool({ rows: [row({ id: 7 })], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.findById(7);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where id = \$1/i);
      expect(params).toEqual([7]);
      expect(card).toEqual(row({ id: 7 }));
    });

    it('returns null when no row matches the id', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresCardsRepository(pool);

      expect(await repo.findById(999999)).toBeNull();
    });
  });

  describe('update', () => {
    it('applies partial fields, bumps updated_at, and maps the returned row', async () => {
      const updated = row({
        status: 'in_progress',
        updated_at: new Date('2026-07-13T00:00:00.000Z'),
      });
      const { pool, query } = mockPool({ rows: [updated], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.update(1, { status: 'in_progress' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update cards set/i);
      expect(sql).toMatch(/updated_at = now\(\)/i);
      expect(sql).toMatch(/returning/i);
      // Only the provided field is set (parameterized), plus the id in WHERE.
      expect(sql).toContain('status = $1');
      expect(params).toEqual(['in_progress', 1]);
      expect(card).toEqual(updated);
    });

    it('can update title, description, and due_date together', async () => {
      const { pool, query } = mockPool({ rows: [row({ title: 'Renamed' })], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      await repo.update(1, { title: 'Renamed', description: 'New desc', due_date: '2026-09-01' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('description = $2');
      expect(sql).toContain('due_date = $3');
      expect(params).toEqual(['Renamed', 'New desc', '2026-09-01', 1]);
    });

    it('returns null when the card to update does not exist', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresCardsRepository(pool);

      expect(await repo.update(999999, { title: 'X' })).toBeNull();
    });

    it('bumps only updated_at when no updatable fields are supplied', async () => {
      const { pool, query } = mockPool({ rows: [row()], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const card = await repo.update(1, {});

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update cards set updated_at = now\(\)/i);
      expect(params).toEqual([1]);
      expect(card).toEqual(row());
    });
  });

  describe('delete', () => {
    it('returns true when a row was removed', async () => {
      const { pool, query } = mockPool({ rows: [], rowCount: 1 });
      const repo = new PostgresCardsRepository(pool);

      const removed = await repo.delete(1);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/delete from cards where id = \$1/i);
      expect(params).toEqual([1]);
      expect(removed).toBe(true);
    });

    it('returns false when no row matched the id', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresCardsRepository(pool);

      expect(await repo.delete(999999)).toBe(false);
    });
  });
});
