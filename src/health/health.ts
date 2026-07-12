import { Router, type Request, type Response } from 'express';

/**
 * A dependency that reports whether the backing datastore is reachable.
 * Injected so the route can be tested without a live database and so the
 * concrete driver (pg) stays out of the HTTP layer.
 */
export type DbHealthCheck = () => Promise<boolean>;

/**
 * Builds a router exposing `GET /health`.
 *
 * - 200 `{ status: 'ok', db: 'connected' }` when the datastore is reachable.
 * - 503 `{ status: 'degraded', db: 'disconnected' }` when it is not, or when
 *   the check itself throws (the process must never crash on a health probe).
 */
export function createHealthRouter(checkDb: DbHealthCheck): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    let connected = false;
    try {
      connected = await checkDb();
    } catch {
      connected = false;
    }

    if (connected) {
      res.status(200).json({ status: 'ok', db: 'connected' });
    } else {
      res.status(503).json({ status: 'degraded', db: 'disconnected' });
    }
  });

  return router;
}
