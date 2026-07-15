import { Link } from 'react-router-dom';

/** Board-view header: a back-link to the list plus the board name as `<h1>`. */
export default function BoardHeader({ name }: { name: string }) {
  return (
    <header className="board-header">
      <Link to="/">← Boards</Link>
      <h1>{name}</h1>
    </header>
  );
}
