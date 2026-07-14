import { Router, type Request, type Response, type NextFunction } from 'express';
import type { CardsRepository } from './cards.repository';
import type { BoardsRepository } from '../boards/boards.repository';
import type { ActivityRepository } from '../activity/activity.repository';
import type { ActivityEmitter } from '../activity/activity.emitter';
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
 *
 * `PATCH /cards/:id` additionally captures activity (TASK-005): `cardsRepo`
 * now returns `{ card, previousStatus }` from a single atomic round-trip
 * (architecture Q2), and a real transition (`previousStatus !== card.status`)
 * persists one `card_activity` record via `activityRepo` and fans it out via
 * `activityEmitter` — both injected so this is testable without a live
 * transport or database.
 */
export function createCardsRouter(
  cardsRepo: CardsRepository,
  boardsRepo: BoardsRepository,
  activityRepo: ActivityRepository,
  activityEmitter: ActivityEmitter,
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
      const updateResult = await cardsRepo.update(id, result.value);
      if (!updateResult) {
        res.status(404).json(NOT_FOUND);
        return;
      }
      const { card, previousStatus } = updateResult;
      log('info', 'card updated', { cardId: card.id });

      // Activity capture (TASK-005, AC-VERIFY-1/2/3): gated on an actual
      // status transition, not merely "an update occurred" — `updated_at`
      // bumps on every PATCH, but a same-status or non-status-only PATCH
      // must persist/emit nothing. Persist-first (awaited) so backfill/replay
      // are never missing a row the client could otherwise observe live;
      // the emit is a synchronous, in-memory, non-blocking fan-out. Wrapped
      // in try/catch so a capture failure is logged but never fails the
      // PATCH itself (fail-safe — the write path must not regress).
      if (previousStatus !== card.status) {
        try {
          const event = await activityRepo.record({
            board_id: card.board_id,
            card_id: card.id,
            card_title: card.title,
            from_status: previousStatus,
            to_status: card.status,
          });
          activityEmitter.emit(card.board_id, event);
          log('info', 'activity.captured', {
            board_id: card.board_id,
            card_id: card.id,
            from_status: previousStatus,
            to_status: card.status,
            activity_id: event.id,
          });
        } catch (err) {
          log('error', 'activity.capture.error', {
            board_id: card.board_id,
            card_id: card.id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

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
