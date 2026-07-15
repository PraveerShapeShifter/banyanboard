import type { CardStatus } from '../../api/types';

/**
 * Client-side rule-form validation (TASK-006 Phase 4). Mirrors the backend
 * `src/rules/rules.validation.ts` field checks so client and server messages
 * read identically — instant inline feedback without a guaranteed-400 round
 * trip, while the server stays authoritative (its coded `details[].field` are
 * still mapped onto the same controls). No validator library (simplicity-first,
 * matching the backend's hand-rolled `checkName`/`checkStatus` style).
 */

/** The permitted card status values (matches the backend enum). */
export const CARD_STATUSES: readonly CardStatus[] = ['todo', 'in_progress', 'done'];

const NAME_MAX_LENGTH = 120;
const WEBHOOK_URL_MAX_LENGTH = 2048;

/** The controls a validation error can attach to (a subset of rule fields). */
export type RuleFormField = 'name' | 'target_status' | 'webhook_url' | 'condition';

/** Inline errors keyed by control; absent key = that control is valid. */
export type RuleFormErrors = Partial<Record<RuleFormField, string>>;

/** The raw, string-oriented form values (as held by the controlled inputs). */
export interface RuleFormValues {
  name: string;
  conditionValue: CardStatus;
  target_status: CardStatus;
  /** Raw text; empty string means "no webhook" (sent as `null`). */
  webhook_url: string;
  enabled: boolean;
}

/** Validate `name`: non-blank, <=120 chars (mirrors backend `checkName`). */
export function validateName(name: string): string | undefined {
  if (name.trim().length === 0) return 'name must not be blank';
  if (name.length > NAME_MAX_LENGTH) {
    return `name must be at most ${NAME_MAX_LENGTH} characters`;
  }
  return undefined;
}

/**
 * Validate `target_status`: within the enum (a backstop — the select already
 * constrains it), and NOT equal to the condition value (self-loop guard, which
 * the backend rejects as an `INVALID_RULE`).
 */
export function validateTargetStatus(
  targetStatus: CardStatus,
  conditionValue: CardStatus,
): string | undefined {
  if (!CARD_STATUSES.includes(targetStatus)) {
    return `target_status must be one of: ${CARD_STATUSES.join(', ')}`;
  }
  if (targetStatus === conditionValue) {
    return 'a rule cannot move a card to the status it is already in';
  }
  return undefined;
}

/**
 * Validate `webhook_url` ONLY when non-empty: absolute `http(s)`, <=2048 chars.
 * An empty string is valid (delivery disabled → sent as `null`).
 */
export function validateWebhookUrl(webhookUrl: string): string | undefined {
  const trimmed = webhookUrl.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return 'webhook_url must be an absolute http(s) URL';
  }
  if (trimmed.length > WEBHOOK_URL_MAX_LENGTH) {
    return `webhook_url must be at most ${WEBHOOK_URL_MAX_LENGTH} characters`;
  }
  return undefined;
}

/** Run every field check; the returned object is empty iff the form is valid. */
export function validateRuleForm(values: RuleFormValues): RuleFormErrors {
  const errors: RuleFormErrors = {};
  const name = validateName(values.name);
  if (name) errors.name = name;
  const target = validateTargetStatus(values.target_status, values.conditionValue);
  if (target) errors.target_status = target;
  const webhook = validateWebhookUrl(values.webhook_url);
  if (webhook) errors.webhook_url = webhook;
  return errors;
}

/**
 * Map a server coded-error `details[].field` onto the form control it belongs
 * to. `condition`/`condition.*` collapse onto the single condition select;
 * unknown fields (`board_id`, `enabled`, `body`, …) return `null` so the caller
 * routes them to the form-level banner instead of a field.
 */
export function mapServerFieldToControl(field: string): RuleFormField | null {
  if (field === 'name') return 'name';
  if (field === 'target_status') return 'target_status';
  if (field === 'webhook_url') return 'webhook_url';
  if (field === 'condition' || field.startsWith('condition.')) return 'condition';
  return null;
}
