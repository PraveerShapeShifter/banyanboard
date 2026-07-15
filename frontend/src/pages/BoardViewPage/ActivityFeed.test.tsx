import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import ActivityFeed from './ActivityFeed';
import {
  ACTIVITY_ANNOUNCE_ARM_DELAY_MS,
  ACTIVITY_DEGRADED_AFTER_MS,
} from '../../hooks/useActivityStream';
import { FakeEventSource, sampleActivityEvent } from '../../test/fakeEventSource';

/**
 * Phase 3 tests (TASK-005): `ActivityFeed` is the board-view region that owns
 * `useActivityStream(boardId)` and renders the five UI states from the UI/UX
 * creative (connecting / open+streaming / open+empty / reconnecting /
 * degraded). Nothing is mocked below `EventSource` — these tests drive the
 * REAL `useActivityStream` hook and the REAL `activityStream.ts` seam through
 * `FakeEventSource` (shared with `api/activityStream.test.ts` and
 * `hooks/useActivityStream.test.ts`), so together the three files prove the
 * whole client stack — seam → hook → component — is wired end-to-end
 * (the Test Strategy's "journey test": real transport frame → DOM).
 *
 * Contract asserted here (for the Coding Agent):
 * - `<ActivityFeed boardId={number | string} />` renders
 *   `<section aria-labelledby="activity-feed-heading">` +
 *   `<h2 id="activity-feed-heading">Activity</h2>` (accessible name "Activity"),
 *   mirroring `Column`'s `aria-labelledby` pattern (AC-ENTRY-1).
 * - connecting → shared `Loading` (feed-scoped copy, matched via /loading activity/i).
 * - open + zero items → shared `EmptyState`, "No activity yet" copy.
 * - open + items → a single `<ul>` of `<li>` items, newest-first; the `<ul>`
 *   itself carries NO `aria-live`.
 * - Each item reads `Someone moved "{card_title}" from {From Label} to {To Label}`
 *   (identical for a deleted card, `card_id: null`), and contains a `<time
 *   dateTime={created_at}>` element.
 * - reconnecting → `ActivityFeedStatus` `role="status"`, list still rendered.
 * - degraded → `ActivityFeedStatus` `role="alert"`, list still rendered (frozen).
 * - A single visually-hidden element with `aria-live="polite"`, sibling to the
 *   `<ul>`, is the only thing that receives new-item text — populated only
 *   once the hook's `announcement` is set (i.e. after arming), matching the
 *   hook's own arming-heuristic tests.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeEventSource.reset();
});

function renderFeed(boardId: number | string = 7) {
  vi.stubGlobal('EventSource', FakeEventSource);
  const utils = render(<ActivityFeed boardId={boardId} />);
  return { ...utils, source: FakeEventSource.instances[0] };
}

describe('ActivityFeed — entry + connecting (AC-ENTRY-1)', () => {
  it('renders as an accessibly-named region, distinct from the status columns, showing the shared Loading state while connecting', () => {
    renderFeed();

    expect(screen.getByRole('region', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText(/loading activity/i)).toBeInTheDocument();
  });
});

describe('ActivityFeed — empty state', () => {
  it('shows the calm "No activity yet" empty state once connected with no history, distinct from an error/alert', () => {
    const { source } = renderFeed();
    act(() => source.emitOpen());

    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ActivityFeed — live append + phrasing + ordering (AC-HAPPY-1/2, AC-ASYNC-1, AC-INTEGRATION-1)', () => {
  it('renders backfilled history newest-first, then appends a live push to the top with no reload — each item a plain-language sentence naming the real card and From/To labels, "Someone" as the actor, identically for a deleted card, with an absolute <time> element', () => {
    const { source } = renderFeed();
    act(() => source.emitOpen());

    // Backfill: two historical events arrive right after connecting.
    act(() =>
      source.emitCardMoved(
        sampleActivityEvent({
          id: 1,
          card_title: 'Card X',
          from_status: 'todo',
          to_status: 'in_progress',
        }),
      ),
    );
    act(() =>
      source.emitCardMoved(
        sampleActivityEvent({
          id: 2,
          card_id: null, // deleted card — must still read correctly
          card_title: 'Deleted card',
          from_status: 'in_progress',
          to_status: 'done',
        }),
      ),
    );

    let items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(
      within(items[0]).getByText('Someone moved "Deleted card" from In Progress to Done'),
    ).toBeInTheDocument();
    expect(
      within(items[1]).getByText('Someone moved "Card X" from To Do to In Progress'),
    ).toBeInTheDocument();

    // A genuinely new live push (AC-HAPPY-1) — appears at the top, no reload/remount.
    act(() =>
      source.emitCardMoved(
        sampleActivityEvent({
          id: 3,
          card_title: 'Card Y',
          from_status: 'in_progress',
          to_status: 'done',
          created_at: '2026-07-15T15:10:00.000Z',
        }),
      ),
    );

    items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(
      within(items[0]).getByText('Someone moved "Card Y" from In Progress to Done'),
    ).toBeInTheDocument();

    const time = items[0].querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('datetime')).toBe('2026-07-15T15:10:00.000Z');
  });
});

describe('ActivityFeed — connection health banners (AC-ASYNC-2, AC-ERROR-1)', () => {
  it('shows a role=status reconnecting banner above a still-visible list, and escalates to a role=alert degraded banner while the list stays visible/frozen', () => {
    vi.useFakeTimers();
    const { source } = renderFeed();
    act(() => source.emitOpen());
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1 })));

    act(() => source.emitError());
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(ACTIVITY_DEGRADED_AFTER_MS + 1));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });
});

describe('ActivityFeed — accessible announcer (AC-HAPPY-2 a11y, chatty-feed guard)', () => {
  it('never puts aria-live on the visible list, stays silent through the backfill burst, and announces exactly once for the next genuinely-new live event', () => {
    vi.useFakeTimers();
    const { container, source } = renderFeed();
    act(() => source.emitOpen());

    expect(screen.getByRole('list')).not.toHaveAttribute('aria-live');
    let announcer = container.querySelector('[aria-live="polite"]');
    expect(announcer).not.toBeNull();

    // Backfill burst — silent.
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 1 })));
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 2 })));
    expect(announcer?.textContent).toBe('');

    // Quiet period elapses — the hook arms (still no announcement of its own).
    act(() => vi.advanceTimersByTime(ACTIVITY_ANNOUNCE_ARM_DELAY_MS + 50));
    expect(announcer?.textContent).toBe('');

    // A genuinely new live event — announced.
    act(() => source.emitCardMoved(sampleActivityEvent({ id: 3, card_title: 'Live move' })));

    announcer = container.querySelector('[aria-live="polite"]');
    expect(announcer?.textContent).toContain('Live move');
  });
});
