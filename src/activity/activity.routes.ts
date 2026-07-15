import { Router, type Request, type Response } from 'express';
import type { ActivityRepository } from './activity.repository';
import type { ActivityEmitter } from './activity.emitter';
import type { CardActivity } from './activity.types';
import { log } from '../config/logger';

/**
 * The TASK-005 Phase 2 realtime push transport: `GET /activity/stream`
 * (SSE — architecture Q1). Board-scoped, read-only, reachable through the
 * Vite `/api` proxy unchanged. Grounded in
 * `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`.
 */
export interface ActivityStreamConfig {
  /** Max events returned by a single backfill or replay read. */
  backfillLimit: number;
  /** Interval, in ms, between `: keep-alive` SSE comment frames. */
  heartbeatMs: number;
}

/**
 * Parse `board_id` from the query string into a positive integer. Mirrors
 * the `GET /cards?board_id=` validation style (`cards.routes.ts`) — a
 * present-but-malformed query value is a `400`, not a `404` (this is a query
 * filter, not a resource `:id`).
 */
function parseBoardId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Parse the `Last-Event-ID` reconnect header into a non-negative integer
 * cursor. Returns `null` for an absent OR malformed header — the caller then
 * falls back to a full backfill rather than issuing `findAfter(NaN, …)` (which
 * would both error the query and, worse, poison the `event.id > cursor` dedupe
 * so every buffered live event is silently dropped). Never let `NaN` flow into
 * a query or a comparison.
 */
function parseCursor(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** One `id:`/`event:`/`data:` SSE frame per `card_moved` event. */
function frame(event: CardActivity): string {
  return `id: ${event.id}\nevent: card_moved\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Builds the raw `(req, res) => Promise<void>` SSE handler, exported
 * separately from the router so its streaming lifecycle (headers,
 * backfill/replay frames, live fan-out, heartbeat, cleanup) can be driven
 * deterministically in tests with a mock req/res instead of a real,
 * never-ending HTTP socket.
 *
 * Lifecycle (architecture Q4 — subscribe-before-backfill, no-gap-no-dup):
 * 1. Validate `board_id` -> 400 if missing/non-positive-integer, no stream opened.
 * 2. Set SSE headers, `flushHeaders()`.
 * 3. Subscribe to the emitter BEFORE the backfill/replay DB read — any live
 *    event arriving during that read is buffered, never written directly and
 *    never dropped.
 * 4. Read `Last-Event-ID`: present -> `findAfter` (replay); absent ->
 *    `findRecentByBoard` (backfill). Both bounded by `config.backfillLimit`.
 * 5. Write one frame per backfill/replay event, oldest->newest.
 * 6. Flush buffered live events, deduped by id against the last frame
 *    already written (drops anything at or before that cursor) — closes the
 *    backfill<->live seam with no gap and no duplicate.
 * 7. Start the heartbeat interval.
 * 8. On `req.on('close')`: unsubscribe + clear the heartbeat interval.
 */
export function activityStreamHandler(
  activityRepo: ActivityRepository,
  activityEmitter: ActivityEmitter,
  config: ActivityStreamConfig,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response): Promise<void> => {
    const boardId = parseBoardId(req.query.board_id);
    if (boardId === null) {
      res.status(400).json({ error: 'board_id query must be a positive integer' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Single idempotent teardown, guarded so it is safe whether the client
    // disconnects during the backfill read or long after. `closed` also gates
    // every write so a heartbeat or live event can never touch a destroyed
    // socket (which would emit an unhandled 'error' and crash the process).
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const write = (chunk: string): void => {
      if (!closed) res.write(chunk);
    };
    let unsubscribe: () => void = () => {};
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log('info', 'activity.stream.close', { board_id: boardId });
    };
    // Register BEFORE the async backfill read so a disconnect mid-read still
    // tears down the subscription and heartbeat (no leak, no crash).
    req.on('close', cleanup);

    // Buffer any live event that arrives while the backfill/replay read is
    // still in flight, rather than writing it immediately (which could race
    // ahead of, and duplicate, a backfilled row) or dropping it (a gap).
    let buffering = true;
    const buffered: CardActivity[] = [];
    unsubscribe = activityEmitter.subscribe(boardId, (event) => {
      if (closed) return;
      if (buffering) {
        buffered.push(event);
      } else {
        write(frame(event));
      }
    });

    let cursor = 0;
    try {
      const lastEventIdHeader = req.headers['last-event-id'];
      const rawCursor = Array.isArray(lastEventIdHeader) ? lastEventIdHeader[0] : lastEventIdHeader;
      const parsedCursor = parseCursor(rawCursor);
      let events: CardActivity[];
      if (parsedCursor !== null) {
        cursor = parsedCursor;
        events = await activityRepo.findAfter(boardId, parsedCursor, config.backfillLimit);
        log('debug', 'activity.stream.replay', {
          board_id: boardId,
          last_event_id: parsedCursor,
          count: events.length,
        });
      } else {
        // Absent OR malformed Last-Event-ID → full backfill (never findAfter(NaN)).
        if (rawCursor !== undefined) {
          log('warn', 'activity.stream.bad_cursor', { board_id: boardId, raw: rawCursor });
        }
        events = await activityRepo.findRecentByBoard(boardId, config.backfillLimit);
        log('debug', 'activity.stream.backfill', { board_id: boardId, count: events.length });
      }

      for (const event of events) {
        write(frame(event));
        cursor = event.id;
      }

      log('info', 'activity.stream.open', { board_id: boardId, backfill_count: events.length });
    } catch (err) {
      // Fail-safe: a backfill/replay read failure degrades the connection
      // (no history, live-only) rather than tearing down the stream or the
      // rest of the board (AC-ERROR-1).
      log('error', 'activity.stream.error', {
        board_id: boardId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      buffering = false;
      for (const event of buffered) {
        if (event.id > cursor) {
          write(frame(event));
          cursor = event.id;
        }
      }
      buffered.length = 0;
    }

    // If the client already disconnected during the read, don't start a timer.
    if (!closed) {
      heartbeat = setInterval(() => {
        write(': keep-alive\n\n');
      }, config.heartbeatMs);
    }
  };
}

/** Mounts the SSE transport at `GET /activity/stream?board_id=`. */
export function createActivityRouter(
  activityRepo: ActivityRepository,
  activityEmitter: ActivityEmitter,
  config: ActivityStreamConfig,
): Router {
  const router = Router();
  router.get('/activity/stream', activityStreamHandler(activityRepo, activityEmitter, config));
  return router;
}
