import type { CardActivity } from '../../api/types';
import { formatActivitySentence } from '../../statusLabels';

function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  // Absolute, not relative (extends Card.tsx's formatDueDate precedent with a
  // time component) — new items already convey recency by appearing live at
  // the top, so no ticking re-render is needed.
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * One rendered card-movement event. A deleted card (`card_id: null`) renders
 * identically to any other item — `card_title` is denormalized and always
 * present, so the sentence still reads correctly after the card is gone.
 */
export default function ActivityFeedItem({ event }: { event: CardActivity }) {
  return (
    <li className="activity-feed__item">
      <p>{formatActivitySentence(event)}</p>
      <time dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
    </li>
  );
}
