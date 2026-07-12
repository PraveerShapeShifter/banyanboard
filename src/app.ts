import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { createHealthRouter, type DbHealthCheck } from './health/health';
import { createBoardsRouter } from './boards/boards.routes';
import type { BoardsRepository } from './boards/boards.repository';
import { createCardsRouter } from './cards/cards.routes';
import type { CardsRepository } from './cards/cards.repository';
import { log } from './config/logger';

/**
 * Dependencies injected into the application at construction time. Keeping
 * these explicit lets tests supply stubs and keeps side-effecting resources
 * (the database pool) out of the app factory itself.
 */
export interface AppDeps {
  /** Reports whether the database is reachable; backs `GET /health`. */
  checkDb: DbHealthCheck;
  /** Data-access layer for the `boards` resource; backs the Board CRUD routes. */
  boardsRepo: BoardsRepository;
  /** Data-access layer for the `cards` resource; backs the Card CRUD routes. */
  cardsRepo: CardsRepository;
}

/**
 * Builds the Express application. Kept free of side effects (no listen, no env
 * reads) so it can be constructed directly in tests via supertest.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'banyanboard', status: 'running' });
  });

  app.use(createHealthRouter(deps.checkDb));
  app.use(createBoardsRouter(deps.boardsRepo));
  app.use(createCardsRouter(deps.cardsRepo, deps.boardsRepo));

  // Central error handler. Turns a malformed JSON body into a 400 and any other
  // unexpected failure (e.g. a database outage surfaced via `next(err)`) into a
  // generic 500 — never leaking stack traces or driver internals, and never
  // crashing the process. Mirrors the fail-safe posture of the health route.
  app.use(
    (
      err: Error & { type?: string; status?: number },
      _req: Request,
      res: Response,
      // The 4-arg signature is what marks this as an Express error handler;
      // `_next` is required by that shape even though it is unused here.
      _next: NextFunction,
    ) => {
      // If a response was already partially sent, hand off to Express's default
      // handler rather than writing a second time (which would throw).
      if (res.headersSent) {
        _next(err);
        return;
      }
      if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'Malformed JSON request body' });
        return;
      }
      // Log the stack server-side for debugging; only a generic message is
      // ever returned to the client (no internals leak).
      log('error', 'unhandled request error', { message: err?.message, stack: err?.stack });
      res.status(500).json({ error: 'Internal server error' });
    },
  );

  return app;
}
