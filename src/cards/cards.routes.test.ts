import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import type { BoardsRepository } from '../boards/boards.repository';
import type { Board, CreateBoardInput, UpdateBoardInput } from '../boards/boards.types';
import type { CardsRepository } from './cards.repository';
import type { Card, CreateCardInput, UpdateCardInput } from './cards.types';
import type { ActivityRepository } from '../activity/activity.repository';
import type { CardActivity, RecordActivityInput } from '../activity/activity.types';
import type { ActivityEmitter } from '../activity/activity.emitter';

/**
 * Supertest-driven integration tests for the Card CRUD HTTP layer, exercising
 * the whole stack (express.json body parsing, validation, routing, error
 * handling, the board_id-existence check) via `createApp(deps)` with stubbed
 * repositories — no live database, mirroring the boards module's convention.
 *
 * Covers AC-ENTRY-1, AC-HAPPY-1..7 (including cascade), AC-ERROR-1..4, and
 * (TASK-005 Phase 1) activity capture on the `PATCH /cards/:id` transition
 * path — AC-VERIFY-1 (no-op / non-status PATCH captures nothing) and
 * AC-VERIFY-2 (a real transition captures exactly one well-formed record and
 * emits exactly one event), per
 * `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`.
 *
 * The boards and cards stubs share a backing store so that AC-HAPPY-7 can be
 * verified at the orchestration layer: `DELETE /boards/:id` cascades to the
 * board's cards, exactly as Postgres' `ON DELETE CASCADE` does in production
 * (the real constraint is smoke-tested against a live DB manually).
 */

/** Build a linked pair of stateful in-memory repositories over a shared store. */
function makeRepos(): { boardsRepo: BoardsRepository; cardsRepo: CardsRepository } {
  const boards = new Map<number, Board>();
  const cards = new Map<number, Card>();
  let nextBoardId = 1;
  let nextCardId = 1;
  let tick = 0;
  // Monotonic clock so `updated_at` strictly advances (deterministic freshness).
  const now = (): Date => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick));
  };

  const boardsRepo: BoardsRepository = {
    async create(input: CreateBoardInput): Promise<Board> {
      const ts = now();
      const b: Board = {
        id: nextBoardId++,
        name: input.name,
        description: input.description ?? null,
        created_at: ts,
        updated_at: ts,
      };
      boards.set(b.id, b);
      return { ...b };
    },
    async findAll() {
      return [...boards.values()].map((b) => ({ ...b }));
    },
    async findById(id: number) {
      const b = boards.get(id);
      return b ? { ...b } : null;
    },
    async update(id: number, input: UpdateBoardInput) {
      const b = boards.get(id);
      if (!b) return null;
      if (input.name !== undefined) b.name = input.name;
      if (input.description !== undefined) b.description = input.description;
      b.updated_at = now();
      return { ...b };
    },
    async delete(id: number) {
      const existed = boards.delete(id);
      if (existed) {
        // Emulate ON DELETE CASCADE: drop every card on the removed board.
        for (const [cid, c] of cards) {
          if (c.board_id === id) cards.delete(cid);
        }
      }
      return existed;
    },
  };

  const cardsRepo: CardsRepository = {
    async create(input: CreateCardInput): Promise<Card> {
      const ts = now();
      const c: Card = {
        id: nextCardId++,
        board_id: input.board_id,
        title: input.title,
        description: input.description ?? null,
        status: input.status ?? 'todo',
        due_date: input.due_date != null ? new Date(input.due_date) : null,
        created_at: ts,
        updated_at: ts,
      };
      cards.set(c.id, c);
      return { ...c };
    },
    async findAll(boardId?: number) {
      let arr = [...cards.values()];
      if (boardId !== undefined) arr = arr.filter((c) => c.board_id === boardId);
      return arr.map((c) => ({ ...c }));
    },
    async findById(id: number) {
      const c = cards.get(id);
      return c ? { ...c } : null;
    },
    async update(id: number, input: UpdateCardInput) {
      const c = cards.get(id);
      if (!c) return null;
      // Captured before mutation so the caller (the PATCH route's capture
      // hook) can detect a real status transition — mirrors the atomic
      // `RETURNING`-CTE contract `cards.repository.update()` gains per the
      // architecture decision (Q2): the update returns the new row *and* the
      // prior status in one round-trip.
      const previousStatus = c.status;
      if (input.title !== undefined) c.title = input.title;
      if (input.description !== undefined) c.description = input.description;
      if (input.status !== undefined) c.status = input.status;
      if (input.due_date !== undefined) c.due_date = input.due_date != null ? new Date(input.due_date) : null;
      c.updated_at = now();
      return { card: { ...c }, previousStatus };
    },
    async delete(id: number) {
      return cards.delete(id);
    },
  };

  return { boardsRepo, cardsRepo };
}

