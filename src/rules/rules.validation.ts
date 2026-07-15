import type { CardStatus } from '../cards/cards.types';
import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  type CreateRuleInput,
  type RuleCondition,
  type UpdateRuleInput,
} from './rules.types';

/**
 * Hand-rolled validation for automation-rule request payloads.
 *
 * No external validation dependency is used (simplicity-first, per the frozen
 * design decisions) — the field checks mirror `cards.validation.ts`
 * (`checkTitle`/`checkStatus` style). Only the ENVELOPE differs: the rules
 * module returns a coded `{ code:'INVALID_RULE', message, details:[{field,error}] }`
 * body (the route builds it from these `RuleFieldError[]`), a deliberate
 * cross-cutting divergence from the `{error,details:[{field,message}]}` shape
 * the rest of the codebase uses — see the Error Code Catalog in TASK-006.
 */

/** Maximum length of a rule name, matching `automation_rules.name VARCHAR(120)`. */
const NAME_MAX_LENGTH = 120;

/** Maximum length of a webhook URL, matching `automation_rules.webhook_url VARCHAR(2048)`. */
const WEBHOOK_URL_MAX_LENGTH = 2048;

/** The permitted card status values, matching the `target_status`/`condition_value` CHECKs. */
const CARD_STATUSES: readonly CardStatus[] = ['todo', 'in_progress', 'done'];

/** A single field-level validation failure (coded-envelope shape: `error`, not `message`). */
export interface RuleFieldError {
  field: string;
  error: string;
}

/** Success carries the coerced value; failure carries the field errors. */
export type RuleValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: RuleFieldError[] };

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Push errors for an invalid `name`; a valid name is a non-blank string <=120 chars. */
function checkName(name: unknown, errors: RuleFieldError[]): void {
  if (typeof name !== 'string') {
    errors.push({ field: 'name', error: 'name must be a string' });
    return;
  }
  if (name.trim().length === 0) {
    errors.push({ field: 'name', error: 'name must not be blank' });
    return;
  }
  if (name.length > NAME_MAX_LENGTH) {
    errors.push({ field: 'name', error: `name must be at most ${NAME_MAX_LENGTH} characters` });
  }
}

/** Push an error for an invalid `board_id` (POST only); a valid board_id is a positive integer. */
function checkBoardId(boardId: unknown, errors: RuleFieldError[]): void {
  if (typeof boardId !== 'number' || !Number.isInteger(boardId) || boardId <= 0) {
    errors.push({ field: 'board_id', error: 'board_id must be a positive integer' });
  }
}

/**
 * Validate a defined `condition` object shape. Emits `condition.field`/
 * `condition.operator`/`condition.value` field errors per the frozen model
 * (`field IN ('status')`, `operator IN ('eq')`, `value IN CARD_STATUSES`).
 */
function checkConditionShape(condition: unknown, errors: RuleFieldError[]): void {
  if (!isPlainObject(condition)) {
    errors.push({ field: 'condition', error: 'condition must be a valid rule condition' });
    return;
  }
  const field = condition.field;
  if (typeof field !== 'string' || !CONDITION_FIELDS.includes(field as never)) {
    errors.push({
      field: 'condition.field',
      error: `condition.field must be one of: ${CONDITION_FIELDS.join(', ')}`,
    });
  }
  const operator = condition.operator;
  if (typeof operator !== 'string' || !CONDITION_OPERATORS.includes(operator as never)) {
    errors.push({
      field: 'condition.operator',
      error: `condition.operator must be one of: ${CONDITION_OPERATORS.join(', ')}`,
    });
  }
  const value = condition.value;
  if (typeof value !== 'string' || !CARD_STATUSES.includes(value as CardStatus)) {
    errors.push({
      field: 'condition.value',
      error: `condition.value must be one of: ${CARD_STATUSES.join(', ')}`,
    });
  }
}

/** Push an error for an invalid `target_status`; it must be one of the enum values. */
function checkTargetStatus(targetStatus: unknown, errors: RuleFieldError[]): void {
  if (typeof targetStatus !== 'string' || !CARD_STATUSES.includes(targetStatus as CardStatus)) {
    errors.push({
      field: 'target_status',
      error: `target_status must be one of: ${CARD_STATUSES.join(', ')}`,
    });
  }
}

/** Push an error for a non-boolean `enabled` when present. */
function checkEnabled(enabled: unknown, errors: RuleFieldError[]): void {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    errors.push({ field: 'enabled', error: 'enabled must be a boolean' });
  }
}

/**
 * Push an error for an invalid `webhook_url` when present. `null`/omitted is
 * valid (delivery disabled). Otherwise it must be a string that parses as an
 * absolute `http(s)` URL and is <=2048 chars. This is the SSRF enforcement
 * point (frozen decision: `http(s)`-only; private/loopback ranges NOT blocked).
 */
