import { Router, type Request, type Response, type NextFunction } from 'express';
import type { CardsRepository } from './cards.repository';
import type { BoardsRepository } from '../boards/boards.repository';
import { validateCreateCard, validateUpdateCard } from './cards.validation';
import { log } from '../config/logger';

/**
 * Parse an `:id`/`board_id` value into a positive integer matching the
 * `INTEGER GENERATED ALWAYS AS IDENTITY` columns. Returns `null` for anything
 * that could not identify a real row (non-numeric, zero, negative, out of
 * safe-integer range). Mirrors `boards.routes.ts`'s `parseBoardId`.
 */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const NOT_FOUND = { error: 'Card not found' };
const BOARD_NOT_FOUND = { error: 'board_id does not reference an existing board' };

/**
 * Build a router exposing the five Card CRUD endpoints:
 * `POST /cards`, `GET /cards` (optional `?board_id=` filter), `GET /cards/:id`,
 * `PATCH /cards/:id`, `DELETE /cards/:id`.
 *
 * Both the cards data store and the boards data store are injected (as
 * `CardsRepository`/`BoardsRepository`) so routes are testable without a live
 * database. The boards repository backs the application-level `board_id`
 * existence check (AC-ERROR-3) — a well-formed `board_id` that references no
 * board yields a 400, not a raw FK-violation leaking from Postgres. Each
 * handler wraps its work in try/catch and defers unexpected failures to the
 * app-level error handler via `next(err)`, so a DB outage yields a safe 500
 * rather than crashing the process — the same fail-safe posture as
 * `boards.routes.ts`.
 */
export function createCardsRouter(
  cardsRepo: CardsRepository,
  boardsRepo: BoardsRepository,
): Router {
  const router = Router();

  router.post('/cards', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = validateCreateCard(req.body);
      if (!result.ok) {
        res.status(400).json({ error: 'Validation failed', details: result.errors });
        return;
      }
      // Application-level FK check: surface a friendly 400 rather than letting a
      // Postgres FK-violation surface as a 500 (AC-ERROR-3).
      const board = await boardsRepo.findById(result.value.board_id);
      if (!board) {
        res.status(400).json(BOARD_NOT_FOUND);
        return;
      }
      const card = await cardsRepo.create(result.value);
      log('info', 'card created', { cardId: card.id, boardId: card.board_id });
      res.status(201).json(card);
    } catch (err) {
      next(err);
    }
  });

  router.get('/cards', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBoardId = req.query.board_id;
      if (rawBoardId !== undefined) {
        // A present filter must be a well-formed positive integer.
        const boardId = typeof rawBoardId === 'string' ? parseId(rawBoardId) : null;
        if (boardId === null) {
          res.status(400).json({ error: 'board_id query must be a positive integer' });
          return;
        }
        res.status(200).json(await cardsRepo.findAll(boardId));
        return;
      }
      res.status(200).json(await cardsRepo.findAll());
    } catch (err) {
      next(err);
    }
  });

  router.get('/cards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const card = await cardsRepo.findById(id);
      if (!card) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      res.status(200).json(card);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/cards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const result = validateUpdateCard(req.body);
      if (!result.ok) {
        res.status(400).json({ error: 'Validation failed', details: result.errors });
        return;
      }
      const card = await cardsRepo.update(id, result.value);
      if (!card) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      log('info', 'card updated', { cardId: card.id });
      res.status(200).json(card);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/cards/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const removed = await cardsRepo.delete(id);
      if (!removed) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      log('info', 'card deleted', { cardId: id });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
