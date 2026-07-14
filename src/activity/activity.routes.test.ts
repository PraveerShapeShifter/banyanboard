import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import {
  createActivityRouter,
  activityStreamHandler,
  type ActivityStreamConfig,
} from './activity.routes';
import type { ActivityRepository } from './activity.repository';
import { InProcessActivityEmitter } from './activity.emitter';
import type { ActivityEmitter } from './activity.emitter';
import type { CardActivity } from './activity.types';

/**
 * Tests for the TASK-005 Phase 2 realtime push transport: the SSE endpoint
 * that fans out `card_activity` events per board, backfills recent history
 * on connect, and replays missed events on reconnect via `Last-Event-ID`.
 * Grounded in `memory-bank/creative/TASK-005-realtime-activity-feed-architecture.md`
 * (Q1 transport, Q3 cursor/backfill, Q4 fan-out/lifecycle) and the Phase 2
 * Test Strategy guidance in `memory-bank/tasks/TASK-005.md`.
 *
 * Contract asserted here (see the completion report for the full writeup):
 * - `createActivityRouter(activityRepo, activityEmitter, config)` returns an
 *   Express `Router` mounting `GET /activity/stream` (query `board_id`).
 * - `activityStreamHandler(activityRepo, activityEmitter, config)` returns the
 *   raw `(req, res) => Promise<void>` handler, exported separately so the
 *   streaming lifecycle (headers, backfill/replay frames, live fan-out,
 *   heartbeat, cleanup) can be driven deterministically with mock req/res
 *   instead of a real, never-ending HTTP socket.
 * - Frame format: one `res.write()` call per event —
 *   `id: <id>\nevent: card_moved\ndata: <JSON CardActivity>\n\n`.
 * - Heartbeat frame: one `res.write()` call per tick — `: keep-alive\n\n`.
 * - Reconnect cursor is read from `req.headers['last-event-id']`.
 * - Both backfill and replay bound their query with `config.backfillLimit`.
 * - Cleanup on `req.on('close', ...)`: call the `subscribe()` unsubscribe
 *   closure and `clearInterval` the heartbeat timer.
 *
 * Most tests unit-test `activityStreamHandler` directly with a mock req
 * (an EventEmitter with `.query`/`.headers`, so `req.emit('close')` simulates
 * disconnect) and a mock res (captures every `res.write()`/`res.setHeader()`
 * call). This keeps every test deterministic and fast-terminating — no test
 * relies on a real, unending HTTP socket. Validation (400) is exercised
 * through a real HTTP round trip via Supertest since that response ends
 * normally. Every test that opens a stream ends by emitting `close` (and
 * restoring real timers) so nothing leaks between tests.
 */

/** A canonical activity event, mirroring `activity.repository.test.ts`'s `row()`. */
const event = (over: Partial<CardActivity> = {}): CardActivity => ({
  id: 1,
  board_id: 1,
  card_id: 1,
  card_title: 'Deploy pipeline',
  from_status: 'todo',
  to_status: 'in_progress',
  created_at: new Date('2026-07-15T00:00:00.000Z'),
  ...over,
});

/** An `ActivityRepository` stub whose backfill/replay both resolve empty. */
function emptyActivityRepo(): ActivityRepository {
  return {
    record: vi.fn(),
    findRecentByBoard: vi.fn().mockResolvedValue([]),
    findAfter: vi.fn().mockResolvedValue([]),
  };
}

/** An `ActivityEmitter` stub whose `subscribe`/`emit` do nothing (no live fan-out needed). */
function noopActivityEmitter(): ActivityEmitter {
  return {
    subscribe: () => () => {},
    emit: () => {},
  };
}

/**
 * A mock Express `Request`: an `EventEmitter` (so `req.emit('close')` drives
 * the handler's disconnect cleanup) carrying `query`/`headers` exactly as
 * Express would have parsed them (query string values as strings; incoming
 * header names lowercased).
 */