function checkWebhookUrl(url: unknown, errors: RuleFieldError[]): void {
  if (url === undefined || url === null) return;
  if (typeof url !== 'string') {
    errors.push({ field: 'webhook_url', error: 'webhook_url must be a string' });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    errors.push({ field: 'webhook_url', error: 'webhook_url must be an absolute http(s) URL' });
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push({ field: 'webhook_url', error: 'webhook_url must be an absolute http(s) URL' });
    return;
  }
  if (url.length > WEBHOOK_URL_MAX_LENGTH) {
    errors.push({
      field: 'webhook_url',
      error: `webhook_url must be at most ${WEBHOOK_URL_MAX_LENGTH} characters`,
    });
  }
}

/**
 * Push a self-loop error when a well-formed condition matches the same status
 * the rule moves the card TO (`condition.value === target_status`) — a rule
 * that moves a card to the status it matches would spin. Only fires when both
 * values are present and valid statuses, so it never masks a shape error.
 */
function checkSelfLoop(condition: unknown, targetStatus: unknown, errors: RuleFieldError[]): void {
  if (
    isPlainObject(condition) &&
    typeof condition.value === 'string' &&
    CARD_STATUSES.includes(condition.value as CardStatus) &&
    typeof targetStatus === 'string' &&
    CARD_STATUSES.includes(targetStatus as CardStatus) &&
    condition.value === targetStatus
  ) {
    errors.push({
      field: 'target_status',
      error:
        'target_status must differ from condition.value (a rule cannot move a card to the status it matches)',
    });
  }
}

/** Build the coerced nested `RuleCondition` from an already-validated body condition. */
function toCondition(raw: Record<string, unknown>): RuleCondition {
  return {
    field: raw.field as RuleCondition['field'],
    operator: raw.operator as RuleCondition['operator'],
    value: raw.value as CardStatus,
  };
}

/**
 * Validate a `POST /rules` body. `board_id` (positive integer), `name`
 * (non-blank, <=120 chars), `condition` (valid `{field,operator,value}`), and
 * `target_status` (enum) are required; `enabled` (boolean) and `webhook_url`
 * (absolute http(s) URL or null) are optional. The returned name is trimmed.
 */
export function validateCreateRule(body: unknown): RuleValidationResult<CreateRuleInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', error: 'request body must be a JSON object' }] };
  }

  const errors: RuleFieldError[] = [];
  checkName(body.name, errors);
  checkBoardId(body.board_id, errors);
  if (body.condition === undefined) {
    errors.push({ field: 'condition', error: 'condition is required' });
  } else {
    checkConditionShape(body.condition, errors);
  }
  checkTargetStatus(body.target_status, errors);
  checkEnabled(body.enabled, errors);
  checkWebhookUrl(body.webhook_url, errors);
  checkSelfLoop(body.condition, body.target_status, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: CreateRuleInput = {
    board_id: body.board_id as number,
    name: (body.name as string).trim(),
    condition: toCondition(body.condition as Record<string, unknown>),
    target_status: body.target_status as CardStatus,
  };
  if (body.enabled !== undefined) value.enabled = body.enabled as boolean;
  if (body.webhook_url !== undefined) value.webhook_url = body.webhook_url as string | null;
  return { ok: true, value };
}

/**
 * Validate a `PATCH /rules/:id` body. Every field is optional; a present
 * `name`/`condition`/`target_status`/`enabled`/`webhook_url` must satisfy the
 * same rules as on create. `board_id` is immutable — supplying it is rejected.
 * An empty object is valid.
 */
export function validateUpdateRule(body: unknown): RuleValidationResult<UpdateRuleInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', error: 'request body must be a JSON object' }] };
  }

  const errors: RuleFieldError[] = [];
  if (body.board_id !== undefined) {
    errors.push({ field: 'board_id', error: 'board_id cannot be changed after creation' });
  }
  if (body.name !== undefined) checkName(body.name, errors);
  if (body.condition !== undefined) checkConditionShape(body.condition, errors);
  if (body.target_status !== undefined) checkTargetStatus(body.target_status, errors);
  checkEnabled(body.enabled, errors);
  checkWebhookUrl(body.webhook_url, errors);
  checkSelfLoop(body.condition, body.target_status, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: UpdateRuleInput = {};
  if (body.name !== undefined) value.name = (body.name as string).trim();
  if (body.condition !== undefined) value.condition = toCondition(body.condition as Record<string, unknown>);
  if (body.target_status !== undefined) value.target_status = body.target_status as CardStatus;
  if (body.enabled !== undefined) value.enabled = body.enabled as boolean;
  if (body.webhook_url !== undefined) value.webhook_url = body.webhook_url as string | null;
  return { ok: true, value };
}
