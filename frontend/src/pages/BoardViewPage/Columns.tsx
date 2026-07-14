import type { Card as CardType, CardStatus } from '../../api/types';
import { groupCardsByStatus } from './groupCardsByStatus';
import Column from './Column';

// Fixed column order and labels: status value → display label.
const COLUMNS: ReadonlyArray<{ status: CardStatus; label: string }> = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'done', label: 'Done' },
];

/**
 * Lays out the three fixed columns. Partitions cards once via
 * {@link groupCardsByStatus}, then always renders all three columns in order.
 */
export default function Columns({ cards }: { cards: CardType[] }) {
  const grouped = groupCardsByStatus(cards);

  return (
    <div className="columns">
      {COLUMNS.map(({ status, label }) => (
        <Column
          key={status}
          status={status}
          label={label}
          cards={grouped[status]}
        />
      ))}
    </div>
  );
}