function makeReq(query: Record<string, string> = {}, headers: Record<string, string> = {}): Request {
  const req = new EventEmitter() as unknown as Request;
  Object.assign(req, { query, headers });
  return req;
}

/** A mock Express `Response` capturing every header set and every `write()` call verbatim. */
function makeRes(): Response & { writes: string[]; resHeaders: Record<string, string> } {
  const writes: string[] = [];
  const resHeaders: Record<string, string> = {};
  const res = {
    writes,
    resHeaders,
    setHeader(name: string, value: string) {
      resHeaders[name] = value;
      return res;
    },
    flushHeaders() {},
    status(_code: number) {
      return res;
    },
    json(body: unknown) {
      writes.push(JSON.stringify(body));
      return res;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {},
  };
  return res as unknown as Response & { writes: string[]; resHeaders: Record<string, string> };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /activity/stream — validation (real HTTP via createActivityRouter)', () => {
  it('AC-ERROR-1: missing or non-numeric board_id returns 400 without opening a stream', async () => {
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 15000 };
    const app = express();
    app.use(createActivityRouter(emptyActivityRepo(), noopActivityEmitter(), config));

    const missing = await request(app).get('/activity/stream');
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBeTruthy();

    const invalid = await request(app).get('/activity/stream?board_id=abc');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBeTruthy();
  });
});

