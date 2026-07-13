import { Link, useParams } from 'react-router-dom';

/**
 * Phase 2 placeholder so the `/boards/:id` route resolves and click-through
 * navigation is testable. The full board view — `GET /boards/:id` +
 * `GET /cards?board_id=`, status grouping into three columns, empty/error/404
 * states — arrives in Phase 3.
 */
export default function BoardViewPage() {
  const { id } = useParams();

  return (
    <main>
      <Link to="/">← Boards</Link>
      <h1>Board {id}</h1>
      <p>Board view coming in the next phase.</p>
    </main>
  );
}
