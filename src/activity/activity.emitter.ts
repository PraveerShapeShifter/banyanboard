import { log } from '../config/logger';
import type { ActivityEvent } from './activity.types';

/**
 * In-process, per-board fan-out seam for activity events (TASK-005,
 * architecture Q4). Deliberately a small purpose-built interface rather than
 * raw `EventEmitter` (which warns past 10 listeners and offers a clumsier
 * unsubscribe). This is the single swap-point for a future multi-instance
 * promotion (Postgres `LISTEN/NOTIFY` or Redis pub/sub) — routes, the
 * repository, and the capture hook never change, only the implementation
 * constructed in `src/server.ts`.
 */
export interface ActivityEmitter {
  /** Registers `handler` for `boardId`'s events. Returns an unsubscribe function. */
  subscribe(boardId: number, handler: (event: ActivityEvent) => void): () => void;
  /** Synchronously fans `event` out to every current subscriber of `boardId`. */
  emit(boardId: number, event: ActivityEvent): void;
}

/**
 * MVP single-instance implementation: a `Map<boardId, Set<handler>>`.
 * `emit` only reaches subscribers on this Node process — correct for the
 * project's single-instance `docker compose` deployment (documented scaling
 * boundary in the architecture decision; not built here).
 */
export class InProcessActivityEmitter implements ActivityEmitter {
  private readonly subscribersByBoard = new Map<number, Set<(event: ActivityEvent) => void>>();

  subscribe(boardId: number, handler: (event: ActivityEvent) => void): () => void {
    let handlers = this.subscribersByBoard.get(boardId);
    if (!handlers) {
      handlers = new Set();
      this.subscribersByBoard.set(boardId, handlers);
    }
    handlers.add(handler);

    return () => {
      const current = this.subscribersByBoard.get(boardId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.subscribersByBoard.delete(boardId);
      }
    };
  }

  emit(boardId: number, event: ActivityEvent): void {
    const handlers = this.subscribersByBoard.get(boardId);
    if (!handlers) return;
    // Isolate each subscriber: a throwing handler must not abort fan-out to the
    // rest (nor bubble out of emit). Snapshot to tolerate unsubscribe-during-emit.
    for (const handler of [...handlers]) {
      try {
        handler(event);
      } catch (err) {
        log('error', 'activity.emit.handler_error', {
          board_id: boardId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
