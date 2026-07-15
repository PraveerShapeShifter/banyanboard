import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { BoardsRepository } from './boards/boards.repository';
import type { CardsRepository } from './cards/cards.repository';
import type { ActivityRepository } from './activity/activity.repository';
import type { ActivityEmitter } from './activity/activity.emitter';
import type { ActivityStreamConfig } from './activity/activity.routes';
import type { RulesRepository } from './rules/rules.repository';
import type { WebhooksRepository } from './webhooks/webhooks.repository';

/** Minimal stub — these tests never exercise the boards routes. */
const stubBoardsRepo: BoardsRepository = {
  create: async () => {
    throw new Error('not used');
  },
  findAll: async () => [],
  findById: async () => null,
  update: async () => null,
  delete: async () => false,
};

/** Minimal stub — these tests never exercise the cards routes. */
const stubCardsRepo: CardsRepository = {
  create: async () => {
    throw new Error('not used');
  },
  findAll: async () => [],
  findById: async () => null,
  update: async () => null,
  delete: async () => false,
};

/**
 * Minimal stub — these tests never exercise activity capture or the (Phase 2)
 * stream. Added so `createApp` type-checks with the `AppDeps` extension from
 * TASK-005 Phase 1 (`activityRepo` + `activityEmitter`), mirroring the
 * boards/cards stub-wiring convention above.
 */
const stubActivityRepo: ActivityRepository = {
  record: async () => {
    throw new Error('not used');
  },
  findRecentByBoard: async () => [],
  findAfter: async () => [],
};

/** Minimal stub — these tests never exercise fan-out. */
const stubActivityEmitter: ActivityEmitter = {
  subscribe: () => () => {},
  emit: () => {},
};

/**
 * Minimal stub — a Phase 2 addition to `AppDeps` (`activityStreamConfig`) so
 * `createActivityRouter` can be constructed with the same DI'd knobs
 * (`backfillLimit`, `heartbeatMs`) used everywhere else instead of reading
 * `process.env` directly. Values are arbitrary here; no test below opens a
 * live stream (which would need heartbeat/close handling) — only the 400
 * validation path, which ends normally.
 */
const stubActivityStreamConfig: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 15000 };

/** Minimal stub — TASK-006 Phase 1 addition; these tests never exercise rule CRUD. */
const stubRulesRepo: RulesRepository = {
  create: async () => {
    throw new Error('not used');
  },
  findByBoard: async () => [],
  findById: async () => null,
  update: async () => null,
  delete: async () => false,
  findEnabledByBoard: async () => [],
};

/** Minimal stub — TASK-006 Phase 1 addition; these tests never exercise the read routes' data. */
const stubWebhooksRepo: WebhooksRepository = {
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
  listTriggerExecutions: async () => [],
  listDeliveries: async () => [],
  findDeliveryById: async () => null,
  findNonTerminalDeliveries: async () => [],
};

describe('app', () => {
  const app = createApp({
    checkDb: async () => true,
    boardsRepo: stubBoardsRepo,
    cardsRepo: stubCardsRepo,
    activityRepo: stubActivityRepo,
    activityEmitter: stubActivityEmitter,
    activityStreamConfig: stubActivityStreamConfig,
    rulesRepo: stubRulesRepo,
    webhooksRepo: stubWebhooksRepo,
  });

  it('responds to GET / with service info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'banyanboard', status: 'running' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('mounts the Phase 2 activity stream route: GET /activity/stream without board_id returns 400 (not the generic 404)', async () => {
    const res = await request(app).get('/activity/stream');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('mounts the TASK-006 rules router: GET /rules is handled (200 array), not the generic 404', async () => {
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('mounts the TASK-006 webhooks read router: GET /trigger-executions is handled (200 array)', async () => {
    const res = await request(app).get('/trigger-executions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('mounts the TASK-006 webhooks read router: GET /webhook-deliveries is handled (200 array)', async () => {
    const res = await request(app).get('/webhook-deliveries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
