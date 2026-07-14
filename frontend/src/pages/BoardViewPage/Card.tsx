import type { Card as CardType } from '../../api/types';

function formatDueDate(due: string): string {
  const parsed = new Date(due);
  if (Number.isNaN(parsed.getTime())) {
    return due;
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * One card summary. Shows `title`, optional `description`, and (if present) the
 * due date with an explicit "Due:" text label — never a bare date or a
 * color-only cue (WCAG AA; status is conveyed by column membership + heading).
 */
export default function Card({ card }: { card: CardType }) {
  return (
    <article className="card">
      <h3 className="card__title">{card.title}</h3>
      {card.description && (
        <p className="card__description">{card.description}</p>
      )}
      {card.due_date && (
        <p className="card__due">Due: {formatDueDate(card.due_date)}</p>
      )}
    </article>
  );
}
