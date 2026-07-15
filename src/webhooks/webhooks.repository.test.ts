import { describe, it, expect, vi } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import { PostgresWebhooksRepository } from './webhooks.repository';
import type { TriggerExecution, WebhookDelivery } from './webhooks.types';

/**
 * Unit tests for `PostgresWebhooksRepository` against a mocked `pg` Pool.
 *
 * Assert the SQL contract (parameterized, `RETURNING` on mutations, `payload`
 * omitted from read projections, list filters, `updated_at`/`delivered_at`
 * handling) and the row -> domain mapping for both `trigger_executions` and
 * `webhook_deliveries`, without a live database (parity with the cards module).
 */

const execRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  rule_id: 12,
  card_id: 45,
  board_id: 3,
  from_status: 'in_progress',
  to_status: 'done',
  status: 'executed',
  created_at: new Date('2026-07-15T10:00:00.000Z'),
  ...over,
});

const deliveryRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  trigger_execution_id: 1,
  rule_id: 12,
  url: 'https://hooks.example.com/x',
  status: 'pending',
  attempts: 0,
  last_status_code: null,
  last_error: null,
  created_at: new Date('2026-07-15T10:00:00.000Z'),
  updated_at: new Date('2026-07-15T10:00:00.000Z'),
  delivered_at: null,
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

