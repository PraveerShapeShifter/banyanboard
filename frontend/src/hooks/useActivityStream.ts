import { useEffect, useRef, useState } from 'react';
import { openActivityStream } from '../api/activityStream';
import type { CardActivity } from '../api/types';
import { formatActivitySentence } from '../statusLabels';

/**
 * Quiet-period (ms) used by the "arming" heuristic below: after (re-)entering
 * `open`, incoming frames stay silent until this much time elapses with no
 * new frame — this is what tells a backfill/reconnect-replay burst apart
 * from a genuinely new live event, without the wire protocol distinguishing
 * them (see the UI/UX creative's Accessibility Deep-Dive).
 *
 * Correctness assumption: the server (Phase 2 `activity.routes.ts`) writes an
 * entire backfill/replay batch in one synchronous `res.write` loop, so the
 * client receives the batch as a contiguous burst with sub-window inter-frame
 * gaps — the quiet period then only elapses once the batch is fully drained.
 * Residual limitation: a pathological network stall that splits a single
 * batch across delivery gaps > this window could announce one historical
 * frame. The fully-deterministic fix is a server "backfill-complete" control
 * frame carrying the cursor (a small Phase 2 follow-up); tracked, not built.
 */
export const ACTIVITY_ANNOUNCE_ARM_DELAY_MS = 250;

/** How long sustained `reconnecting` must persist before declaring `degraded`. */
export const ACTIVITY_DEGRADED_AFTER_MS = 10000;

/** Client-only cap on retained feed items (oldest trimmed first). */
export const ACTIVITY_FEED_MAX_ITEMS = 100;

export type ActivityStreamStatus = 'connecting' | 'open' | 'reconnecting' | 'degraded';

export interface UseActivityStreamResult {
  status: ActivityStreamStatus;
  items: CardActivity[];
  announcement: { seq: number; text: string } | null;
}

/**
 * Client connection state machine over the board-scoped SSE stream, mirroring
 * `useApiResource`'s single-state-value discipline. Opens the stream
 * (`api/activityStream.ts`) on mount, closes it on unmount.
 *
 * Items are newest-first and deduped by `id`: a duplicate frame (e.g. a
 * reconnect replaying an event already seen) is a no-op, not a re-prepend,
 * so it never reshuffles the list.
 *
 * Arming heuristic: on (re-)entering `open`, each incoming frame resets a
 * quiet-period timer and is appended silently (no `announcement`); once that
 * timer elapses uninterrupted, the hook is "armed" and every subsequent
 * frame both appends and sets `announcement`. This keeps backfill and
 * reconnect-replay bursts silent while genuinely-new live events announce.
 */
export function useActivityStream(boardId: number | string): UseActivityStreamResult {
  const [status, setStatus] = useState<ActivityStreamStatus>('connecting');
  const [items, setItems] = useState<CardActivity[]>([]);
  const [announcement, setAnnouncement] = useState<{ seq: number; text: string } | null>(null);

  // Refs mirror state where a callback needs a synchronous read (avoids
  // stale closures over `status`/`items` inside the SSE callbacks below).
  const statusRef = useRef<ActivityStreamStatus>('connecting');
  const itemsRef = useRef<CardActivity[]>([]);
  const itemIdsRef = useRef<Set<number>>(new Set());
  const armedRef = useRef(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const degradedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    function setStatusBoth(next: ActivityStreamStatus) {
      statusRef.current = next;
      setStatus(next);
    }

    function clearArmTimer() {
      if (armTimerRef.current !== null) {
        clearTimeout(armTimerRef.current);
        armTimerRef.current = null;
      }
    }

    function clearDegradedTimer() {
      if (degradedTimerRef.current !== null) {
        clearTimeout(degradedTimerRef.current);
        degradedTimerRef.current = null;
      }
    }

    function startArmWindow() {
      clearArmTimer();
      armTimerRef.current = setTimeout(() => {
        armedRef.current = true;
      }, ACTIVITY_ANNOUNCE_ARM_DELAY_MS);
    }

    // Reset all per-connection state up front so switching boards in place
    // (React Router keeps this component mounted across a `/boards/:id` param
    // change) never renders the previous board's items/announcement under the
    // new board, and always starts the new board from `connecting`.
    armedRef.current = false;
    itemsRef.current = [];
    itemIdsRef.current = new Set();
    setItems([]);
    setAnnouncement(null);
    setStatusBoth('connecting');

    let handle: ReturnType<typeof openActivityStream> | null = null;
    try {
      handle = openActivityStream(boardId, {
        onOpen: () => {
          clearDegradedTimer();
          armedRef.current = false;
          clearArmTimer();
          setStatusBoth('open');
        },
        onMessage: (event) => {
          if (itemIdsRef.current.has(event.id)) {
            return; // duplicate frame (e.g. reconnect replay) — no-op, not a re-prepend
          }

          const next = [event, ...itemsRef.current].slice(0, ACTIVITY_FEED_MAX_ITEMS);
          itemsRef.current = next;
          itemIdsRef.current = new Set(next.map((item) => item.id));
          setItems(next);

          if (armedRef.current) {
            seqRef.current += 1;
            setAnnouncement({ seq: seqRef.current, text: formatActivitySentence(event) });
          } else {
            startArmWindow();
          }
        },
        onError: () => {
          clearArmTimer();
          if (statusRef.current === 'degraded') {
            return; // already degraded; nothing new until the next successful open
          }
          setStatusBoth('reconnecting');
          if (degradedTimerRef.current === null) {
            degradedTimerRef.current = setTimeout(() => {
              degradedTimerRef.current = null;
              setStatusBoth('degraded');
            }, ACTIVITY_DEGRADED_AFTER_MS);
          }
        },
      });
    } catch {
      // Fail-safe: if the transport can't even be constructed (e.g. no
      // EventSource support), surface degraded rather than crashing the rest
      // of the board (AC-ERROR-1 — columns/cards stay unaffected).
      setStatusBoth('degraded');
    }

    return () => {
      clearArmTimer();
      clearDegradedTimer();
      handle?.close();
    };
    // Intentionally re-run only when `boardId` changes (mirrors
    // `useApiResource`'s deps discipline) — the callbacks close over refs,
    // not the exhaustive-deps-flagged state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  return { status, items, announcement };
}
