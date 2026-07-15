import { log } from '../config/logger';
import type { AutomationRule } from '../rules/rules.types';
import type { TriggerExecution, WebhookPayload } from './webhooks.types';

/**
 * The injected webhook-delivery seam (FEAT-006 / TASK-006), mirroring the
 * `ActivityEmitter`/`RuleEngine` idiom. The engine hands each `webhook_url`-
 * bearing rule firing to `dispatch`; the dispatcher owns the entire delivery
 * lifecycle (creating the `pending` `webhook_deliveries` row, performing the
 * outbound POST + bounded retries) OFF the request path.
 *
 * `dispatch` is deliberately fire-and-forget: it returns `void` immediately so
 * webhook latency never enters the `PATCH /cards/:id` budget, and it MUST be
 * internally fail-safe — it never throws out to the engine and never crashes
 * the process (mirrors the AC-ERROR-3/AC-ERROR-4 fail-safe posture). This is
 * the single swap-point for the real `HttpWebhookDispatcher` (Phase 3).
 */
export interface WebhookDispatcher {
  /**
   * Hand a webhook-bearing rule firing to the dispatcher. `execution` is the
   * already-recorded `trigger_executions` row for the hop, `rule` carries the
   * `webhook_url` to POST to, and `payload` is the fixed-shape body (captured
   * once at fire time so `occurred_at` is byte-stable across retries).
   */
  dispatch(execution: TriggerExecution, rule: AutomationRule, payload: WebhookPayload): void;
}

/**
 * A temporary no-op dispatcher for Phase 2: it only logs that a dispatch was
 * requested, so the engine can wire and unit-test the seam (dispatch is called
 * exactly when a firing rule has a `webhook_url`) WITHOUT the real outbound
 * HTTP + retry lifecycle, which is Phase 3's `HttpWebhookDispatcher`.
 *
 * Per the observability guidance it logs identifiers only — never the payload
 * body or the full `webhook_url` (either could carry secrets).
 */
export class NoopWebhookDispatcher implements WebhookDispatcher {
  dispatch(execution: TriggerExecution, rule: AutomationRule, _payload: WebhookPayload): void {
    log('info', 'rules.webhook_dispatch_noop', {
      trigger_execution_id: execution.id,
      rule_id: rule.id,
      card_id: execution.card_id,
      board_id: execution.board_id,
    });
  }
}