/**
 * A stateful in-memory `ActivityRepository` stub. Records every `record()`
 * call in `records` (in insertion order) so capture tests can assert exact
 * persistence — mirrors the stateful-stub convention used for boards/cards.
 */
function makeActivityRepo(): { activityRepo: ActivityRepository; records: CardActivity[] } {
  const records: CardActivity[] = [];
  let nextId = 1;

  const activityRepo: ActivityRepository = {
    async record(input: RecordActivityInput): Promise<CardActivity> {
      const event: CardActivity = {
        id: nextId++,
        board_id: input.board_id,
        card_id: input.card_id,
        card_title: input.card_title,
        from_status: input.from_status,
        to_status: input.to_status,
        created_at: new Date(),
      };
      records.push(event);
      return { ...event };
    },
    async findRecentByBoard(boardId: number, limit: number) {
      return records.filter((r) => r.board_id === boardId).slice(-limit);
    },
    async findAfter(boardId: number, cursorId: number, limit: number) {
      return records.filter((r) => r.board_id === boardId && r.id > cursorId).slice(0, limit);
    },
  };

  return { activityRepo, records };
}

/**
 * A stub `ActivityEmitter` that records every `emit()` call in `emitted` so
 * capture tests can assert fan-out happened exactly once, without exercising
 * real subscriber delivery (that is Phase 2 scope).
 */
function makeActivityEmitter(): { activityEmitter: ActivityEmitter; emitted: CardActivity[] } {
  const emitted: CardActivity[] = [];

  const activityEmitter: ActivityEmitter = {
    subscribe: () => () => {},
    emit(_boardId: number, event: CardActivity) {
      emitted.push(event);
    },
  };

  return { activityEmitter, emitted };
}

