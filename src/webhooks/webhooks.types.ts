/**
 * Webhook / trigger-execution domain model and input shapes (FEAT-006 / TASK-006).
 *
 * Two audit concerns live behind one module: `trigger_executions` (one row per
 * rule firing) and `webhook_deliveries` (one row per webhook attempt-lifecycle,
 * with its `status` tracked SEPARATELY from the trigger-execution status). This
 * module holds only the data shapes — the repository, dispatcher (Phase 3), and
 * read routes depend on these types but not on each other's implementations.
 */

import type { CardStatus } from '../cards/cards.types';

/** Whether a rule firing's auto-move applied. */
export type TriggerExecutionStatus = 'executed' | 'failed';

/** The webhook delivery lifecycle; `delivered`/`exhausted` are terminal. */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'exhausted';

/** A persisted trigger execution (one per rule firing / auto-move hop). */
export interface TriggerExecution {
  id: number;
  /** FK to `automation_rules.id`, nullable (`ON DELETE SET NULL` — history survives rule deletion). */
  rule_id: number | null;
  /** FK to `cards.id`, nullable (`ON DELETE SET NULL`). */
  card_id: number | null;
  board_id: number;
  from_status: CardStatus;
  to_status: CardStatus;
  status: TriggerExecutionStatus;
  created_at: Date;
}

/**
 * A persisted webhook delivery record. `payload` (the TEXT JSON snapshot) is
 * persisted but NOT projected here (audit-only) — the read routes never return
 * it. `last_error` carries the serialized coded `WebhookError`.
 */
export interface WebhookDelivery {
  id: number;
  trigger_execution_id: number;
  rule_id: number | null;
  url: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  last_status_code: number | null;
  /** Serialized `WebhookError` (`JSON.stringify`), or `null`. */
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  delivered_at: Date | null;
}

/** The fixed-shape JSON body POSTed to a rule's `webhook_url` (AC-HAPPY-3). */
export interface WebhookPayload {
  event: 'rule.triggered';
  rule_id: number;
  board_id: number;
  card_id: number;
  card_title: string;
  from_status: CardStatus;
  to_status: CardStatus;
  triggered_by: 'rule';
  /** ISO-8601, captured ONCE at fire time (byte-stable across retry attempts). */
  occurred_at: string;
}

/** Coded failure serialized into `webhook_deliveries.last_error` (AC-ERROR-4). */
export interface WebhookError {
  code: 'WEBHOOK_NON_2XX' | 'WEBHOOK_TIMEOUT' | 'WEBHOOK_EXHAUSTED';
  message: string;
  details: { field: string; error: string }[];
}

/** Fields required to record one trigger execution (engine, on the request path). */
export interface RecordTriggerExecutionInput {
  rule_id: number;
  card_id: number;
  board_id: number;
  from_status: CardStatus;
  to_status: CardStatus;
  status: TriggerExecutionStatus;
}

/** Fields required to create the initial `pending` delivery (engine, on the request path). */
export interface CreateDeliveryInput {
  trigger_execution_id: number;
  rule_id: number;
  url: string;
  /** The TEXT JSON snapshot (`JSON.stringify(payload)`). */
  payload: string;
}

/** Partial delivery-lifecycle advance applied by the dispatcher (off the request path). */
export interface UpdateDeliveryInput {
  status?: WebhookDeliveryStatus;
  attempts?: number;
  last_status_code?: number | null;
  last_error?: string | null;
  delivered_at?: Date | null;
}

/** Filters for the trigger-execution read endpoint. */
export interface TriggerExecutionFilter {
  board_id?: number;
  rule_id?: number;
}

/** Filters for the webhook-delivery read endpoint. */
export interface WebhookDeliveryFilter {
  rule_id?: number;
  trigger_execution_id?: number;
  status?: WebhookDeliveryStatus;
}
