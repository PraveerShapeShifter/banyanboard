import { afterEach, describe, expect, it, vi } from 'vitest';
import { openActivityStream } from './activityStream';
import { FakeEventSource, sampleActivityEvent } from '../test/fakeEventSource';

/**
 * Phase 3 tests (TASK-005): `activityStream.ts` is the single client seam that
 * opens `EventSource` against the board-scoped SSE endpoint
 * (`GET /activity/stream?board_id=`), mirroring `api/client.ts`'s
 * fetch-confinement discipline — it is the only module in the frontend that
 * touches `EventSource` directly. jsdom has no native `EventSource`, so
 * `FakeEventSource` (shared with `hooks/useActivityStream.test.ts` and
 * `pages/BoardViewPage/ActivityFeed.test.tsx`) stands in for it, stubbed onto
 * `global.EventSource` exactly like `client.test.ts` stubs `global.fetch`.
 *
 * Contract asserted here (for the Coding Agent):
 * - `openActivityStream(boardId, { onOpen?, onMessage, onError? }): { close(): void }`.
 * - URL: `${baseUrl()}/activity/stream?board_id=${boardId}`, honoring
 *   `VITE_API_BASE_URL` (12-factor), same discipline as `client.ts`'s `baseUrl()`.
 * - `card_moved` frames are JSON-parsed and handed to `onMessage` as a typed
 *   `CardActivity`.
 * - `close()` tears down the underlying `EventSource`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  FakeEventSource.reset();
});

describe('activityStream — opening + parsing', () => {
  it('opens EventSource at /activity/stream?board_id= (honoring the 12-factor base URL) and parses a card_moved frame into onMessage', () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    vi.stubGlobal('EventSource', FakeEventSource);
    const onMessage = vi.fn();

    openActivityStream(7, { onMessage });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/api/activity/stream?board_id=7');

    const payload = sampleActivityEvent();
    FakeEventSource.instances[0].emitCardMoved(payload);

    expect(onMessage).toHaveBeenCalledWith(payload);
  });
});

describe('activityStream — connection hooks', () => {
  it('invokes onOpen and onError when the underlying connection opens or errors', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onOpen = vi.fn();
    const onError = vi.fn();

    openActivityStream(7, { onMessage: vi.fn(), onOpen, onError });
    FakeEventSource.instances[0].emitOpen();
    FakeEventSource.instances[0].emitError();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('activityStream — teardown', () => {
  it('close() tears down the underlying EventSource', () => {
    vi.stubGlobal('EventSource', FakeEventSource);

    const handle = openActivityStream(7, { onMessage: vi.fn() });
    handle.close();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
