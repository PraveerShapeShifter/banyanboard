import { getJson } from './client';
import type { ApiResult } from './client';
import type { DeliveryStatus, TriggerExecution, WebhookDelivery } from './types';

/**
 * Concern-scoped READ-ONLY seam for the automation history (TASK-006 Phase 4).
 * The history is polled/refreshed — there is deliberately NO SSE for deliveries
 * (AC-ASYNC-3) — so both functions return `ApiResult<T>` for `useApiResource`.
 * A client never advances a delivery, so there are no mutations here.
 */

/** `GET /trigger-executions?board_id=` — the board's rule firings. */
export function getTriggerExecutions(
  boardId: number | string,
): Promise<ApiResult<TriggerExecution[]>> {
  return getJson<TriggerExecution[]>(
    `/trigger-executions?board_id=${encodeURIComponent(String(boardId))}`,
  );
}

/** `GET /webhook-deliveries?...` — deliveries filtered by rule / firing / status. */
export function getWebhookDeliveries(params: {
  ruleId?: number | string;
  triggerExecutionId?: number | string;
  status?: DeliveryStatus;
}): Promise<ApiResult<WebhookDelivery[]>> {
  const query = new URLSearchParams();
  if (params.ruleId !== undefined) query.set('rule_id', String(params.ruleId));
  if (params.triggerExecutionId !== undefined) {
    query.set('trigger_execution_id', String(params.triggerExecutionId));
  }
  if (params.status !== undefined) query.set('status', params.status);
  const qs = query.toString();
  return getJson<WebhookDelivery[]>(`/webhook-deliveries${qs ? `?${qs}` : ''}`);
}
