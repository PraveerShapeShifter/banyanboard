import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createWebhooksRouter } from './webhooks.routes';
import type { WebhooksRepository } from './webhooks.repository';
import type {
  TriggerExecution,
  TriggerExecutionFilter,
  WebhookDelivery,
  WebhookDeliveryFilter,
} from './webhooks.types';

/**
 * Supertest-driven tests for the READ-ONLY webhook history endpoints
 * (`GET /trigger-executions`, `GET /webhook-deliveries`, `/webhook-deliveries/:id`).
 * Asserts filter passthrough, the `error` projection of `last_error`, payload
 * omission, and 404 on a missing delivery, via a focused express app with a
 * stub repository — no live database.
 */

const exec = (over: Partial<TriggerExecution> = {}): TriggerExecution => ({
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

const delivery = (over: Partial<WebhookDelivery> = {}): WebhookDelivery => ({
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

/** Build a stub repo capturing the filters it is called with, returning seeded rows. */
function makeStub(opts: {
  executions?: TriggerExecution[];
  deliveries?: WebhookDelivery[];
  byId?: WebhookDelivery | null;
}): {
  repo: WebhooksRepository;
  calls: { execFilter?: TriggerExecutionFilter; deliveryFilter?: WebhookDeliveryFilter; byId?: number };
} {
  const calls: { execFilter?: TriggerExecutionFilter; deliveryFilter?: WebhookDeliveryFilter; byId?: number } = {};
  const repo: WebhooksRepository = {
    recordExecution: async () => {
      throw new Error('not used');
    },
    createDelivery: async () => {
      throw new Error('not used');
    },
    updateDelivery: async () => null,
    markDelivered: async () => null,
    markFailed: async () => null,
    markExhausted: async () => null,
    async listTriggerExecutions(filter?: TriggerExecutionFilter) {
      calls.execFilter = filter;
      return opts.executions ?? [];
    },
    async listDeliveries(filter?: WebhookDeliveryFilter) {
      calls.deliveryFilter = filter;
      return opts.deliveries ?? [];
    },
    async findDeliveryById(id: number) {
      calls.byId = id;
      return opts.byId ?? null;
    },
    findNonTerminalDeliveries: async () => [],
  };
  return { repo, calls };
}

function makeApp(repo: WebhooksRepository): Express {
  const app = express();
  app.use(express.json());
  app.use(createWebhooksRouter(repo));
  return app;
}

describe('Webhook read routes', () => {
  describe('GET /trigger-executions', () => {
    it('returns 200 with the executions and passes board_id/rule_id filters through', async () => {
      const { repo, calls } = makeStub({ executions: [exec()] });
      const app = makeApp(repo);

      const res = await request(app).get('/trigger-executions?board_id=3&rule_id=12');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ id: 1, board_id: 3, rule_id: 12, status: 'executed' });
      expect(calls.execFilter).toEqual({ board_id: 3, rule_id: 12 });
    });

    it('returns 400 for a malformed board_id filter', async () => {
      const { repo } = makeStub({});
      const res = await request(makeApp(repo)).get('/trigger-executions?board_id=abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('GET /webhook-deliveries', () => {
    it('projects last_error into an error object and omits payload', async () => {
      const coded = { code: 'WEBHOOK_NON_2XX', message: 'Webhook returned a non-2xx status', details: [{ field: 'status', error: '500 is not 2xx' }] };
      const { repo } = makeStub({
        deliveries: [delivery({ status: 'failed', attempts: 1, last_status_code: 500, last_error: JSON.stringify(coded) })],
      });
      const app = makeApp(repo);

      const res = await request(app).get('/webhook-deliveries');
      expect(res.status).toBe(200);
      const row = res.body[0];
      expect(row.error).toEqual(coded);
      expect(row.last_error).toBeUndefined();
      expect(row.payload).toBeUndefined();
      expect(row).toMatchObject({ id: 1, status: 'failed', attempts: 1, last_status_code: 500 });
    });

    it('exposes error: null for a delivery with no last_error', async () => {
      const { repo } = makeStub({ deliveries: [delivery()] });
      const res = await request(makeApp(repo)).get('/webhook-deliveries');
      expect(res.body[0].error).toBeNull();
    });

    it('passes rule_id/trigger_execution_id/status filters through', async () => {
      const { repo, calls } = makeStub({ deliveries: [] });
      const app = makeApp(repo);

      await request(app).get('/webhook-deliveries?rule_id=12&trigger_execution_id=1&status=delivered');
      expect(calls.deliveryFilter).toEqual({ rule_id: 12, trigger_execution_id: 1, status: 'delivered' });
    });

    it('returns 400 for a status filter outside the enum', async () => {
      const { repo } = makeStub({});
      const res = await request(makeApp(repo)).get('/webhook-deliveries?status=bogus');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('GET /webhook-deliveries/:id', () => {
    it('returns 200 with the projected delivery when found', async () => {
      const { repo, calls } = makeStub({ byId: delivery({ id: 9 }) });
      const res = await request(makeApp(repo)).get('/webhook-deliveries/9');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(9);
      expect(res.body.error).toBeNull();
      expect(res.body.payload).toBeUndefined();
      expect(calls.byId).toBe(9);
    });

    it('returns 404 when the delivery is missing or the id is malformed', async () => {
      const { repo } = makeStub({ byId: null });
      const app = makeApp(repo);

      const missing = await request(app).get('/webhook-deliveries/999999');
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ error: 'Webhook delivery not found' });

      const malformed = await request(app).get('/webhook-deliveries/abc');
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual({ error: 'Webhook delivery not found' });
    });
  });
});
