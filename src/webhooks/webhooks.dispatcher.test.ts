import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRule } from '../rules/rules.types';
import type { WebhooksRepository } from './webhooks.repository';
import type { TriggerExecution, WebhookDelivery, WebhookPayload } from './webhooks.types';

/**
 * Unit tests for `HttpWebhookDispatcher` (TASK-006 Phase 3) — the 13 enumerated
 * cases from the Webhook Retry Algorithm doc, exercised with a STUBBED global
 * `fetch` and `vi.useFakeTimers()` so there is NO real network and NO real
 * wall-clock waiting. Backoff (30000ms) and the per-attempt timeout (5000ms)
 * are driven purely by advancing fake timers.
 */

// The dispatcher logs via the shared logger; mock it so we can assert the
// structured events without writing to stdout.
vi.mock('../config/logger', () => ({ log: vi.fn() }));
import { log } from '../config/logger';
import { HttpWebhookDispatcher } from './webhooks.dispatcher';

const logMock = vi.mocked(log);

const CONFIG = { timeoutMs: 5000, maxAttempts: 3, retryBackoffMs: 30000 };

const execution: TriggerExecution = {
  id: 1,
  rule_id: 12,
  card_id: 45,
  board_id: 3,
  from_status: 'in_progress',
  to_status: 'done',
  status: 'executed',
  created_at: new Date('2026-07-15T10:04:12.512Z'),
};

function makeRule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 12,
    board_id: 3,
    name: 'auto-done',
    condition: { field: 'status', operator: 'eq', value: 'in_progress' },
    target_status: 'done',
    enabled: true,
    webhook_url: 'https://hooks.example.com/x',
    created_at: new Date('2026-07-15T10:00:00.000Z'),
    updated_at: new Date('2026-07-15T10:00:00.000Z'),
    ...over,
  };
}

const PAYLOAD: WebhookPayload = {
  event: 'rule.triggered',
  rule_id: 12,
  board_id: 3,
  card_id: 45,
  card_title: 'Ship v1',
  from_status: 'in_progress',
  to_status: 'done',
  triggered_by: 'rule',
  occurred_at: '2026-07-15T10:04:12.512Z',
};

/** A stub `WebhooksRepository` holding one delivery row in memory, with spies. */
function makeStubRepo(seed?: Partial<WebhookDelivery>) {
  const rows = new Map<number, WebhookDelivery>();
  let nextId = 100;

  if (seed) {
    const id = seed.id ?? nextId++;
    rows.set(id, {
      id,
      trigger_execution_id: 1,
      rule_id: 12,
      url: 'https://hooks.example.com/x',
      status: 'pending',
      attempts: 0,
      last_status_code: null,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      delivered_at: null,
      ...seed,
    });
  }

  const createDelivery = vi.fn(async (input: { trigger_execution_id: number; rule_id: number; url: string; payload: string }) => {
    const id = nextId++;
    const row: WebhookDelivery = {
      id,
      trigger_execution_id: input.trigger_execution_id,
      rule_id: input.rule_id,
      url: input.url,
      status: 'pending',
      attempts: 0,
      last_status_code: null,
      last_error: null,
      created_at: new Date(),
      updated_at: new Date(),
      delivered_at: null,
    };
    rows.set(id, row);
    return { ...row }; // read projection never includes `payload`
  });

  const findDeliveryById = vi.fn(async (id: number) => {
    const row = rows.get(id);
    return row ? { ...row } : null;
  });

  const markDelivered = vi.fn(async (id: number, patch: { attempts: number; last_status_code: number }) => {
    const row = rows.get(id);
    if (!row) return null;
    row.status = 'delivered';
    row.attempts = patch.attempts;
    row.last_status_code = patch.last_status_code;
    row.delivered_at = new Date();
    return { ...row };
  });

  const markFailed = vi.fn(
    async (id: number, patch: { attempts: number; last_status_code?: number | null; last_error: string }) => {
      const row = rows.get(id);
      if (!row) return null;
      row.status = 'failed';
      row.attempts = patch.attempts;
      row.last_status_code = patch.last_status_code ?? null;
      row.last_error = patch.last_error;
      return { ...row };
    },
  );

  const markExhausted = vi.fn(
    async (id: number, patch: { attempts: number; last_status_code?: number | null; last_error: string }) => {
      const row = rows.get(id);
      if (!row) return null;
      row.status = 'exhausted';
      row.attempts = patch.attempts;
      row.last_status_code = patch.last_status_code ?? null;
      row.last_error = patch.last_error;
      return { ...row };
    },
  );

  const recordExecution = vi.fn();
  const updateDelivery = vi.fn();
  const listTriggerExecutions = vi.fn();
  const listDeliveries = vi.fn();
  const findNonTerminalDeliveries = vi.fn();

  const repo = {
    createDelivery,
    findDeliveryById,
    markDelivered,
    markFailed,
    markExhausted,
    recordExecution,
    updateDelivery,
    listTriggerExecutions,
    listDeliveries,
    findNonTerminalDeliveries,
  } as unknown as WebhooksRepository;

  return {
    repo,
    rows,
    createDelivery,
    findDeliveryById,
    markDelivered,
    markFailed,
    markExhausted,
    recordExecution,
  };
}

