import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { BoardsRepository } from './boards/boards.repository';
import type { CardsRepository } from './cards/cards.repository';
import type { ActivityRepository } from './activity/activity.repository';
import type { ActivityEmitter } from './activity/activity.emitter';

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

describe('app', () => {
  const app = createApp({
    checkDb: async () => true,
    boardsRepo: stubBoardsRepo,
    cardsRepo: stubCardsRepo,
    activityRepo: stubActivityRepo,
    activityEmitter: stubActivityEmitter,
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
});
