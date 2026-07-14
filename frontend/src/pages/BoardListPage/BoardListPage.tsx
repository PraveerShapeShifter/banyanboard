import { getBoards } from '../../api/client';
import { useApiResource } from '../../hooks/useApiResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import BoardList from './BoardList';

/**
 * Route `/` — the app's landing view (AC-ENTRY-1). Fetches all boards and
 * renders exactly one of: loading (AC-ASYNC-1), error + retry (AC-ERROR-1),
 * empty (AC-HAPPY-5), or the list (AC-HAPPY-2). Selecting a board navigates to
 * its view (AC-HAPPY-3, handled by the row link).
 */
export default function BoardListPage() {
  const { state, reload } = useApiResource(() => getBoards());

  return (
    <main>
      <h1>Boards</h1>
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && (
        <ErrorState message="Couldn’t load boards." onRetry={reload} />
      )}
      {state.status === 'success' &&
        (state.data.length === 0 ? (
          <EmptyState message="No boards yet." />
        ) : (
          <BoardList boards={state.data} />
        ))}
    </main>
  );
}
