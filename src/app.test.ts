import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import type { BoardsRepository } from './boards/boards.repository';
import type { CardsRepository } from './cards/cards.repository';

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

describe('app', () => {
  const app = createApp({
    checkDb: async () => true,
    boardsRepo: stubBoardsRepo,
    cardsRepo: stubCardsRepo,
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
