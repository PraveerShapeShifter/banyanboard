import { Link, useLocation } from 'react-router-dom';

interface BoardHeaderProps {
  name: string;
  /** The board id, so the Board/Automation nav can build its route links. */
  id: number | string;
}

/**
 * Board-view header: a back-link to the list, the board name as `<h1>`, and a
 * Board/Automation nav (TASK-006 Phase 4). The nav is a set of route `<Link>`s
 * with `aria-current="page"` on the active view — the semantically-correct
 * pattern for tabs that are NAVIGATIONS (route changes), as opposed to the
 * in-page ARIA `tablist` used for the Rules/History switch. The active view is
 * derived from the URL so it stays correct on deep-link/back/forward.
 */
export default function BoardHeader({ name, id }: BoardHeaderProps) {
  const { pathname } = useLocation();
  const boardPath = `/boards/${encodeURIComponent(String(id))}`;
  const automationPath = `${boardPath}/automation`;
  const onAutomation = pathname === automationPath;

  return (
    <header className="board-header">
      <Link to="/">← Boards</Link>
      <h1>{name}</h1>
      <nav aria-label="Board views" className="board-header__nav">
        <Link to={boardPath} aria-current={onAutomation ? undefined : 'page'}>
          Board
        </Link>
        <Link to={automationPath} aria-current={onAutomation ? 'page' : undefined}>
          Automation
        </Link>
      </nav>
    </header>
  );
}
