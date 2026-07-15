import { Router, type Request, type Response, type NextFunction } from 'express';
import type { RulesRepository } from './rules.repository';
import type { BoardsRepository } from '../boards/boards.repository';
import { validateCreateRule, validateUpdateRule, type RuleFieldError } from './rules.validation';
import { log } from '../config/logger';

/**
 * Parse an `:id`/`board_id` value into a positive integer matching the
 * `INTEGER GENERATED ALWAYS AS IDENTITY` columns. Returns `null` for anything
 * that could not identify a real row. Mirrors `cards.routes.ts`'s `parseId`.
 */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The rules module uses a CODED error envelope — a deliberate cross-cutting
 * divergence from the `{error,details}` shape used by boards/cards/activity.
 * See the Error Code Catalog in TASK-006. Build agents: this mismatch is
 * intentional — do NOT "fix" it to match cards.
 */
const RULE_NOT_FOUND = { code: 'RULE_NOT_FOUND', message: 'Rule not found' };
const BOARD_NOT_FOUND = { code: 'BOARD_NOT_FOUND', message: 'board_id does not reference an existing board' };

/** Build the coded `INVALID_RULE` 400 body from field-level errors. */
function invalidRule(details: RuleFieldError[]): {
  code: 'INVALID_RULE';
  message: string;
  details: RuleFieldError[];
} {
  return { code: 'INVALID_RULE', message: 'Validation failed', details };
}

/**
 * Build a router exposing the five automation-rule CRUD endpoints:
 * `POST /rules`, `GET /rules` (optional `?board_id=` filter), `GET /rules/:id`,
 * `PATCH /rules/:id`, `DELETE /rules/:id`.
 *
 * Both the rules data store and the boards data store are injected (as
 * `RulesRepository`/`BoardsRepository`) so routes are testable without a live
 * database. The boards repository backs the application-level `board_id`
 * existence check (mirroring `POST /cards`) — a well-formed `board_id` that
 * references no board yields a `400 BOARD_NOT_FOUND`, not a raw FK-violation
 * leaking from Postgres. Each handler wraps its work in try/catch and defers
 * unexpected failures to the app-level error handler via `next(err)`.
 */
export function createRulesRouter(rulesRepo: RulesRepository, boardsRepo: BoardsRepository): Router {
  const router = Router();

  router.post('/rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = validateCreateRule(req.body);
      if (!result.ok) {
        res.status(400).json(invalidRule(result.errors));
        return;
      }
      // Application-level FK check: surface a friendly 400 rather than letting a
      // Postgres FK-violation surface as a 500 (mirrors POST /cards).
      const board = await boardsRepo.findById(result.value.board_id);
      if (!board) {
        res.status(400).json(BOARD_NOT_FOUND);
        return;
      }
      const rule = await rulesRepo.create(result.value);
      log('info', 'rule created', { ruleId: rule.id, boardId: rule.board_id });
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rules', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBoardId = req.query.board_id;
      if (rawBoardId !== undefined) {
        const boardId = typeof rawBoardId === 'string' ? parseId(rawBoardId) : null;
        if (boardId === null) {
          res
            .status(400)
            .json(invalidRule([{ field: 'board_id', error: 'board_id must be a positive integer' }]));
          return;
        }
        res.status(200).json(await rulesRepo.findByBoard(boardId));
        return;
      }
      res.status(200).json(await rulesRepo.findByBoard());
    } catch (err) {
      next(err);
    }
  });

  router.get('/rules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      const rule = await rulesRepo.findById(id);
      if (!rule) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      res.status(200).json(rule);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/rules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      const result = validateUpdateRule(req.body);
      if (!result.ok) {
        res.status(400).json(invalidRule(result.errors));
        return;
      }
      const rule = await rulesRepo.update(id, result.value);
      if (!rule) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      log('info', 'rule updated', { ruleId: rule.id, boardId: rule.board_id });
      res.status(200).json(rule);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/rules/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      const removed = await rulesRepo.delete(id);
      if (!removed) {
        res.status(404).json(RULE_NOT_FOUND);
        return;
      }
      log('info', 'rule deleted', { ruleId: id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
