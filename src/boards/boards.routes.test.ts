import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import type { BoardsRepository } from './boards.repository';
import type { Board, CreateBoardInput, UpdateBoardInput } from './boards.types';

/**
 * Supertest-driven integration tests for the Board CRUD HTTP layer, exercising
 * the whole stack (express.json body parsing, validation, routing, error
 * handling) via `createApp(deps)` with a stubbed repository — no live database,
 * mirroring FEAT-001's `health.test.ts`/`app.test.ts` convention.
 *
 * Covers AC-ENTRY-1, AC-HAPPY-1..5, AC-ERROR-1 (404), AC-ERROR-2 (400
 * validation), and AC-ERROR-3 (malformed JSON -> 400, DB failure -> 500).
 */

/**
 * Stateful in-memory `BoardsRepository`. Persistence semantics (create->get,
 * patch->get, delete->get(404)) are verified end-to-end, not just echoed
 * responses. A monotonic clock guarantees `updated_at` strictly advances so the
 * PATCH freshness assertion is deterministic.
 */
class InMemoryBoardsRepository implements BoardsRepository {
  private readonly boards = new Map<number, Board>();
  private nextId = 1;
  private tick = 0;

  private now(): Date {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, this.tick));
  }

  async create(input: CreateBoardInput): Promise<Board> {
    const ts = this.now();
    const board: Board = {
      id: this.nextId++,
      name: input.name,
      description: input.description ?? null,
      created_at: ts,
      updated_at: ts,
    };
    this.boards.set(board.id, board);
    return { ...board };
  }

  async findAll(): Promise<Board[]> {
    return [...this.boards.values()].map((b) => ({ ...b }));
  }

  async findById(id: number): Promise<Board | null> {
    const b = this.boards.get(id);
    return b ? { ...b } : null;
  }

  async update(id: number, input: UpdateBoardInput): Promise<Board | null> {
    const b = this.boards.get(id);
    if (!b) return null;
    if (input.name !== undefined) b.name = input.name;
    if (input.description !== undefined) b.description = input.description;
    b.updated_at = this.now();
    return { ...b };
  }

  async delete(id: number): Promise<boolean> {
    return this.boards.delete(id);
  }
}

/** A repository whose every method rejects — simulates a DB outage (AC-ERROR-3). */
const throwingRepo: BoardsRepository = {
  create: async () => {
    throw new Error('connection refused: 127.0.0.1:5432');
  },
  findAll: async () => {
    throw new Error('connection refused: 127.0.0.1:5432');
  },
  findById: async () => {
    throw new Error('connection refused: 127.0.0.1:5432');
  },
  update: async () => {
    throw new Error('connection refused: 127.0.0.1:5432');
  },
  delete: async () => {
    throw new Error('connection refused: 127.0.0.1:5432');
  },
};

function makeApp(repo: BoardsRepository = new InMemoryBoardsRepository()) {
  return createApp({ checkDb: async () => true, boardsRepo: repo });
}

