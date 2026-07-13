import { useParams } from 'react-router-dom';
import { getBoard, getCards } from '../../api/client';
import type { ApiResult } from '../../api/client';
import type { Board, Card } from '../../api/types';
import { useApiResource } from '../../hooks/useApiResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import NotFoundState from '../../components/NotFoundState';
import BoardHeader from './BoardHeader';
import Columns from './Columns';

interface BoardView {
  board: Board;
  cards: Card[];
}

/**
 * Fetch the board header and its cards in parallel and combine into one result.
 * A board 404 propagates as an http/404 result (→ distinct not-found state); any
 * other failure of either request propagates as a generic error (→ error+retry),
 * so no column ever silently renders empty from a swallowed error (AC-ERROR-2/3).
 */
async function getBoardView(id: string): Promise<ApiResult<BoardView>> {
  const [boardRes, cardsRes] = await Promise.all([getBoard(id), getCards(id)]);
  if (!boardRes.ok) {
    return boardRes;
  }
  if (!cardsRes.ok) {
    return cardsRes;
  }
  return { ok: true, data: { board: boardRes.data, cards: cardsRes.data } };
}

/**
 * Route `/boards/:id`. One state machine over both requests: loading
 * (AC-ASYNC-1) → not-found on board 404 (AC-ERROR-3, distinct, no Retry) →
 * error+retry on any other failure (AC-ERROR-2) → success: board header + three
 * fixed status columns (AC-HAPPY-4, and AC-HAPPY-6 via always-rendered columns).
 */
export default function BoardViewPage() {
  const { id = '' } = useParams();
  const { state, reload } = useApiResource(() => getBoardView(id), [id]);

  if (state.status === 'loading') {
    return (
      <main>
        <Loading />
      </main>
    );
  }

  if (state.status === 'error') {
    if (state.httpStatus === 404) {
      return (
        <NotFoundState
          title="Board not found"
          message="This board doesn’t exist or may have been deleted."
        />
      );
    }
    return (
      <main>
        <ErrorState message="Couldn’t load this board." onRetry={reload} />
      </main>
    );
  }

  return (
    <main className="board-view">
      <BoardHeader name={state.data.board.name} />
      <Columns cards={state.data.cards} />
    </main>
  );
}