describe('PostgresWebhooksRepository', () => {
  describe('recordExecution', () => {
    it('inserts a trigger_executions row and maps it', async () => {
      const { pool, query } = mockPool({ rows: [execRow()], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      const exec = await repo.recordExecution({
        rule_id: 12,
        card_id: 45,
        board_id: 3,
        from_status: 'in_progress',
        to_status: 'done',
        status: 'executed',
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into trigger_executions/i);
      expect(sql).toMatch(/returning/i);
      expect(params).toEqual([12, 45, 3, 'in_progress', 'done', 'executed']);
      expect(exec).toEqual<TriggerExecution>({
        id: 1,
        rule_id: 12,
        card_id: 45,
        board_id: 3,
        from_status: 'in_progress',
        to_status: 'done',
        status: 'executed',
        created_at: new Date('2026-07-15T10:00:00.000Z'),
      });
    });
  });

  describe('createDelivery', () => {
    it('inserts a pending delivery with the payload param but never projects payload back', async () => {
      const { pool, query } = mockPool({ rows: [deliveryRow()], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      const delivery = await repo.createDelivery({
        trigger_execution_id: 1,
        rule_id: 12,
        url: 'https://hooks.example.com/x',
        payload: '{"event":"rule.triggered"}',
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/insert into webhook_deliveries/i);
      expect(sql).toMatch(/\bpayload\b/); // payload is written
      expect(sql).not.toMatch(/returning[^;]*payload/i); // but not returned
      expect(params).toEqual([1, 12, 'https://hooks.example.com/x', '{"event":"rule.triggered"}']);
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(0);
      expect('payload' in delivery).toBe(false);
    });
  });

  describe('updateDelivery / lifecycle transitions', () => {
    it('markDelivered sets status=delivered, delivered_at, and maps the row', async () => {
      const { pool, query } = mockPool({
        rows: [
          deliveryRow({
            status: 'delivered',
            attempts: 1,
            last_status_code: 200,
            delivered_at: new Date('2026-07-15T10:00:01.000Z'),
          }),
        ],
        rowCount: 1,
      });
      const repo = new PostgresWebhooksRepository(pool);

      const delivery = await repo.markDelivered(1, { attempts: 1, last_status_code: 200 });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/update webhook_deliveries set/i);
      expect(sql).toMatch(/updated_at = now\(\)/i);
      expect(sql).toContain('status = $1');
      // status, attempts, last_status_code, delivered_at, id.
      expect(params[0]).toBe('delivered');
      expect(params[1]).toBe(1);
      expect(params[2]).toBe(200);
      expect(params[params.length - 1]).toBe(1);
      expect(delivery?.status).toBe('delivered');
      expect(delivery?.delivered_at).toEqual(new Date('2026-07-15T10:00:01.000Z'));
    });

    it('markFailed keeps status=failed and stores the serialized last_error', async () => {
      const err = JSON.stringify({ code: 'WEBHOOK_NON_2XX', message: 'x', details: [] });
      const { pool, query } = mockPool({
        rows: [deliveryRow({ status: 'failed', attempts: 1, last_status_code: 500, last_error: err })],
        rowCount: 1,
      });
      const repo = new PostgresWebhooksRepository(pool);

      const delivery = await repo.markFailed(1, { attempts: 1, last_status_code: 500, last_error: err });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(params[0]).toBe('failed');
      expect(params).toContain(err);
      expect(delivery?.status).toBe('failed');
      expect(delivery?.last_error).toBe(err);
    });

    it('markExhausted sets the terminal exhausted status', async () => {
      const err = JSON.stringify({ code: 'WEBHOOK_EXHAUSTED', message: 'x', details: [] });
      const { pool, query } = mockPool({
        rows: [deliveryRow({ status: 'exhausted', attempts: 3, last_error: err })],
        rowCount: 1,
      });
      const repo = new PostgresWebhooksRepository(pool);

      const delivery = await repo.markExhausted(1, { attempts: 3, last_error: err });

      const [, params] = query.mock.calls[0];
      expect(params[0]).toBe('exhausted');
      expect(delivery?.status).toBe('exhausted');
      expect(delivery?.attempts).toBe(3);
    });

    it('returns null when the delivery to update does not exist', async () => {
      const { pool } = mockPool({ rows: [], rowCount: 0 });
      const repo = new PostgresWebhooksRepository(pool);
      expect(await repo.updateDelivery(999999, { status: 'delivered' })).toBeNull();
    });
  });

  describe('listTriggerExecutions', () => {
    it('returns all ordered by id DESC when no filter is given', async () => {
      const { pool, query } = mockPool({ rows: [execRow({ id: 2 }), execRow({ id: 1 })], rowCount: 2 });
      const repo = new PostgresWebhooksRepository(pool);

      const result = await repo.listTriggerExecutions();

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/from trigger_executions/i);
      expect(sql).not.toMatch(/where/i);
      expect(sql).toMatch(/order by id desc/i);
      expect(params).toEqual([]);
      expect(result.map((e) => e.id)).toEqual([2, 1]);
    });

    it('filters by board_id and rule_id with a parameterized WHERE', async () => {
      const { pool, query } = mockPool({ rows: [execRow()], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      await repo.listTriggerExecutions({ board_id: 3, rule_id: 12 });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where board_id = \$1 and rule_id = \$2/i);
      expect(params).toEqual([3, 12]);
    });
  });

  describe('listDeliveries', () => {
    it('filters by rule_id, trigger_execution_id, and status', async () => {
      const { pool, query } = mockPool({ rows: [deliveryRow()], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      await repo.listDeliveries({ rule_id: 12, trigger_execution_id: 1, status: 'failed' });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where rule_id = \$1 and trigger_execution_id = \$2 and status = \$3/i);
      expect(sql).toMatch(/order by id desc/i);
      expect(params).toEqual([12, 1, 'failed']);
    });

    it('never selects the payload column', async () => {
      const { pool, query } = mockPool({ rows: [deliveryRow()], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      await repo.listDeliveries();

      const [sql] = query.mock.calls[0];
      expect(sql).not.toMatch(/payload/i);
    });
  });

  describe('findDeliveryById', () => {
    it('maps the row when present and returns null otherwise', async () => {
      const { pool, query } = mockPool({ rows: [deliveryRow({ id: 9 })], rowCount: 1 });
      const repo = new PostgresWebhooksRepository(pool);

      const found = await repo.findDeliveryById(9);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where id = \$1/i);
      expect(params).toEqual([9]);
      expect(found?.id).toBe(9);

      const { pool: pool2 } = mockPool({ rows: [], rowCount: 0 });
      const repo2 = new PostgresWebhooksRepository(pool2);
      expect(await repo2.findDeliveryById(999999)).toBeNull();
    });
  });

  describe('findNonTerminalDeliveries', () => {
    it('selects pending+failed rows ordered id ASC with a limit', async () => {
      const rows = [deliveryRow({ id: 1, status: 'pending' }), deliveryRow({ id: 2, status: 'failed' })];
      const { pool, query } = mockPool({ rows, rowCount: 2 });
      const repo = new PostgresWebhooksRepository(pool);

      const result: WebhookDelivery[] = await repo.findNonTerminalDeliveries(50);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/where status in \('pending', 'failed'\)/i);
      expect(sql).toMatch(/order by id asc limit \$1/i);
      expect(params).toEqual([50]);
      expect(result.map((d) => d.status)).toEqual(['pending', 'failed']);
    });
  });
});