/** A cards repository whose every method rejects — simulates a DB outage (AC-ERROR-4). */
const throwingCardsRepo: CardsRepository = {
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

function makeApp() {
  const { boardsRepo, cardsRepo } = makeRepos();
  const { activityRepo, records: activityRecords } = makeActivityRepo();
  const { activityEmitter, emitted: emittedEvents } = makeActivityEmitter();
  const app = createApp({
    checkDb: async () => true,
    boardsRepo,
    cardsRepo,
    activityRepo,
    activityEmitter,
  });
  return { app, boardsRepo, activityRepo, activityEmitter, activityRecords, emittedEvents };
}

/** Seed a board and return its id (cards need a real board_id to pass the FK check). */
async function seedBoard(app: ReturnType<typeof makeApp>['app']): Promise<number> {
  const res = await request(app).post('/boards').send({ name: 'Sprint Board' });
  return res.body.id as number;
}

describe('Card CRUD routes', () => {
  describe('AC-ENTRY-1: all five routes are mounted and reachable', () => {
    it('handles GET /cards with the resource router (not the generic 404)', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/cards');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('AC-HAPPY-1: create a card', () => {
    it('POST /cards returns 201 with the created card and persists it', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);

      const res = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Write spec', description: 'Draft the card CRUD spec' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        board_id: boardId,
        title: 'Write spec',
        description: 'Draft the card CRUD spec',
        status: 'todo',
        due_date: null,
      });
      expect(typeof res.body.id).toBe('number');
      expect(res.body.created_at).toBeTruthy();
      expect(res.body.updated_at).toBeTruthy();

      // Persisted, not merely echoed: fetch it back by its generated id.
      const fetched = await request(app).get(`/cards/${res.body.id}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body).toEqual(res.body);
    });
  });

  describe('AC-HAPPY-2: list all cards reflects DB state', () => {
    it('GET /cards returns exactly the cards that exist, growing as more are added', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);

      expect((await request(app).get('/cards')).body).toEqual([]);

      await request(app).post('/cards').send({ board_id: boardId, title: 'One' });
      await request(app).post('/cards').send({ board_id: boardId, title: 'Two' });
      expect((await request(app).get('/cards')).body).toHaveLength(2);

      await request(app).post('/cards').send({ board_id: boardId, title: 'Three' });
      const three = await request(app).get('/cards');
      expect(three.body).toHaveLength(3);
      expect(three.body.map((c: Card) => c.title)).toEqual(['One', 'Two', 'Three']);
    });
  });

  describe('AC-HAPPY-3: list only the cards belonging to one board', () => {
    it('GET /cards?board_id=<id> returns only that board\'s cards', async () => {
      const { app } = makeApp();
      const boardA = await seedBoard(app);
      const boardB = await seedBoard(app);

      await request(app).post('/cards').send({ board_id: boardA, title: 'A1' });
      await request(app).post('/cards').send({ board_id: boardA, title: 'A2' });
      await request(app).post('/cards').send({ board_id: boardB, title: 'B1' });

      const onA = await request(app).get(`/cards?board_id=${boardA}`);
      expect(onA.status).toBe(200);
      expect(onA.body.map((c: Card) => c.title)).toEqual(['A1', 'A2']);

      const onB = await request(app).get(`/cards?board_id=${boardB}`);
      expect(onB.body.map((c: Card) => c.title)).toEqual(['B1']);
    });

    it('GET /cards?board_id=abc (malformed filter) returns 400', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/cards?board_id=abc');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });
  });

  describe('AC-HAPPY-4: fetch a single card by id', () => {
    it('GET /cards/:id returns the persisted card', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app).post('/cards').send({ board_id: boardId, title: 'Findable' });

      const res = await request(app).get(`/cards/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });
  });

  describe('AC-HAPPY-5: partial update moves a card between columns', () => {
    it('PATCH /cards/:id updates status, leaves other fields, bumps updated_at', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Task', description: 'keep me' });

      const res = await request(app).patch(`/cards/${created.body.id}`).send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('in_progress');
      expect(res.body.title).toBe('Task');
      expect(res.body.description).toBe('keep me');
      expect(res.body.board_id).toBe(boardId);
      expect(res.body.created_at).toBe(created.body.created_at);
      expect(new Date(res.body.updated_at).getTime()).toBeGreaterThan(
        new Date(created.body.updated_at).getTime(),
      );

      // Change is persisted, not just echoed.
      const fetched = await request(app).get(`/cards/${created.body.id}`);
      expect(fetched.body.status).toBe('in_progress');
    });
  });

  describe('AC-HAPPY-6: delete a card', () => {
    it('DELETE /cards/:id returns 204 empty and the card is gone afterwards', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app).post('/cards').send({ board_id: boardId, title: 'Doomed' });

      const res = await request(app).delete(`/cards/${created.body.id}`);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      const fetched = await request(app).get(`/cards/${created.body.id}`);
      expect(fetched.status).toBe(404);
    });
  });

  describe('AC-HAPPY-7: deleting a board cascades to its cards', () => {
    it('DELETE /boards/:id removes all cards on that board', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const c1 = await request(app).post('/cards').send({ board_id: boardId, title: 'C1' });
      const c2 = await request(app).post('/cards').send({ board_id: boardId, title: 'C2' });

      const del = await request(app).delete(`/boards/${boardId}`);
      expect(del.status).toBe(204);

      expect((await request(app).get(`/cards/${c1.body.id}`)).status).toBe(404);
      expect((await request(app).get(`/cards/${c2.body.id}`)).status).toBe(404);
      expect((await request(app).get(`/cards?board_id=${boardId}`)).body).toEqual([]);
    });
  });

  describe('AC-ERROR-1: 404 for a card that does not exist', () => {
    it('GET /cards/999999 returns 404 with a JSON error body', async () => {
      const { app } = makeApp();
      const res = await request(app).get('/cards/999999');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Card not found' });
    });

    it('PATCH /cards/999999 returns 404', async () => {
      const { app } = makeApp();
      const res = await request(app).patch('/cards/999999').send({ status: 'done' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Card not found' });
    });

    it('DELETE /cards/999999 returns 404', async () => {
      const { app } = makeApp();
      const res = await request(app).delete('/cards/999999');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Card not found' });
    });
  });

  describe('AC-ERROR-2: 400 for invalid create/update payloads', () => {
    it('POST /cards with a missing title returns 400 and creates nothing', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const res = await request(app).post('/cards').send({ board_id: boardId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
      expect((await request(app).get('/cards')).body).toEqual([]);
    });

    it('POST /cards with a status outside the enum returns 400', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const res = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'x', status: 'archived' });
      expect(res.status).toBe(400);
    });

    it('PATCH /cards/:id attempting to change board_id returns 400 and changes nothing', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app).post('/cards').send({ board_id: boardId, title: 'Stable' });

      const res = await request(app).patch(`/cards/${created.body.id}`).send({ board_id: 999 });
      expect(res.status).toBe(400);

      const fetched = await request(app).get(`/cards/${created.body.id}`);
      expect(fetched.body.board_id).toBe(boardId);
    });
  });

  describe('AC-ERROR-3: 400 when board_id references no existing board', () => {
    it('POST /cards with a non-existent board_id returns 400 and creates nothing', async () => {
      const { app } = makeApp();
      const res = await request(app).post('/cards').send({ board_id: 999999, title: 'Orphan' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'board_id does not reference an existing board' });
      expect((await request(app).get('/cards')).body).toEqual([]);
    });
  });

  describe('AC-ERROR-4: safe, non-crashing errors', () => {
    it('POST /cards with malformed JSON returns a 400 JSON error (no crash)', async () => {
      const { app } = makeApp();
      const res = await request(app)
        .post('/cards')
        .set('Content-Type', 'application/json')
        .send('{"title": ');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    });

    it('returns 500 with a generic JSON error when the repository throws, leaking no internals', async () => {
      const { boardsRepo } = makeRepos();
      const { activityRepo } = makeActivityRepo();
      const { activityEmitter } = makeActivityEmitter();
      const app = createApp({
        checkDb: async () => true,
        boardsRepo,
        cardsRepo: throwingCardsRepo,
        activityRepo,
        activityEmitter,
      });
      const res = await request(app).get('/cards');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toContain('connection refused');
      expect(JSON.stringify(res.body)).not.toContain('5432');
    });
  });

  /**
   * TASK-005 Phase 1 — activity capture wired into `PATCH /cards/:id`.
   * Per the architecture decision (Q2), capture is orchestrated in this route
   * handler: `cardsRepo.update()` returns `{ card, previousStatus }` in one
   * round-trip; a real transition (`previousStatus !== card.status`) persists
   * exactly one `card_activity` record and emits exactly one event; a no-op
   * or non-status-only PATCH persists/emits nothing.
   */
  describe('Activity capture on PATCH /cards/:id status transitions', () => {
    it('AC-VERIFY-2: a real status transition persists exactly one well-formed record and emits exactly one event', async () => {
      const { app, activityRecords, emittedEvents } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Deploy pipeline' });

      const res = await request(app)
        .patch(`/cards/${created.body.id}`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(activityRecords).toHaveLength(1);
      expect(activityRecords[0]).toMatchObject({
        board_id: boardId,
        card_id: created.body.id,
        card_title: 'Deploy pipeline',
        from_status: 'todo',
        to_status: 'in_progress',
      });
      expect(typeof activityRecords[0].id).toBe('number');
      expect(activityRecords[0].created_at).toBeInstanceOf(Date);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0]).toMatchObject({
        board_id: boardId,
        card_id: created.body.id,
        from_status: 'todo',
        to_status: 'in_progress',
      });
    });

    it('AC-VERIFY-1: a no-op PATCH sending the same status persists nothing and emits nothing', async () => {
      const { app, activityRecords, emittedEvents } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Stable', status: 'todo' });

      const res = await request(app).patch(`/cards/${created.body.id}`).send({ status: 'todo' });

      expect(res.status).toBe(200);
      expect(activityRecords).toHaveLength(0);
      expect(emittedEvents).toHaveLength(0);
    });

    it('AC-VERIFY-1: a PATCH changing only non-status fields persists nothing and emits nothing', async () => {
      const { app, activityRecords, emittedEvents } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Keep still' });

      const res = await request(app)
        .patch(`/cards/${created.body.id}`)
        .send({ title: 'Renamed', description: 'updated text', due_date: '2026-09-01' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Renamed');
      expect(activityRecords).toHaveLength(0);
      expect(emittedEvents).toHaveLength(0);
    });

    it('grounds two distinct transitions in two distinct, correctly-valued records (stub-detection)', async () => {
      const { app, activityRecords } = makeApp();
      const boardId = await seedBoard(app);
      const cardX = await request(app).post('/cards').send({ board_id: boardId, title: 'Card X' });
      const cardY = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Card Y', status: 'in_progress' });

      await request(app).patch(`/cards/${cardX.body.id}`).send({ status: 'in_progress' });
      await request(app).patch(`/cards/${cardY.body.id}`).send({ status: 'done' });

      expect(activityRecords).toHaveLength(2);
      const [eventX, eventY] = activityRecords;
      expect(eventX).toMatchObject({
        card_id: cardX.body.id,
        card_title: 'Card X',
        from_status: 'todo',
        to_status: 'in_progress',
      });
      expect(eventY).toMatchObject({
        card_id: cardY.body.id,
        card_title: 'Card Y',
        from_status: 'in_progress',
        to_status: 'done',
      });
      expect(eventX).not.toEqual(eventY);
      const validStatuses = ['todo', 'in_progress', 'done'];
      for (const event of activityRecords) {
        expect(validStatuses).toContain(event.from_status);
        expect(validStatuses).toContain(event.to_status);
      }
    });

    it('does not alter the PATCH response contract when a transition is captured', async () => {
      const { app } = makeApp();
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Task', description: 'keep me' });

      const res = await request(app).patch(`/cards/${created.body.id}`).send({ status: 'in_progress' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ['id', 'board_id', 'title', 'description', 'status', 'due_date', 'created_at', 'updated_at'].sort(),
      );
      expect(res.body.status).toBe('in_progress');
      expect(res.body.title).toBe('Task');
      expect(res.body.description).toBe('keep me');
    });

    it('AC-VERIFY-3: a failing activity capture never fails the PATCH (fail-safe, persist-first)', async () => {
      const { boardsRepo, cardsRepo } = makeRepos();
      const { activityEmitter, emitted } = makeActivityEmitter();
      // Activity persistence is down, but the card write itself must still succeed.
      const failingActivityRepo: ActivityRepository = {
        record: async () => {
          throw new Error('activity store unavailable');
        },
        findRecentByBoard: async () => [],
        findAfter: async () => [],
      };
      const app = createApp({
        checkDb: async () => true,
        boardsRepo,
        cardsRepo,
        activityRepo: failingActivityRepo,
        activityEmitter,
      });
      const boardId = await seedBoard(app);
      const created = await request(app)
        .post('/cards')
        .send({ board_id: boardId, title: 'Resilient' });

      const res = await request(app).patch(`/cards/${created.body.id}`).send({ status: 'done' });

      // The write path is unaffected: PATCH still returns 200 with the updated card,
      // and because record() rejected before emit, no event was fanned out.
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect(emitted).toHaveLength(0);
    });
  });
});
