import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createRulesRouter } from './rules.routes';
import type { RulesRepository } from './rules.repository';
import type { AutomationRule, CreateRuleInput, UpdateRuleInput } from './rules.types';
import type { BoardsRepository } from '../boards/boards.repository';
import type { Board } from '../boards/boards.types';

/**
 * Supertest-driven integration tests for the automation-rule CRUD HTTP layer
 * (AC-ENTRY-1, AC-HAPPY-1, AC-ERROR-2). Exercises validation, routing, the
 * coded `INVALID_RULE`/`BOARD_NOT_FOUND`/`RULE_NOT_FOUND` envelope, the
 * `board_id` FK-existence check, and the optional `?board_id=` filter via a
 * focused express app with stubbed repositories — no live database.
 */

/** A stateful in-memory `RulesRepository` over a Map. */
function makeRulesRepo(): RulesRepository {
  const rules = new Map<number, AutomationRule>();
  let nextId = 1;
  let tick = 0;
  const now = (): Date => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, tick));
  };

  return {
    async create(input: CreateRuleInput): Promise<AutomationRule> {
      const ts = now();
      const rule: AutomationRule = {
        id: nextId++,
        board_id: input.board_id,
        name: input.name,
        condition: input.condition,
        target_status: input.target_status,
        enabled: input.enabled ?? true,
        webhook_url: input.webhook_url ?? null,
        created_at: ts,
        updated_at: ts,
      };
      rules.set(rule.id, rule);
      return { ...rule };
    },
    async findByBoard(boardId?: number) {
      let arr = [...rules.values()];
      if (boardId !== undefined) arr = arr.filter((r) => r.board_id === boardId);
      return arr.map((r) => ({ ...r }));
    },
    async findById(id: number) {
      const r = rules.get(id);
      return r ? { ...r } : null;
    },
    async update(id: number, input: UpdateRuleInput) {
      const r = rules.get(id);
      if (!r) return null;
      if (input.name !== undefined) r.name = input.name;
      if (input.condition !== undefined) r.condition = input.condition;
      if (input.target_status !== undefined) r.target_status = input.target_status;
      if (input.enabled !== undefined) r.enabled = input.enabled;
      if (input.webhook_url !== undefined) r.webhook_url = input.webhook_url;
      r.updated_at = now();
      return { ...r };
    },
    async delete(id: number) {
      return rules.delete(id);
    },
    async findEnabledByBoard(boardId: number) {
      return [...rules.values()]
        .filter((r) => r.board_id === boardId && r.enabled)
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r }));
    },
  };
}

/** A boards repo where board id 10 exists (for the FK check), nothing else. */
const boardsRepo: BoardsRepository = {
  create: async () => {
    throw new Error('not used');
  },
  findAll: async () => [],
  async findById(id: number): Promise<Board | null> {
    if (id === 10) {
      return {
        id: 10,
        name: 'Sprint Board',
        description: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }
    return null;
  },
  update: async () => null,
  delete: async () => false,
};

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(createRulesRouter(makeRulesRepo(), boardsRepo));
  return app;
}

/** A valid create body scoped to the existing board 10. */
const validBody = () => ({
  board_id: 10,
  name: 'Auto-done',
  condition: { field: 'status', operator: 'eq', value: 'in_progress' },
  target_status: 'done',
});

describe('Automation-rule CRUD routes', () => {
  describe('AC-ENTRY-1 / AC-HAPPY-1: create → get → list → patch → delete', () => {
    it('POST /rules returns 201 with the persisted rule (enabled defaults to true)', async () => {
      const app = makeApp();
      const res = await request(app).post('/rules').send(validBody());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        board_id: 10,
        name: 'Auto-done',
        condition: { field: 'status', operator: 'eq', value: 'in_progress' },
        target_status: 'done',
        enabled: true,
        webhook_url: null,
      });
      expect(typeof res.body.id).toBe('number');
    });

    it('walks the full lifecycle with the right status codes', async () => {
      const app = makeApp();
      const created = await request(app).post('/rules').send(validBody());
      const id = created.body.id;

      const got = await request(app).get(`/rules/${id}`);
      expect(got.status).toBe(200);
      expect(got.body).toEqual(created.body);

      const patched = await request(app).patch(`/rules/${id}`).send({ enabled: false });
      expect(patched.status).toBe(200);
      expect(patched.body.enabled).toBe(false);
      expect(patched.body.condition).toEqual(created.body.condition);
      expect(patched.body.target_status).toBe(created.body.target_status);
      expect(patched.body.board_id).toBe(10);

      const del = await request(app).delete(`/rules/${id}`);
      expect(del.status).toBe(204);
      expect(del.text).toBe('');

      const gone = await request(app).get(`/rules/${id}`);
      expect(gone.status).toBe(404);
    });

    it('GET /rules?board_id= filters to the board; omitting it returns all', async () => {
      const app = makeApp();
      await request(app).post('/rules').send(validBody());
      await request(app).post('/rules').send({ ...validBody(), name: 'Second' });

      const all = await request(app).get('/rules');
      expect(all.status).toBe(200);
      expect(all.body).toHaveLength(2);

      const onBoard = await request(app).get('/rules?board_id=10');
      expect(onBoard.status).toBe(200);
      expect(onBoard.body).toHaveLength(2);

      const otherBoard = await request(app).get('/rules?board_id=999');
      expect(otherBoard.body).toEqual([]);
    });
  });

  describe('AC-ERROR-2: coded validation + FK + 404 envelopes', () => {
    it('POST /rules with an invalid body returns 400 INVALID_RULE with details', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/rules')
        .send({ ...validBody(), target_status: 'archived' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_RULE');
      expect(res.body.message).toBe('Validation failed');
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details).toContainEqual({
        field: 'target_status',
        error: 'target_status must be one of: todo, in_progress, done',
      });
    });

    it('POST /rules with a dangling board_id returns 400 BOARD_NOT_FOUND (no details)', async () => {
      const app = makeApp();
      const res = await request(app).post('/rules').send({ ...validBody(), board_id: 999 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        code: 'BOARD_NOT_FOUND',
        message: 'board_id does not reference an existing board',
      });
    });

    it('PATCH /rules/:id attempting to change board_id returns 400 INVALID_RULE', async () => {
      const app = makeApp();
      const created = await request(app).post('/rules').send(validBody());
      const res = await request(app).patch(`/rules/${created.body.id}`).send({ board_id: 999 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_RULE');
      expect(res.body.details).toContainEqual({
        field: 'board_id',
        error: 'board_id cannot be changed after creation',
      });
    });

    it('GET/PATCH/DELETE /rules/:id for a missing or malformed id returns 404 RULE_NOT_FOUND', async () => {
      const app = makeApp();
      const missing = await request(app).get('/rules/999999');
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ code: 'RULE_NOT_FOUND', message: 'Rule not found' });

      const malformed = await request(app).get('/rules/abc');
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual({ code: 'RULE_NOT_FOUND', message: 'Rule not found' });

      expect((await request(app).patch('/rules/999999').send({ enabled: true })).status).toBe(404);
      expect((await request(app).delete('/rules/999999')).status).toBe(404);
    });

    it('GET /rules?board_id=abc (malformed filter) returns 400 INVALID_RULE', async () => {
      const app = makeApp();
      const res = await request(app).get('/rules?board_id=abc');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_RULE');
    });
  });
});
