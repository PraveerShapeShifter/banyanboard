import type { Card as CardType, CardStatus } from '../../api/types';
import Card from './Card';
import EmptyState from '../../components/EmptyState';

interface ColumnProps {
  status: CardStatus;
  label: string;
  cards: CardType[];
}

/**
 * One status column. Rendered as a `<section>` labelled by its `<h2>` so screen
 * readers can jump column-to-column via heading navigation. The heading carries
 * the persistent text label + count (e.g. "To Do (2)") — status is never
 * conveyed by color alone. Always renders; an empty column shows "No cards".
 */
export default function Column({ status, label, cards }: ColumnProps) {
  const headingId = `col-${status}-heading`;

  return (
    <section className="column" aria-labelledby={headingId}>
      <h2 id={headingId} className="column__header">
        {label} ({cards.length})
      </h2>
      {cards.length === 0 ? (
        <EmptyState message="No cards" />
      ) : (
        <ul className="column__cards">
          {cards.map((card) => (
            <li key={card.id}>
              <Card card={card} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
