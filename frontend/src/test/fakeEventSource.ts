import type { CardActivity } from '../api/types';

/**
 * jsdom has no native `EventSource`. This fake stands in for it across the
 * whole activity-stream test suite (`api/activityStream.test.ts`,
 * `hooks/useActivityStream.test.ts`, `pages/BoardViewPage/ActivityFeed.test.tsx`),
 * stubbed onto `global.EventSource` exactly like `api/client.test.ts` stubs
 * `global.fetch`. Each of those three files exercises one more real module on
 * top of this same fake (seam only → seam+hook → seam+hook+component), so
 * together they prove the whole client stack is wired correctly end-to-end,
 * not just each piece in isolation — this is what stands in for a live
 * `EventSource`/network connection in every test that needs one.
 */
type Listener = (event: MessageEvent | Event) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  // --- test-only helpers (not part of the real EventSource API) ---

  /** Simulates the browser establishing (or re-establishing) the connection. */
  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.listeners.get('open')?.forEach((listener) => listener(new Event('open')));
  }

  /** Simulates a `card_moved` SSE frame arriving. */
  emitCardMoved(data: CardActivity): void {
    const event = new MessageEvent('card_moved', {
      data: JSON.stringify(data),
      lastEventId: String(data.id),
    });
    this.listeners.get('card_moved')?.forEach((listener) => listener(event));
  }

  /** Simulates a connection error (the browser will attempt to auto-reconnect). */
  emitError(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.listeners.get('error')?.forEach((listener) => listener(new Event('error')));
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

/** A representative `card_moved` payload, overridable per test. */
export function sampleActivityEvent(overrides: Partial<CardActivity> = {}): CardActivity {
  return {
    id: 1,
    board_id: 7,
    card_id: 10,
    card_title: 'Deploy pipeline',
    from_status: 'in_progress',
    to_status: 'done',
    created_at: '2026-07-15T14:41:00.000Z',
    ...overrides,
  };
}
