import { Router, type Request, type Response, type NextFunction } from 'express';
import type { BoardsRepository } from './boards.repository';
import { validateCreateBoard, validateUpdateBoard } from './boards.validation';
import { log } from '../config/logger';

/**
 * Parse a `:id` path segment into a positive integer matching the
 * `boards.id INTEGER GENERATED ALWAYS AS IDENTITY` column. Returns `null` for
 * anything that could not identify a real row (non-numeric, zero, negative,
 * out of safe-integer range) — callers treat that as "not found".
 */
function parseBoardId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const NOT_FOUND = { error: 'Board not found' };

/**
 * Build a router exposing the five Board CRUD endpoints:
 * `POST /boards`, `GET /boards`, `GET /boards/:id`, `PATCH /boards/:id`,
 * `DELETE /boards/:id`.
 *
 * The concrete data store is injected as a `BoardsRepository` (mirroring how
 * `DbHealthCheck` is injected into the health router) so routes are testable
 * without a live database. Each handler wraps its work in try/catch and defers
 * unexpected failures to the app-level error handler via `next(err)`, so a DB
 * outage yields a safe 500 rather than crashing the process — the same
 * fail-safe posture as `health.ts`.
 */
export function createBoardsRouter(repo: BoardsRepository): Router {
  const router = Router();

  router.post('/boards', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = validateCreateBoard(req.body);
      if (!result.ok) {
        res.status(400).json({ error: 'Validation failed', details: result.errors });
        return;
      }
      const board = await repo.create(result.value);
      log('info', 'board created', { boardId: board.id });
      res.status(201).json(board);
    } catch (err) {
      next(err);
    }
  });

  router.get('/boards', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const boards = await repo.findAll();
      res.status(200).json(boards);
    } catch (err) {
      next(err);
    }
  });

  router.get('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseBoardId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const board = await repo.findById(id);
      if (!board) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.status(200).json(board);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseBoardId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const result = validateUpdateBoard(req.body);
      if (!result.ok) {
        res.status(400).json({ error: 'Validation failed', details: result.errors });
        return;
      }
      const board = await repo.update(id, result.value);
      if (!board) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      log('info', 'board updated', { boardId: board.id });
      res.status(200).json(board);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/boards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseBoardId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const removed = await repo.delete(id);
      if (!removed) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      log('info', 'board deleted', { boardId: id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
