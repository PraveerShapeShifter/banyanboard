import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { PostgresRulesRepository } from './rules.repository';
import type { AutomationRule } from './rules.types';

/**
 * Unit tests for `PostgresRulesRepository` against a mocked `pg` Pool.
 *
 * These assert the SQL contract (parameterized queries — no string
 * interpolation, `RETURNING` on mutations, `updated_at` bump on update,
 * `findEnabledByBoard` filtering + `id ASC` ordering) and the flat
 * `condition_*` columns <-> nested `condition` object mapping incl.
 * `webhook_url`, without a live database (parity with the cards module).
 */

/** A raw DB row as `pg` would return it for `automation_rules` (flat condition_* columns). */
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  board_id: 10,
  name: 'Auto-done',
  condition_field: 'status',
  condition_operator: 'eq',
  condition_value: 'in_progress',
  target_status: 'done',
  enabled: true,
  webhook_url: null,
  created_at: new Date('2026-07-15T00:00:00.000Z'),
  updated_at: new Date('2026-07-15T00:00:00.000Z'),
  ...over,
});

/** The domain shape the repository should map `dbRow()` onto (nested condition). */
const mapped = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 1,
  board_id: 10,
  name: 'Auto-done',
  condition: { field: 'status', operator: 'eq', value: 'in_progress' },
  target_status: 'done',
  enabled: true,
  webhook_url: null,
  created_at: new Date('2026-07-15T00:00:00.000Z'),
  updated_at: new Date('2026-07-15T00:00:00.000Z'),
  ...over,
});

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

describe('PostgresRulesRepository', () => {
  describe('create', () => {
    it('issues a parameterized INSERT ... RETURNING with flattened condition + webhook_url and maps the row', async () => {
      const { pool, query } = mockPool({ rows: [dbRow()], rowCount: 1 });
      const repo = new PostgresRulesRepository(pool);

      const rule = await repo.create({
        board_id: 10,
        name: 'Auto-done',
        condition: { field: 'status', operator: 'eq', value: 'in_progress' },
        target_status: 'done',
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into automation_rules/i);
      expect(sql).toMatch(/returning/i);
      expect(sql).toContain('$1');
      expect(sql).toContain('$8');
      expect(sql).not.toContain('Auto-done');
      // board_id, name, condition_field, condition_operator, condition_value,
      // target_status, enabled (default true), webhook_url (null).
      expect(params).toEqual([10, 'Auto-done', 'status', 'eq', 'in_progress', 'done', true, null]);
      expect(rule).toEqual(mapped());
    });

    it('passes an explicit enabled=false and webhook_url through as parameters', async () => {
      const { pool, query } = mockPool({
        rows: [dbRow({ enabled: false, webhook_url: 'https://h.example.com/x' })],
        rowCount: 1,
      });
      const repo = new PostgresRulesRepository(pool);

      const rule = await repo.create({
        board_id: 10,
        name: 'Auto-done',
        condition: { field: 'status', operator: 'eq', value: 'in_progress' },
        target_status: 'done',
        enabled: false,
        webhook_url: 'https://h.example.com/x',
      });

      const [, params] = query.mock.calls[0];
      expect(params).toEqual([10, 'Auto-done', 'status', 'eq', 'in_progress', 'done', false, 'https://h.example.com/x']);
      expect(rule.enabled).toBe(false);
      expect(rule.webhook_url).toBe('https://h.example.com/x');
    });
  });

  describe('findByBoard', () => {
    it('returns all rules ordered by id when no board filter is given', async () => {
      const rows = [dbRow({ id: 1 }), dbRow({ id: 2, name: 'Second' })];
      const { pool, query } = mockPool({ rows, rowCount: 2 });
      const repo = new PostgresRulesRepository(pool);

      const result = await repo.findByBoard();

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/select .* from automation_rules/i);
      expect(sql).not.toMatch(/where/i);
      expect(params).toBeUndefined();
      expect(result).toEqual([mapped({ id: 1 }), mapped({ id: 2, name: 'Second' })]);
    });

    it('filters by board_id with a parameterized WHERE when a board is given', async () => {
      const { pool, query } = mockPool({ rows: [dbRow({ board_id: 42 })], rowCount: 1 });
      const repo = new PostgresRulesRepository(pool);

      await repo.findByBoard(42);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where board_id = \$1/i);
      expect(params).toEqual([42]);
    });
  });

  describe('findById', () => {
    it('maps the nested condition object from the flat columns', async () => {
      const { pool, query } = mockPool({
        rows: [dbRow({ id: 7, condition_value: 'todo' })],
        rowCount: 1,
      });
      const repo = new PostgresRulesRepository(pool);

      const rule = await repo.findById(7);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where id = \$1/i);
      expect(params).toEqual([7]);
      expect(rule).toEqual(mapped({ id: 7, condition: { field: 'status', operator: 'eq', value: 'todo' } }));
    });

    it('returns null when no row matches', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresRulesRepository(pool);
      expect(await repo.findById(999999)).toBeNull();
    });
  });

  describe('update', () => {
    it('flattens a condition update into three columns, bumps updated_at, and maps the row', async () => {
      const { pool, query } = mockPool({
        rows: [dbRow({ condition_value: 'todo', updated_at: new Date('2026-07-16T00:00:00.000Z') })],
        rowCount: 1,
      });
      const repo = new PostgresRulesRepository(pool);

      const rule = await repo.update(1, {
        condition: { field: 'status', operator: 'eq', value: 'todo' },
        enabled: false,
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update automation_rules set/i);
      expect(sql).toMatch(/updated_at = now\(\)/i);
      expect(sql).toContain('condition_field = $1');
      expect(sql).toContain('condition_operator = $2');
      expect(sql).toContain('condition_value = $3');
      expect(sql).toContain('enabled = $4');
      // condition_field, condition_operator, condition_value, enabled, id.
      expect(params).toEqual(['status', 'eq', 'todo', false, 1]);
      expect(rule?.condition.value).toBe('todo');
    });

    it('can set webhook_url to null', async () => {
      const { pool, query } = mockPool({ rows: [dbRow({ webhook_url: null })], rowCount: 1 });
      const repo = new PostgresRulesRepository(pool);

      await repo.update(5, { webhook_url: null });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('webhook_url = $1');
      expect(params).toEqual([null, 5]);
    });

    it('returns null when the rule to update does not exist', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresRulesRepository(pool);
      expect(await repo.update(999999, { enabled: true })).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true when a row was removed', async () => {
      const { pool, query } = mockPool({ rows: [], rowCount: 1 });
      const repo = new PostgresRulesRepository(pool);

      const removed = await repo.delete(1);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/delete from automation_rules where id = \$1/i);
      expect(params).toEqual([1]);
      expect(removed).toBe(true);
    });

    it('returns false when no row matched', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresRulesRepository(pool);
      expect(await repo.delete(999999)).toBe(false);
    });
  });

  describe('findEnabledByBoard', () => {
    it('filters to enabled=true for the board and orders by id ASC (first-match-wins policy)', async () => {
      const rows = [dbRow({ id: 3 }), dbRow({ id: 7 })];
      const { pool, query } = mockPool({ rows, rowCount: 2 });
      const repo = new PostgresRulesRepository(pool);

      const result = await repo.findEnabledByBoard(10);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where board_id = \$1 and enabled = true/i);
      expect(sql).toMatch(/order by id asc/i);
      expect(params).toEqual([10]);
      expect(result.map((r) => r.id)).toEqual([3, 7]);
    });
  });
});
