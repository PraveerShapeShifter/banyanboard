import { Link } from 'react-router-dom';
import type { Board } from '../../api/types';

/**
 * One clickable board row: the whole row is a single native `<Link>` (so
 * keyboard activation, "open in new tab", and screen-reader link semantics all
 * work for free). The link's accessible name combines name + description so the
 * row's full context is announced, not just the name.
 */
export default function BoardListItem({ board }: { board: Board }) {
  const accessibleName = board.description
    ? `${board.name}. ${board.description}`
    : board.name;

  return (
    <li className="board-list-item">
      <Link to={`/boards/${board.id}`} aria-label={accessibleName}>
        <span className="board-list-item__name">{board.name}</span>
        {board.description && (
          <span className="board-list-item__description">
            {board.description}
          </span>
        )}
      </Link>
    </li>
  );
}
