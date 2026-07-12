import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import type { BoardsRepository } from '../boards/boards.repository';
import type { CardsRepository } from '../cards/cards.repository';

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

describe('GET /health', () => {
  it('returns 200 { status: ok, db: connected } when the database is reachable', async () => {
    const app = createApp({ checkDb: async () => true, boardsRepo: stubBoardsRepo, cardsRepo: stubCardsRepo });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'connected' });
  });

  it('returns 503 { status: degraded, db: disconnected } when the database is unreachable', async () => {
    const app = createApp({ checkDb: async () => false, boardsRepo: stubBoardsRepo, cardsRepo: stubCardsRepo });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'disconnected' });
  });

  it('returns 503 degraded (and does not crash) when the db check throws', async () => {
    const app = createApp({
      checkDb: async () => {
        throw new Error('connection refused');
      },
      boardsRepo: stubBoardsRepo,
      cardsRepo: stubCardsRepo,
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'disconnected' });
  });

  it('responds with JSON content-type on the healthy path', async () => {
    const app = createApp({ checkDb: async () => true, boardsRepo: stubBoardsRepo, cardsRepo: stubCardsRepo });
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('responds with JSON content-type on the degraded path', async () => {
    const app = createApp({ checkDb: async () => false, boardsRepo: stubBoardsRepo, cardsRepo: stubCardsRepo });
    const res = await request(app).get('/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
