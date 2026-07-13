import { Link } from 'react-router-dom';

interface NotFoundStateProps {
  title?: string;
  message?: string;
}

/**
 * Distinct "not found" presentation — used both for the router catch-all (`*`)
 * and, in Phase 3, for a board-view 404 (`GET /boards/:id` → 404). Deliberately
 * has NO Retry (retrying won't fix a 404); offers a way back to the board list.
 */
export default function NotFoundState({
  title = 'Page not found',
  message = 'The page you’re looking for doesn’t exist.',
}: NotFoundStateProps) {
  return (
    <main className="not-found-state">
      <h1>{title}</h1>
      <p>{message}</p>
      <Link to="/">Back to boards</Link>
    </main>
  );
}
