/**
 * Wire types for the BanyanBoard REST API, typed to the JSON wire format.
 *
 * NOTE: the backend domain types use JS `Date` for the timestamp/date fields,
 * but `res.json()` serializes them to ISO strings — so on the wire these arrive
 * as `string`, not `Date`. These are frontend-owned (a documented deviation from
 * the shared-types recommendation; see the Architecture creative, Q5). `Card`
 * has no `labels` field — it does not exist in the `cards` schema.
 */

export type CardStatus = 'todo' | 'in_progress' | 'done';

export interface Board {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: number;
  board_id: number;
  title: string;
  description: string | null;
  status: CardStatus;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One card-movement event as pushed over the realtime activity stream
 * (TASK-005). `card_id` is nullable — the activity record survives its card's
 * deletion (`card_id` FK is `ON DELETE SET NULL`); `card_title` is
 * denormalized specifically so the feed still reads correctly in that case.
 */
export interface CardActivity {
  id: number;
  board_id: number;
  card_id: number | null;
  card_title: string;
  from_status: CardStatus;
  to_status: CardStatus;
  created_at: string;
}

/* ---------------------------------------------------------------------------
 * Workflow automation (TASK-006 / FEAT-006, Phase 4).
 *
 * Wire types for the FROZEN backend rule/webhook contract the Automation tab
 * consumes. As with `Board`/`Card`, timestamp fields arrive as ISO `string`
 * over the wire (the backend domain types use `Date`).
 * ------------------------------------------------------------------------- */

/** A single rule predicate. Frozen to status-equality this iteration. */
export interface RuleCondition {
  field: 'status';
  operator: 'eq';
  value: CardStatus;
}

/** A persisted automation rule, as returned by `GET /rules`. */
export interface AutomationRule {
  id: number;
  board_id: number;
  name: string;
  condition: RuleCondition;
  target_status: CardStatus;
  enabled: boolean;
  /** Absolute `http(s)` URL POSTed on each firing, or `null` when disabled. */
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Whether a rule firing's auto-move applied. */
export type TriggerExecutionStatus = 'executed' | 'failed';

/** One rule firing (auto-move hop), from `GET /trigger-executions`. */
export interface TriggerExecution {
  id: number;
  rule_id: number | null;
  card_id: number | null;
  board_id: number;
  from_status: CardStatus;
  to_status: CardStatus;
  status: TriggerExecutionStatus;
  created_at: string;
}

/** The webhook delivery lifecycle; `delivered`/`exhausted` are terminal. */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'exhausted';

/**
 * The coded failure body the backend serializes into `last_error` and the read
 * route re-projects as `error` on each delivery (AC-ERROR-4). Same coded shape
 * as the rules `CodedError` envelope, but delivery-scoped.
 */
export interface WebhookDeliveryError {
  code: string;
  message: string;
  details: { field: string; error: string }[];
}

/**
 * One webhook attempt-lifecycle record, from `GET /webhook-deliveries`. NOTE:
 * the read route projects `payload`/`last_error` OUT and exposes the parsed
 * coded failure as `error` — so the wire carries `error`, not `last_error`.
 */
export interface WebhookDelivery {
  id: number;
  trigger_execution_id: number;
  rule_id: number | null;
  url: string;
  status: DeliveryStatus;
  attempts: number;
  last_status_code: number | null;
  error: WebhookDeliveryError | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}
