import type { Card as CardType, CardStatus } from '../../api/types';
import { STATUS_LABELS } from '../../statusLabels';
import { groupCardsByStatus } from './groupCardsByStatus';
import Column from './Column';

// Fixed column order; labels come from the shared STATUS_LABELS map (also
// used by the TASK-005 activity feed) so the two surfaces never drift.
const COLUMNS: ReadonlyArray<{ status: CardStatus; label: string }> = [
  { status: 'todo', label: STATUS_LABELS.todo },
  { status: 'in_progress', label: STATUS_LABELS.in_progress },
  { status: 'done', label: STATUS_LABELS.done },
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
