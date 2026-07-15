import type { CardActivity, CardStatus } from './api/types';

/**
 * Canonical status → display label map, shared by the status columns
 * (`pages/BoardViewPage/Columns.tsx`) and the activity feed
 * (`pages/BoardViewPage/ActivityFeedItem.tsx`, `hooks/useActivityStream.ts`)
 * so the two surfaces can never drift on a status's wording.
 */
export const STATUS_LABELS: Record<CardStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

/**
 * The single phrasing template for one activity item, shared by the visible
 * list item (`ActivityFeedItem`) and the hidden `aria-live` announcer
 * (`useActivityStream`) so both surfaces read identically. `{actor}` is
 * always "Someone" today — no auth exists yet (see the architecture/UI-UX
 * creative); it is the only token that will change once a real actor ships.
 * A deleted card (`card_id: null`) renders identically to any other item
 * because `card_title` is denormalized and always present.
 */
export function formatActivitySentence(event: CardActivity): string {
  return `Someone moved "${event.card_title}" from ${STATUS_LABELS[event.from_status]} to ${STATUS_LABELS[event.to_status]}`;
}
