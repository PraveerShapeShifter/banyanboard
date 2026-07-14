import type { Board } from '../../api/types';
import BoardListItem from './BoardListItem';

/** Presentational: the semantic `<ul>` of boards (UI/UX decision A1 — link list). */
export default function BoardList({ boards }: { boards: Board[] }) {
  return (
    <ul className="board-list">
      {boards.map((board) => (
        <BoardListItem key={board.id} board={board} />
      ))}
    </ul>
  );
}