describe('activityStreamHandler', () => {
  it('sets the correct SSE response headers on connect', async () => {
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(emptyActivityRepo(), noopActivityEmitter(), config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    await handler(req, res);

    expect(res.resHeaders['Content-Type']).toMatch(/^text\/event-stream/);
    expect(res.resHeaders['Cache-Control']).toBe('no-cache');
    expect(res.resHeaders['Connection']).toBe('keep-alive');

    req.emit('close');
  });

  it('AC-ASYNC-1: fresh connect backfills recent history oldest-first as card_moved frames', async () => {
    const events = [
      event({ id: 1, card_title: 'Card One', to_status: 'in_progress' }),
      event({ id: 2, card_title: 'Card Two', from_status: 'in_progress', to_status: 'done' }),
    ];
    const findRecentByBoard = vi.fn().mockResolvedValue(events);
    const findAfter = vi.fn().mockResolvedValue([]);
    const activityRepo: ActivityRepository = { record: vi.fn(), findRecentByBoard, findAfter };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(activityRepo, noopActivityEmitter(), config);
    const req = makeReq({ board_id: '7' });
    const res = makeRes();

    await handler(req, res);

    expect(findRecentByBoard).toHaveBeenCalledWith(7, 50);
    expect(findAfter).not.toHaveBeenCalled();
    expect(res.writes).toEqual([
      `id: 1\nevent: card_moved\ndata: ${JSON.stringify(events[0])}\n\n`,
      `id: 2\nevent: card_moved\ndata: ${JSON.stringify(events[1])}\n\n`,
    ]);

    req.emit('close');
  });

  it('AC-ASYNC-2: reconnect with Last-Event-ID replays only newer events via findAfter (not findRecentByBoard)', async () => {
    const newer = [event({ id: 11, card_title: 'Card Eleven' }), event({ id: 12, card_title: 'Card Twelve' })];
    const findAfter = vi.fn().mockResolvedValue(newer);
    const findRecentByBoard = vi.fn();
    const activityRepo: ActivityRepository = { record: vi.fn(), findRecentByBoard, findAfter };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(activityRepo, noopActivityEmitter(), config);
    const req = makeReq({ board_id: '9' }, { 'last-event-id': '10' });
    const res = makeRes();

    await handler(req, res);

    expect(findAfter).toHaveBeenCalledWith(9, 10, 50);
    expect(findRecentByBoard).not.toHaveBeenCalled();
    expect(res.writes).toEqual([
      `id: 11\nevent: card_moved\ndata: ${JSON.stringify(newer[0])}\n\n`,
      `id: 12\nevent: card_moved\ndata: ${JSON.stringify(newer[1])}\n\n`,
    ]);

    req.emit('close');
  });

  it('subscribes to the emitter before running the backfill/replay query (no-gap ordering)', async () => {
    const order: string[] = [];
    const activityEmitter: ActivityEmitter = {
      subscribe: () => {
        order.push('subscribe');
        return () => {};
      },
      emit: () => {},
    };
    const findRecentByBoard = vi.fn().mockImplementation(async () => {
      order.push('backfill');
      return [];
    });
    const activityRepo: ActivityRepository = {
      record: vi.fn(),
      findRecentByBoard,
      findAfter: vi.fn().mockResolvedValue([]),
    };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(activityRepo, activityEmitter, config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    await handler(req, res);

    expect(order).toEqual(['subscribe', 'backfill']);

    req.emit('close');
  });

  it('AC-HAPPY-1 (server): a live emitted event is written to the connected client as a card_moved frame', async () => {
    let liveHandler: ((e: CardActivity) => void) | undefined;
    const activityEmitter: ActivityEmitter = {
      subscribe: (_boardId, handler) => {
        liveHandler = handler;
        return () => {};
      },
      emit: () => {},
    };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(emptyActivityRepo(), activityEmitter, config);
    const req = makeReq({ board_id: '3' });
    const res = makeRes();

    await handler(req, res);
    expect(res.writes).toEqual([]); // nothing yet — empty backfill, no live event

    const moved = event({ id: 42, board_id: 3, card_id: 9, card_title: 'Ship it', to_status: 'in_progress' });
    liveHandler?.(moved);

    expect(res.writes).toEqual([`id: 42\nevent: card_moved\ndata: ${JSON.stringify(moved)}\n\n`]);

    req.emit('close');
  });

  it("per-board scoping: a client on board A does not receive board B's emitted events", async () => {
    const activityEmitter = new InProcessActivityEmitter();
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(emptyActivityRepo(), activityEmitter, config);

    const reqA = makeReq({ board_id: '1' });
    const resA = makeRes();
    await handler(reqA, resA);

    const reqB = makeReq({ board_id: '2' });
    const resB = makeRes();
    await handler(reqB, resB);

    const movedOnA = event({ id: 5, board_id: 1, card_title: 'Board A card' });
    activityEmitter.emit(1, movedOnA);

    expect(resA.writes).toEqual([`id: 5\nevent: card_moved\ndata: ${JSON.stringify(movedOnA)}\n\n`]);
    expect(resB.writes).toEqual([]);

    reqA.emit('close');
    reqB.emit('close');
  });

  it('writes a keep-alive heartbeat every ACTIVITY_HEARTBEAT_MS', async () => {
    vi.useFakeTimers();
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 15000 };
    const handler = activityStreamHandler(emptyActivityRepo(), noopActivityEmitter(), config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    await handler(req, res);
    expect(res.writes.filter((w) => w === ': keep-alive\n\n')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(15000);
    expect(res.writes.filter((w) => w === ': keep-alive\n\n')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(res.writes.filter((w) => w === ': keep-alive\n\n')).toHaveLength(2);

    req.emit('close');
  });

  it('AC-ERROR-1 (server): on client disconnect, unsubscribes from the emitter and stops the heartbeat (no leak)', async () => {
    vi.useFakeTimers();
    let unsubscribeCalled = false;
    const activityEmitter: ActivityEmitter = {
      subscribe: () => () => {
        unsubscribeCalled = true;
      },
      emit: () => {},
    };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 1000 };
    const handler = activityStreamHandler(emptyActivityRepo(), activityEmitter, config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    await handler(req, res);
    req.emit('close');

    expect(unsubscribeCalled).toBe(true);

    const writesAtClose = res.writes.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(res.writes.length).toBe(writesAtClose); // no further heartbeat writes -> interval was cleared
  });

  it('AC-ERROR-1 (server): disconnect DURING the backfill read still tears down (no leak, no write-after-close)', async () => {
    vi.useFakeTimers();
    let unsubscribeCalled = false;
    const activityEmitter: ActivityEmitter = {
      subscribe: () => () => {
        unsubscribeCalled = true;
      },
      emit: () => {},
    };
    let resolveBackfill: (v: CardActivity[]) => void = () => {};
    const findRecentByBoard = vi
      .fn()
      .mockImplementation(() => new Promise<CardActivity[]>((r) => (resolveBackfill = r)));
    const activityRepo: ActivityRepository = { record: vi.fn(), findRecentByBoard, findAfter: vi.fn() };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 1000 };
    const handler = activityStreamHandler(activityRepo, activityEmitter, config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    const pending = handler(req, res); // suspends awaiting the backfill read
    req.emit('close'); // client disconnects mid-read
    resolveBackfill([event({ id: 1 })]); // read resolves after disconnect
    await pending;

    expect(unsubscribeCalled).toBe(true); // cleanup fired despite the mid-read disconnect
    const writesAfterClose = res.writes.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(res.writes.length).toBe(writesAfterClose); // no heartbeat started, no write-after-close
  });

  it('AC-ASYNC-2: a malformed Last-Event-ID falls back to full backfill (never findAfter(NaN)) and still delivers buffered live events', async () => {
    const activityEmitter = new InProcessActivityEmitter();
    let resolveBackfill: (v: CardActivity[]) => void = () => {};
    const findRecentByBoard = vi
      .fn()
      .mockImplementation(() => new Promise<CardActivity[]>((r) => (resolveBackfill = r)));
    const findAfter = vi.fn();
    const activityRepo: ActivityRepository = { record: vi.fn(), findRecentByBoard, findAfter };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(activityRepo, activityEmitter, config);
    const req = makeReq({ board_id: '4' }, { 'last-event-id': 'not-a-number' });
    const res = makeRes();

    const pending = handler(req, res);
    const live = event({ id: 99, board_id: 4, card_title: 'Live during read' });
    activityEmitter.emit(4, live); // arrives while the fallback backfill read is in flight -> buffered
    resolveBackfill([event({ id: 1, board_id: 4 })]);
    await pending;

    expect(findAfter).not.toHaveBeenCalled(); // never findAfter(NaN, ...)
    expect(findRecentByBoard).toHaveBeenCalledWith(4, 50);
    expect(res.writes).toEqual([
      `id: 1\nevent: card_moved\ndata: ${JSON.stringify(event({ id: 1, board_id: 4 }))}\n\n`,
      `id: 99\nevent: card_moved\ndata: ${JSON.stringify(live)}\n\n`, // buffered live event NOT dropped
    ]);

    req.emit('close');
  });

  it('AC-ERROR-1 (server): a failing backfill read degrades to live-only (stream stays open, no crash)', async () => {
    const activityEmitter = new InProcessActivityEmitter();
    const findRecentByBoard = vi.fn().mockRejectedValue(new Error('db down'));
    const activityRepo: ActivityRepository = { record: vi.fn(), findRecentByBoard, findAfter: vi.fn() };
    const config: ActivityStreamConfig = { backfillLimit: 50, heartbeatMs: 100000 };
    const handler = activityStreamHandler(activityRepo, activityEmitter, config);
    const req = makeReq({ board_id: '1' });
    const res = makeRes();

    await expect(handler(req, res)).resolves.toBeUndefined(); // no throw
    expect(res.resHeaders['Content-Type']).toMatch(/^text\/event-stream/); // stream still opened
    expect(res.writes).toEqual([]); // no backfill frames (read failed)

    const live = event({ id: 7, board_id: 1 });
    activityEmitter.emit(1, live); // live delivery still works after a failed backfill
    expect(res.writes).toEqual([`id: 7\nevent: card_moved\ndata: ${JSON.stringify(live)}\n\n`]);

    req.emit('close');
  });
});
