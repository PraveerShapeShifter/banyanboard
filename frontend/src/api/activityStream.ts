import type { CardActivity } from './types';

/**
 * The single client seam for the realtime activity stream (TASK-005),
 * mirroring `api/client.ts`'s fetch-confinement discipline: this is the only
 * module in the frontend that touches `EventSource` directly, so tests can
 * substitute a fake (`test/fakeEventSource.ts`) here and nowhere else.
 */

export interface ActivityStreamCallbacks {
  onOpen?: () => void;
  onMessage: (event: CardActivity) => void;
  onError?: () => void;
}

export interface ActivityStreamHandle {
  close(): void;
}

/**
 * Base path for all API calls (12-factor — same discipline as `client.ts`'s
 * `baseUrl()`). Read per call, never baked in at module load.
 */
function baseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '/api';
}

/**
 * Opens the board-scoped SSE connection (`GET /activity/stream?board_id=`).
 * `card_moved` frames are JSON-parsed and handed to `onMessage` as a typed
 * `CardActivity`; `onopen`/`onerror` map to the optional connection hooks.
 * Reconnection and backfill/replay are handled natively by the browser's
 * `EventSource` (Last-Event-ID) — this seam does not reimplement any of that.
 */
export function openActivityStream(
  boardId: number | string,
  callbacks: ActivityStreamCallbacks,
): ActivityStreamHandle {
  const url = `${baseUrl()}/activity/stream?board_id=${encodeURIComponent(String(boardId))}`;
  const source = new EventSource(url);

  if (callbacks.onOpen) {
    source.addEventListener('open', callbacks.onOpen);
  }
  if (callbacks.onError) {
    source.addEventListener('error', callbacks.onError);
  }
  source.addEventListener('card_moved', (event: Event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as CardActivity;
    callbacks.onMessage(data);
  });

  return {
    close(): void {
      source.close();
    },
  };
}
