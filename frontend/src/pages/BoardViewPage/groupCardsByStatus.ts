import type { Card, CardStatus } from '../../api/types';

/**
 * Partition cards into the three status buckets. Seeded with all three keys so a
 * status with zero cards yields `[]` (never `undefined`) — this guarantees every
 * column renders regardless of counts (AC-HAPPY-6) by construction, and is called
 * once per render rather than re-filtering per column.
 */
export function groupCardsByStatus(cards: Card[]): Record<CardStatus, Card[]> {
  const groups: Record<CardStatus, Card[]> = {
    todo: [],
    in_progress: [],
    done: [],
  };
  for (const card of cards) {
    const bucket = groups[card.status];
    // Guard against an unexpected status outside the union (defensive; the
    // wire type constrains it to the three known values).
    if (bucket) {
      bucket.push(card);
    }
  }
  return groups;
}
