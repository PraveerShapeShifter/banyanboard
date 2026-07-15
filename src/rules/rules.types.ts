/**
 * Automation-rule domain model and input shapes (FEAT-006 / TASK-006).
 *
 * An `AutomationRule` is a board-scoped `condition -> target_status` mapping.
 * This module holds only the data shapes — the HTTP layer (`rules.routes.ts`),
 * data-access layer (`rules.repository.ts`), and (Phase 2) evaluation engine
 * depend on these types but not on each other's concrete implementations.
 * Mirrors `cards.types.ts`.
 */

import type { CardStatus } from '../cards/cards.types';

/**
 * The card fields eligible in a rule condition. Frozen to `'status'` this
 * iteration (the only field whose change is the auto-move trigger in every AC);
 * modeled as a single-value union so it can be widened additively later.
 * Persisted as `automation_rules.condition_field` (CHECK-constrained).
 */
export type ConditionField = 'status';

/**
 * The operators a rule condition supports. Frozen to `'eq'` (equality is
 * sufficient for status matching); widenable later. Persisted as
 * `automation_rules.condition_operator` (CHECK-constrained).
 */
export type ConditionOperator = 'eq';

/** The permitted `condition.field` values, matching the CHECK constraint. */
export const CONDITION_FIELDS: readonly ConditionField[] = ['status'];

/** The permitted `condition.operator` values, matching the CHECK constraint. */
export const CONDITION_OPERATORS: readonly ConditionOperator[] = ['eq'];

/**
 * A single rule predicate. The canonical (frozen) model is
 * `{ field: 'status', operator: 'eq', value: <CardStatus> }`; a rule matches a
 * card iff `card[field] === value` (i.e. `card.status === condition.value`).
 * Exposed on the wire as a nested object; persisted as three flat
 * `condition_*` columns the repository folds together via `toRule()`.
 */
export interface RuleCondition {
  field: ConditionField;
  operator: ConditionOperator;
  value: CardStatus;
}

/** A persisted automation rule, as returned by the repository. */
export interface AutomationRule {
  id: number;
  /** FK to `boards.id`. `ON DELETE CASCADE`. Immutable after creation. */
  board_id: number;
  name: string;
  condition: RuleCondition;
  /** The status a matched rule moves the card to (reuses the `CardStatus` enum). */
  target_status: CardStatus;
  enabled: boolean;
  /** Absolute `http(s)` URL to POST on each firing, or `null` to disable delivery. */
  webhook_url: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Fields accepted when creating a rule. `board_id`, `name`, `condition`, and
 * `target_status` are required; `enabled` defaults to `true` when omitted;
 * `webhook_url` is optional (nullable — `null`/omitted disables delivery).
 */
export interface CreateRuleInput {
  board_id: number;
  name: string;
  condition: RuleCondition;
  target_status: CardStatus;
  enabled?: boolean;
  webhook_url?: string | null;
}

/**
 * Fields accepted when partially updating a rule. Every field is optional; an
 * omitted field is left unchanged. `board_id` is intentionally absent — a rule
 * cannot be moved to a different board (mirrors `UpdateCardInput`). A
 * `webhook_url` of `null` explicitly disables delivery.
 */
export interface UpdateRuleInput {
  name?: string;
  condition?: RuleCondition;
  target_status?: CardStatus;
  enabled?: boolean;
  webhook_url?: string | null;
}
