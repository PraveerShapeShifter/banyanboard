import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { PostgresBoardsRepository } from './boards.repository';
import type { Board } from './boards.types';

/**
 * Unit tests for `PostgresBoardsRepository` against a mocked `pg` Pool.
 *
 * These assert the SQL contract (parameterized queries — no string
 * interpolation, `RETURNING` on mutations, `updated_at` bump on update) and the
 * row -> `Board` mapping, without a live database (parity with FEAT-001's
 * no-live-DB unit suite).
 */

/** A canonical DB row as `pg` would return it for the `boards` table. */
const row = (over: Partial<Board> = {}): Board => ({
  id: 1,
  name: 'Sprint Board',
  description: 'Q3 sprint',
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

describe('PostgresBoardsRepository', () => {
  describe('create', () => {
    it('issues a parameterized INSERT ... RETURNING and maps the row', async () => {
      const { pool, query } = mockPool({ rows: [row()], rowCount: 1 });
      const repo = new PostgresBoardsRepository(pool);

      const board = await repo.create({ name: 'Sprint Board', description: 'Q3 sprint' });

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into boards/i);
      expect(sql).toMatch(/returning/i);
      // Values are parameterized ($1, $2), never interpolated into the SQL text.
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).not.toContain('Sprint Board');
      expect(params).toEqual(['Sprint Board', 'Q3 sprint']);
      expect(board).toEqual(row());
    });

    it('defaults an omitted description to null', async () => {
      const { pool, query } = mockPool({
        rows: [row({ description: null })],
        rowCount: 1,
      });
      const repo = new PostgresBoardsRepository(pool);

      const board = await repo.create({ name: 'No Desc' });

      const [, params] = query.mock.calls[0];
      expect(params).toEqual(['No Desc', null]);
      expect(board.description).toBeNull();
    });
  });

  describe('findAll', () => {
    it('returns the mapped array of boards', async () => {
      const boards = [row({ id: 1 }), row({ id: 2, name: 'Backlog' })];
      const { pool, query } = mockPool({ rows: boards, rowCount: 2 });
      const repo = new PostgresBoardsRepository(pool);

      const result = await repo.findAll();

      const [sql] = query.mock.calls[0];
      expect(sql).toMatch(/select .* from boards/i);
      expect(result).toEqual(boards);
    });

    it('returns an empty array when there are no boards', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresBoardsRepository(pool);

      expect(await repo.findAll()).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns the mapped board when the row exists', async () => {
      const { pool, query } = mockPool({ rows: [row({ id: 7 })], rowCount: 1 });
      const repo = new PostgresBoardsRepository(pool);

      const board = await repo.findById(7);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where id = \$1/i);
      expect(params).toEqual([7]);
      expect(board).toEqual(row({ id: 7 }));
    });

    it('returns null when no row matches the id', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresBoardsRepository(pool);

      expect(await repo.findById(999999)).toBeNull();
    });
  });

  describe('update', () => {
    it('applies partial fields, bumps updated_at, and maps the returned row', async () => {
      const updated = row({ name: 'Renamed Board', updated_at: new Date('2026-07-13T00:00:00.000Z') });
      const { pool, query } = mockPool({ rows: [updated], rowCount: 1 });
      const repo = new PostgresBoardsRepository(pool);

      const board = await repo.update(1, { name: 'Renamed Board' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update boards set/i);
      expect(sql).toMatch(/updated_at = now\(\)/i);
      expect(sql).toMatch(/returning/i);
      // Only the provided field is set (parameterized), plus the id in WHERE.
      expect(sql).toContain('name = $1');
      expect(params).toEqual(['Renamed Board', 1]);
      expect(board).toEqual(updated);
    });

    it('can update description independently of name', async () => {
      const { pool, query } = mockPool({
        rows: [row({ description: 'New desc' })],
        rowCount: 1,
      });
      const repo = new PostgresBoardsRepository(pool);

      await repo.update(1, { description: 'New desc' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('description = $1');
      expect(params).toEqual(['New desc', 1]);
    });

    it('returns null when the board to update does not exist', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresBoardsRepository(pool);

      expect(await repo.update(999999, { name: 'X' })).toBeNull();
    });

    it('bumps only updated_at when no updatable fields are supplied', async () => {
      const { pool, query } = mockPool({ rows: [row()], rowCount: 1 });
      const repo = new PostgresBoardsRepository(pool);

      const board = await repo.update(1, {});

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update boards set updated_at = now\(\)/i);
      expect(params).toEqual([1]);
      expect(board).toEqual(row());
    });
  });

  describe('delete', () => {
    it('returns true when a row was removed', async () => {
      const { pool, query } = mockPool({ rows: [], rowCount: 1 });
      const repo = new PostgresBoardsRepository(pool);

      const removed = await repo.delete(1);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/delete from boards where id = \$1/i);
      expect(params).toEqual([1]);
      expect(removed).toBe(true);
    });

    it('returns false when no row matched the id', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresBoardsRepository(pool);

      expect(await repo.delete(999999)).toBe(false);
    });
  });
});