/** fetch stubs — the dispatcher only reads `res.status`. */
const okResponse = (status: number) => ({ status }) as unknown as Response;

/** Flush pending microtasks + the 0-delay first attempt. */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

/** Count of `log` calls carrying a given event name. */
function logCount(event: string): number {
  return logMock.mock.calls.filter((c) => c[1] === event).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  logMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HttpWebhookDispatcher', () => {
  it('case 1: 2xx on the first attempt → delivered, no retry', async () => {
    const fetchMock = vi.fn(async () => okResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stub.markDelivered).toHaveBeenCalledTimes(1);
    expect(stub.markDelivered.mock.calls[0][1]).toEqual({ attempts: 1, last_status_code: 200 });
    expect(stub.markFailed).not.toHaveBeenCalled();

    const [, id] = [...stub.rows.entries()][0];
    expect(id.status).toBe('delivered');
    expect(id.last_error).toBeNull();
    expect(id.delivered_at).not.toBeNull();

    // No retry armed: advancing well past a backoff triggers no further fetch.
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('case 2: POSTs the exact payload + headers contract (204 counts as success)', async () => {
    const fetchMock = vi.fn(async () => okResponse(204));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/x');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(opts.signal).toBeDefined();
    expect(opts.body).toBe(JSON.stringify(PAYLOAD));
    expect(JSON.parse(opts.body as string)).toEqual({
      event: 'rule.triggered',
      rule_id: 12,
      board_id: 3,
      card_id: 45,
      card_title: 'Ship v1',
      from_status: 'in_progress',
      to_status: 'done',
      triggered_by: 'rule',
      occurred_at: '2026-07-15T10:04:12.512Z',
    });
    expect(stub.markDelivered).toHaveBeenCalledTimes(1);
  });

  it('case 3: flap — non-2xx then success on the retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(500))
      .mockResolvedValueOnce(okResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();

    // After attempt 1: failed, retry armed, NO second fetch yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stub.markFailed).toHaveBeenCalledTimes(1);
    const failArg = stub.markFailed.mock.calls[0][1];
    expect(failArg.attempts).toBe(1);
    expect(failArg.last_status_code).toBe(500);
    const failErr = JSON.parse(failArg.last_error);
    expect(failErr.code).toBe('WEBHOOK_NON_2XX');
    expect(failErr.details[0]).toEqual({ field: 'status', error: '500 is not 2xx' });

    // After 30s: the retry fires and succeeds.
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stub.markDelivered).toHaveBeenCalledTimes(1);
    expect(stub.markDelivered.mock.calls[0][1]).toEqual({ attempts: 2, last_status_code: 200 });

    // No third attempt.
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('case 4: timeout via AbortController → WEBHOOK_TIMEOUT + retry', async () => {
    const fetchMock = vi.fn(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();
    expect(stub.markFailed).not.toHaveBeenCalled(); // still waiting on the timeout

    await vi.advanceTimersByTimeAsync(5000); // fire the AbortController timer
    expect(stub.markFailed).toHaveBeenCalledTimes(1);
    const arg = stub.markFailed.mock.calls[0][1];
    expect(arg.attempts).toBe(1);
    expect(arg.last_status_code).toBeNull();
    const err = JSON.parse(arg.last_error);
    expect(err.code).toBe('WEBHOOK_TIMEOUT');
    expect(err.details[0]).toEqual({ field: 'timeout', error: 'no response within 5000ms' });
  });

  it('case 5: network error → WEBHOOK_TIMEOUT (same code as timeout) + retry', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('ECONNREFUSED');
    });
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();

    expect(stub.markFailed).toHaveBeenCalledTimes(1);
    const arg = stub.markFailed.mock.calls[0][1];
    expect(arg.last_status_code).toBeNull();
    expect(JSON.parse(arg.last_error).code).toBe('WEBHOOK_TIMEOUT');
  });

  it('case 6: all 3 attempts fail → exhausted (exactly 3 fetches, one exhausted log)', async () => {
    const fetchMock = vi.fn(async () => okResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle(); // attempt 1
    await vi.advanceTimersByTimeAsync(30000); // attempt 2
    await vi.advanceTimersByTimeAsync(30000); // attempt 3

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(stub.markFailed).toHaveBeenCalledTimes(2);
    expect(stub.markExhausted).toHaveBeenCalledTimes(1);
    const exArg = stub.markExhausted.mock.calls[0][1];
    expect(exArg.attempts).toBe(3);
    const exErr = JSON.parse(exArg.last_error);
    expect(exErr.code).toBe('WEBHOOK_EXHAUSTED');
    expect(exErr.details[0]).toEqual({ field: 'attempts', error: '3 of 3 attempts failed' });
    expect(logCount('rules.webhook_exhausted')).toBe(1);

    // No fourth attempt, ever.
    await vi.advanceTimersByTimeAsync(120000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('case 7: mutates webhook_deliveries only — never trigger_executions', async () => {
    const fetchMock = vi.fn(async () => okResponse(503));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(30000);

    // The dispatcher never touches the trigger-execution table.
    expect(stub.recordExecution).not.toHaveBeenCalled();
    // Only delivery-lifecycle mutators were used, ending terminal.
    const [, row] = [...stub.rows.entries()][0];
    expect(row.status).toBe('exhausted');
  });

  it('case 8: a terminal row is an idempotent no-op (delivered and exhausted)', async () => {
    const fetchMock = vi.fn(async () => okResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    for (const terminal of ['delivered', 'exhausted'] as const) {
      const stub = makeStubRepo({ id: 500, status: terminal });
      const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);
      logMock.mockClear();

      await dispatcher.deliver(500);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(stub.markDelivered).not.toHaveBeenCalled();
      expect(stub.markFailed).not.toHaveBeenCalled();
      expect(stub.markExhausted).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    }
  });

  it('case 9: fail-safe — a fetch that throws never rejects out of deliver()', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('boom');
    });
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo({ id: 600, status: 'pending' });
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    await expect(dispatcher.deliver(600)).resolves.toBeUndefined();
    // Handled as a delivery failure (classified timeout/network), not a crash.
    expect(stub.markFailed).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stub.markFailed.mock.calls[0][1].last_error).code).toBe('WEBHOOK_TIMEOUT');
  });

  it('case 10: fail-safe — a repo-write that throws is swallowed and logged', async () => {
    const fetchMock = vi.fn(async () => okResponse(500));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo({ id: 700, status: 'pending' });
    stub.markFailed.mockRejectedValueOnce(new Error('DB down'));
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    await expect(dispatcher.deliver(700)).resolves.toBeUndefined();
    expect(logCount('rules.webhook_dispatch_error')).toBe(1);
  });

  it('case 11: a null webhook_url creates no row and never fetches', async () => {
    const fetchMock = vi.fn(async () => okResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule({ webhook_url: null }), PAYLOAD);
    await settle();
    await vi.advanceTimersByTimeAsync(60000);

    expect(stub.createDelivery).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('case 12: the fixed 30s backoff is exact (29999ms no retry, +1ms fires)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(500))
      .mockResolvedValueOnce(okResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29999);
    expect(fetchMock).toHaveBeenCalledTimes(1); // not yet

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // fires at exactly 30000ms
  });

  it('case 13: attempt counting = 1 initial + exactly 2 retries + 3 fetches', async () => {
    const fetchMock = vi.fn(async () => okResponse(500));
    vi.stubGlobal('fetch', fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const stub = makeStubRepo();
    const dispatcher = new HttpWebhookDispatcher(stub.repo, CONFIG);

    dispatcher.dispatch(execution, makeRule(), PAYLOAD);
    await settle();
    await vi.advanceTimersByTimeAsync(30000);
    await vi.advanceTimersByTimeAsync(30000);

    // attempts observed 1, 2, 3 across the lifecycle mutators.
    expect(stub.markFailed.mock.calls.map((c) => c[1].attempts)).toEqual([1, 2]);
    expect(stub.markExhausted.mock.calls[0][1].attempts).toBe(3);

    // Exactly two retry timers armed (the backoff value); exactly three fetches.
    const retryTimers = setTimeoutSpy.mock.calls.filter((c) => c[1] === CONFIG.retryBackoffMs);
    expect(retryTimers).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
