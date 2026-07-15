import { useParams } from 'react-router-dom';
import { getBoard } from '../../api/client';
import type { Board } from '../../api/types';
import { useApiResource } from '../../hooks/useApiResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import NotFoundState from '../../components/NotFoundState';
import BoardHeader from '../BoardViewPage/BoardHeader';
import AutomationTabs from './AutomationTabs';

/**
 * Route `/boards/:id/automation` (TASK-006 Phase 4). Fetches the board (to
 * render the same `<h1>` and validate the id) via the existing `getBoard` seam,
 * mirroring `BoardViewPage`'s state machine exactly: loading -> not-found on a
 * board 404 (no Retry) -> error+Retry on any other failure -> ready. On ready it
 * renders the `BoardHeader` (with the Board/Automation nav) + the Rules/History
 * tabs. A separate `getBoard` here (cheap) is what gives the correct 404 path.
 */
export default function AutomationPage() {
  const { id = '' } = useParams();
  const { state, reload } = useApiResource<Board>(() => getBoard(id), [id]);

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
    <main className="automation-page">
      <BoardHeader name={state.data.name} id={state.data.id} />
      <AutomationTabs boardId={state.data.id} />
    </main>
  );
}
