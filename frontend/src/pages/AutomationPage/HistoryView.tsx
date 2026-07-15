import { getTriggerExecutions } from '../../api/webhooks';
import { useApiResource } from '../../hooks/useApiResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import TriggerExecutionItem from './TriggerExecutionItem';

/**
 * The read-only automation history (TASK-006 Phase 4). A plain `useApiResource`
 * read over `GET /trigger-executions?board_id=` with a manual Refresh button —
 * deliberately NOT a live/SSE hook (AC-ASYNC-3: no realtime push for
 * deliveries). Master-detail: each firing expands to its webhook deliveries.
 */
export default function HistoryView({ boardId }: { boardId: number | string }) {
  const { state, reload } = useApiResource(() => getTriggerExecutions(boardId), [boardId]);

  return (
    <div className="history-view">
      <div className="history-view__toolbar">
        <button type="button" onClick={reload}>
          Refresh
        </button>
      </div>

      {state.status === 'loading' && <Loading label="Loading history…" />}

      {state.status === 'error' && (
        <ErrorState message="Couldn’t load history." onRetry={reload} />
      )}

      {state.status === 'success' &&
        (state.data.length === 0 ? (
          <EmptyState message="No automation has fired yet on this board." />
        ) : (
          <ul className="trigger-list">
            {state.data.map((execution) => (
              <TriggerExecutionItem key={execution.id} execution={execution} />
            ))}
          </ul>
        ))}
    </div>
  );
}
