import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useActivityStream,
  ACTIVITY_ANNOUNCE_ARM_DELAY_MS,
  ACTIVITY_DEGRADED_AFTER_MS,
} from './useActivityStream';
import { FakeEventSource, sampleActivityEvent } from '../test/fakeEventSource';

/**
 * Phase 3 tests (TASK-005): `useActivityStream(boardId)` is the client
 * connection state machine, mirroring `useApiResource`'s single-state-value
 * discipline. It owns `activityStream.ts` internally (not mocked here — this
 * exercises the real hook logic on top of `FakeEventSource`, one layer above
 * `api/activityStream.test.ts`).
 *
 * Contract asserted here (for the Coding Agent):
 * - `useActivityStream(boardId): { status, items, announcement }` where
 *   `status: 'connecting' | 'open' | 'reconnecting' | 'degraded'`,
 *   `items: CardActivity[]` (newest-first, deduped by `id`),
 *   `announcement: { seq: number; text: string } | null`.
 * - Exports `ACTIVITY_ANNOUNCE_ARM_DELAY_MS` and `ACTIVITY_DEGRADED_AFTER_MS`
 *   as named constants so tests (and any future tuning) never guess magic
 *   numbers.
 * - Opens the stream on mount, closes it on unmount (no leaked connection).
 * - Arming heuristic: on (re-)entering `open`, incoming frames are silent
 *   (no `announcement`) until `ACTIVITY_ANNOUNCE_ARM_DELAY_MS` has elapsed
 *   with no new frame; only frames after that update `announcement`.
 * - `onError` → `reconnecting` (items stay); if it persists past
 *   `ACTIVITY_DEGRADED_AFTER_MS` → `degraded` (items still frozen/visible);
 *   the next `onOpen` recovers to `open`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeEventSource.reset();
});

function connect(boardId: number | string = 7) {
  vi.stubGlobal('EventSource', FakeEventSource);
  const rendered = renderHook(() => useActivityStream(boardId));
  const source = FakeEventSource.instances[0];
  return { ...rendered, source };
}

describe('useActivityStream — connection lifecycle', () => {
  it('starts "connecting" with no items, moves to "open" once the stream connects, and closes the stream on unmount', () => {
    const { result, source, unmount } = connect();

    expect(result.current.status).toBe('connecting');
    expect(result.current.items).toEqual([]);

    act(() => source.emitOpen());
    expect(result.current.status).toBe('open');

    unmount();
    expect(source.closed).toBe(true);
  });
});

describe('useActivityStream — items', () => {
  it('prepends each incoming event so the newest is first, and de-duplicates by id', () => {
    const { result, source } = connect();
    act(() => source.emitOpen());

    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1, card_title: 'First' })));
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 2, card_title: 'Second' })));
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1, card_title: 'First' }))); // duplicate id

    expect(result.current.items.map((item) => item.card_title)).toEqual(['Second', 'First']);
  });
});

describe('useActivityStream — arming heuristic', () => {
  it('stays silent through a backfill burst on fresh connect, then announces exactly once for the next genuinely-new live event', () => {
    vi.useFakeTimers();
    const { result, source } = connect();
    act(() => source.emitOpen());

    // Backfill burst: several frames arrive immediately after connecting.
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1 })));
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 2 })));
    expect(result.current.announcement).toBeNull();

    // The quiet period elapses — the hook arms itself (no announcement yet).
    act(() => vi.advanceTimersByTime(ACTIVITY_ANNOUNCE_ARM_DELAY_MS + 50));
    expect(result.current.announcement).toBeNull();

    // A genuinely new live event arrives after arming.
    act(() =>
      source.emitCardMoved(sampleActivityEvent({ id: 3, card_title: 'Deploy pipeline' })),
    );

    expect(result.current.announcement?.text).toContain('Deploy pipeline');
    expect(result.current.items).toHaveLength(3);
  });
});

describe('useActivityStream — reconnecting and degraded', () => {
  it('enters "reconnecting" on error while keeping existing items visible, escalates to "degraded" once the threshold elapses, and recovers to "open" on the next successful connect', () => {
    vi.useFakeTimers();
    const { result, source } = connect();
    act(() => source.emitOpen());
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1 })));

    act(() => source.emitError());
    expect(result.current.status).toBe('reconnecting');
    expect(result.current.items).toHaveLength(1);

    act(() => vi.advanceTimersByTime(ACTIVITY_DEGRADED_AFTER_MS + 1));
    expect(result.current.status).toBe('degraded');
    expect(result.current.items).toHaveLength(1); // frozen, not cleared

    act(() => source.emitOpen());
    expect(result.current.status).toBe('open');
  });
});

describe('useActivityStream — board switch', () => {
  it('resets items and returns to "connecting" when boardId changes on the same mounted instance (no stale cross-board feed)', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { result, rerender } = renderHook(({ id }: { id: number | string }) => useActivityStream(id), {
      initialProps: { id: 1 },
    });
    const first = FakeEventSource.instances[0];
    act(() => first.emitOpen());
    act(() => first.emitCardMoved(sampleActivityEvent({ id: 10, card_title: 'Board 1 item' })));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.status).toBe('open');

    // Navigate board 1 -> board 2 without unmounting (React Router reuses the instance).
    act(() => rerender({ id: 2 }));

    expect(result.current.items).toEqual([]); // board 1's item is gone, not shown under board 2
    expect(result.current.status).toBe('connecting'); // fresh connection state for the new board
    expect(first.closed).toBe(true); // old stream torn down
    expect(FakeEventSource.instances[1]).toBeDefined(); // a new stream opened for board 2
  });
});

describe('useActivityStream — re-announcement of identical text', () => {
  it('bumps announcement.seq for each armed live event even when the sentence is identical (so AT re-announces a repeated move)', () => {
    vi.useFakeTimers();
    const { result, source } = connect();
    act(() => source.emitOpen());
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 99 }))); // first frame opens the arm window (silent)
    act(() => vi.advanceTimersByTime(ACTIVITY_ANNOUNCE_ARM_DELAY_MS + 50)); // quiet period elapses → armed

    const move = { card_id: 5, card_title: 'Repeat', from_status: 'in_progress' as const, to_status: 'done' as const };
    act(() => source.emitCardMoved(sampleActivityEvent({ ...move, id: 1 })));
    const firstSeq = result.current.announcement?.seq;
    const firstText = result.current.announcement?.text;

    act(() => source.emitCardMoved(sampleActivityEvent({ ...move, id: 2 }))); // identical sentence, new event

    expect(result.current.announcement?.text).toBe(firstText); // same wording
    expect(result.current.announcement?.seq).toBeGreaterThan(firstSeq ?? 0); // but a distinct announcement
  });
});
