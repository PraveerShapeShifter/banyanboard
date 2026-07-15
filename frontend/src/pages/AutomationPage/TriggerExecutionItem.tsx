import { useState } from 'react';
import { getWebhookDeliveries } from '../../api/webhooks';
import type { TriggerExecution, WebhookDelivery } from '../../api/types';
import { STATUS_LABELS } from '../../statusLabels';
import { useApiResource } from '../../hooks/useApiResource';
import Loading from '../../components/Loading';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import DeliveryStatusBadge from './DeliveryStatusBadge';

/** Absolute timestamp (mirrors ActivityFeedItem's formatter). */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The deliveries for one firing, loaded lazily when its row is expanded (a
 * plain `useApiResource` read — no SSE, AC-ASYNC-3). Surfaces each delivery's
 * status badge and, for failed/exhausted, the coded `error` reason.
 */
function Deliveries({ triggerExecutionId }: { triggerExecutionId: number }) {
  const { state, reload } = useApiResource(
    () => getWebhookDeliveries({ triggerExecutionId }),
    [triggerExecutionId],
  );

  if (state.status === 'loading') {
    return <Loading label="Loading deliveries…" />;
  }
  if (state.status === 'error') {
    return <ErrorState message="Couldn’t load deliveries." onRetry={reload} />;
  }
  if (state.data.length === 0) {
    return <EmptyState message="No webhook configured for this firing." />;
  }

  return (
    <ul className="delivery-list">
      {state.data.map((delivery: WebhookDelivery) => (
        <li key={delivery.id} className="delivery-list__item">
          <DeliveryStatusBadge status={delivery.status} />
          <span className="delivery-list__attempts">
            {delivery.attempts} attempt{delivery.attempts === 1 ? '' : 's'}
          </span>
          {delivery.last_status_code !== null && (
            <span className="delivery-list__code">HTTP {delivery.last_status_code}</span>
          )}
          {delivery.delivered_at && (
            <time dateTime={delivery.delivered_at}>
              {formatTimestamp(delivery.delivered_at)}
            </time>
          )}
          {(delivery.status === 'failed' || delivery.status === 'exhausted') &&
            delivery.error && (
              <p className="delivery-list__error">
                {delivery.error.message}
                {delivery.error.details.length > 0 &&
                  `: ${delivery.error.details.map((d) => d.error).join(', ')}`}
              </p>
            )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One rule-firing row (TASK-006 Phase 4). Reads "A card moved {from}->{to}"
 * with the firing status and absolute time; expands (master-detail) to lazily
 * load its webhook deliveries. `TriggerExecution` carries no `card_title` on the
 * frozen wire contract, so the row identifies the card by id (deviation from the
 * UI/UX doc's card-title phrasing — the contract simply doesn't carry it).
 */
export default function TriggerExecutionItem({
  execution,
}: {
  execution: TriggerExecution;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardRef = execution.card_id === null ? 'a deleted card' : `card #${execution.card_id}`;

  return (
    <li className="trigger-list__item">
      <button
        type="button"
        className="trigger-list__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>
          Moved {cardRef} from {STATUS_LABELS[execution.from_status]} to{' '}
          {STATUS_LABELS[execution.to_status]} · {execution.status}
        </span>
        <time dateTime={execution.created_at}>{formatTimestamp(execution.created_at)}</time>
      </button>
      {expanded && <Deliveries triggerExecutionId={execution.id} />}
    </li>
  );
}