describe('Board CRUD routes', () => {
  describe('AC-ENTRY-1: all five routes are mounted and reachable', () => {
    it('handles GET /boards with the resource router (not the generic 404)', async () => {
      const res = await request(makeApp()).get('/boards');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('AC-HAPPY-1: create a board', () => {
    it('POST /boards returns 201 with the created board and persists it', async () => {
      const app = makeApp();

      const res = await request(app)
        .post('/boards')
        .send({ name: 'Sprint Board', description: 'Q3 sprint' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Sprint Board', description: 'Q3 sprint' });
      expect(typeof res.body.id).toBe('number');
      expect(res.body.created_at).toBeTruthy();
      expect(res.body.updated_at).toBeTruthy();

      // Persisted, not merely echoed: fetch it back by its generated id.
      const fetched = await request(app).get(`/boards/${res.body.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toEqual(res.body);
    });

    it('defaults an omitted description to null', async () => {
      const res = await request(makeApp()).post('/boards').send({ name: 'No Desc' });
      expect(res.status).toBe(201);
      expect(res.body.description).toBeNull();
    });
  });

  describe('AC-HAPPY-2: list all boards reflects DB state', () => {
    it('GET /boards returns exactly the boards that exist, growing as more are added', async () => {
      const app = makeApp();

      expect((await request(app).get('/boards')).body).toEqual([]);

      await request(app).post('/boards').send({ name: 'One' });
      await request(app).post('/boards').send({ name: 'Two' });

      const two = await request(app).get('/boards');
      expect(two.body).toHaveLength(2);

      await request(app).post('/boards').send({ name: 'Three' });
      const three = await request(app).get('/boards');
      expect(three.body).toHaveLength(3);
      expect(three.body.map((b: Board) => b.name)).toEqual(['One', 'Two', 'Three']);
    });
  });

  describe('AC-HAPPY-3: fetch a single board by id', () => {
    it('GET /boards/:id returns the persisted board', async () => {
      const app = makeApp();
      const created = await request(app).post('/boards').send({ name: 'Findable' });

      const res = await request(app).get(`/boards/${created.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });
  });

  describe('AC-HAPPY-4: partial update', () => {
    it('PATCH /boards/:id updates name, leaves description and created_at, bumps updated_at', async () => {
      const app = makeApp();
      const created = await request(app)
        .post('/boards')
        .send({ name: 'Original', description: 'keep me' });

      const res = await request(app)
        .patch(`/boards/${created.body.id}`)
        .send({ name: 'Renamed Board' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed Board');
      expect(res.body.description).toBe('keep me');
      expect(res.body.created_at).toBe(created.body.created_at);
      expect(new Date(res.body.updated_at).getTime()).toBeGreaterThan(
        new Date(created.body.updated_at).getTime(),
      );

      // Change is persisted, not just echoed.
      const fetched = await request(app).get(`/boards/${created.body.id}`);
      expect(fetched.body.name).toBe('Renamed Board');
    });
  });

  describe('AC-HAPPY-5: delete a board', () => {
    it('DELETE /boards/:id returns 204 empty and the board is gone afterwards', async () => {
      const app = makeApp();
      const created = await request(app).post('/boards').send({ name: 'Doomed' });

      const res = await request(app).delete(`/boards/${created.body.id}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      const fetched = await request(app).get(`/boards/${created.body.id}`);
      expect(fetched.status).toBe(404);
    });
  });

  describe('AC-ERROR-1: 404 for a board that does not exist', () => {
    it('GET /boards/999999 returns 404 with a JSON error body', async () => {
      const res = await request(makeApp()).get('/boards/999999');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Board not found' });
    });

    it('PATCH /boards/999999 returns 404', async () => {
      const res = await request(makeApp()).patch('/boards/999999').send({ name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Board not found' });
    });

    it('DELETE /boards/999999 returns 404', async () => {
      const res = await request(makeApp()).delete('/boards/999999');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Board not found' });
    });
  });

  describe('AC-ERROR-2: 400 for invalid create/update payloads', () => {
    it('POST /boards with a missing name returns 400 and creates nothing', async () => {
      const app = makeApp();
      const res = await request(app).post('/boards').send({ description: 'no name' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      expect((await request(app).get('/boards')).body).toEqual([]);
    });

    it('POST /boards with a blank name returns 400', async () => {
      const res = await request(makeApp()).post('/boards').send({ name: '   ' });
      expect(res.status).toBe(400);
    });

    it('POST /boards with a name over 120 chars returns 400', async () => {
      const res = await request(makeApp())
        .post('/boards')
        .send({ name: 'a'.repeat(121) });
      expect(res.status).toBe(400);
    });

    it('PATCH /boards/:id with a non-string name returns 400 and changes nothing', async () => {
      const app = makeApp();
      const created = await request(app).post('/boards').send({ name: 'Stable' });

      const res = await request(app)
        .patch(`/boards/${created.body.id}`)
        .send({ name: 123 });
      expect(res.status).toBe(400);

      const fetched = await request(app).get(`/boards/${created.body.id}`);
      expect(fetched.body.name).toBe('Stable');
    });
  });

  describe('AC-ERROR-3: safe, non-crashing errors', () => {
    it('POST /boards with malformed JSON returns a 400 JSON error (no crash)', async () => {
      const res = await request(makeApp())
        .post('/boards')
        .set('Content-Type', 'application/json')
        .send('{"name": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('returns 500 with a generic JSON error when the repository throws, leaking no internals', async () => {
      const res = await request(makeApp(throwingRepo)).get('/boards');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
      // No driver text / stack trace leaks into the response body.
      expect(JSON.stringify(res.body)).not.toContain('connection refused');
      expect(JSON.stringify(res.body)).not.toContain('5432');
    });
  });
});
