import { describe, it, expect } from 'vitest';
import { validateCreateRule, validateUpdateRule } from './rules.validation';

/**
 * Unit tests for the automation-rule validators (AC-ERROR-2). These assert the
 * EXACT field-level `error` strings from the Error Code Catalog (name, board_id,
 * target_status, enabled, webhook_url, condition shape, self-loop) independent
 * of the HTTP layer. The route layer wraps these `RuleFieldError[]` in the coded
 * `INVALID_RULE` envelope. Mirrors `cards.validation.test.ts`.
 */

/** A valid create body used as the base for negative variations. */
const valid = () => ({
  board_id: 10,
  name: 'Auto-done',
  condition: { field: 'status', operator: 'eq', value: 'in_progress' },
  target_status: 'done',
});

/** Find the first error for a field, or undefined. */
function errFor(result: ReturnType<typeof validateCreateRule>, field: string): string | undefined {
  if (result.ok) return undefined;
  return result.errors.find((e) => e.field === field)?.error;
}

describe('validateCreateRule', () => {
  it('accepts a valid payload and trims the name', () => {
    const result = validateCreateRule({ ...valid(), name: '  Auto-done  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        board_id: 10,
        name: 'Auto-done',
        condition: { field: 'status', operator: 'eq', value: 'in_progress' },
        target_status: 'done',
      });
      expect(result.value.enabled).toBeUndefined();
      expect(result.value.webhook_url).toBeUndefined();
    }
  });

  it('accepts an explicit enabled flag and a valid absolute https webhook_url', () => {
    const result = validateCreateRule({
      ...valid(),
      enabled: false,
      webhook_url: 'https://hooks.example.com/abc',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
      expect(result.value.webhook_url).toBe('https://hooks.example.com/abc');
    }
  });

  it('accepts a null webhook_url (delivery disabled)', () => {
    const result = validateCreateRule({ ...valid(), webhook_url: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.webhook_url).toBeNull();
  });

  it('rejects a non-object body with the exact message', () => {
    const result = validateCreateRule(null);
    expect(result.ok).toBe(false);
    expect(errFor(result, 'body')).toBe('request body must be a JSON object');
  });

  it('rejects name that is not a string / blank / oversized with exact messages', () => {
    expect(errFor(validateCreateRule({ ...valid(), name: 123 }), 'name')).toBe('name must be a string');
    expect(errFor(validateCreateRule({ ...valid(), name: '   ' }), 'name')).toBe('name must not be blank');
    expect(errFor(validateCreateRule({ ...valid(), name: 'a'.repeat(121) }), 'name')).toBe(
      'name must be at most 120 characters',
    );
  });

  it('rejects a bad board_id (POST positive-integer rule) with the exact message', () => {
    expect(errFor(validateCreateRule({ ...valid(), board_id: 0 }), 'board_id')).toBe(
      'board_id must be a positive integer',
    );
    expect(errFor(validateCreateRule({ ...valid(), board_id: -1 }), 'board_id')).toBe(
      'board_id must be a positive integer',
    );
    expect(errFor(validateCreateRule({ ...valid(), board_id: 1.5 }), 'board_id')).toBe(
      'board_id must be a positive integer',
    );
    expect(errFor(validateCreateRule({ ...valid(), board_id: '1' }), 'board_id')).toBe(
      'board_id must be a positive integer',
    );
  });

  it('rejects a target_status outside the enum with the exact message', () => {
    expect(errFor(validateCreateRule({ ...valid(), target_status: 'archived' }), 'target_status')).toBe(
      'target_status must be one of: todo, in_progress, done',
    );
    // Missing target_status is also rejected on the same field.
    const noTarget = valid() as Record<string, unknown>;
    delete noTarget.target_status;
    expect(errFor(validateCreateRule(noTarget), 'target_status')).toBe(
      'target_status must be one of: todo, in_progress, done',
    );
  });

  it('rejects a non-boolean enabled with the exact message', () => {
    expect(errFor(validateCreateRule({ ...valid(), enabled: 'yes' }), 'enabled')).toBe(
      'enabled must be a boolean',
    );
  });

  it('rejects webhook_url that is not a string / bad scheme / over-length with exact messages', () => {
    expect(errFor(validateCreateRule({ ...valid(), webhook_url: 42 }), 'webhook_url')).toBe(
      'webhook_url must be a string',
    );
    expect(errFor(validateCreateRule({ ...valid(), webhook_url: 'ftp://x.com' }), 'webhook_url')).toBe(
      'webhook_url must be an absolute http(s) URL',
    );
    expect(errFor(validateCreateRule({ ...valid(), webhook_url: '/relative/path' }), 'webhook_url')).toBe(
      'webhook_url must be an absolute http(s) URL',
    );
    const longUrl = `https://x.com/${'a'.repeat(2048)}`;
    expect(errFor(validateCreateRule({ ...valid(), webhook_url: longUrl }), 'webhook_url')).toBe(
      'webhook_url must be at most 2048 characters',
    );
  });

  it('rejects a missing condition with "condition is required"', () => {
    const noCond = valid() as Record<string, unknown>;
    delete noCond.condition;
    expect(errFor(validateCreateRule(noCond), 'condition')).toBe('condition is required');
  });

  it('rejects a non-object condition with "condition must be a valid rule condition"', () => {
    expect(errFor(validateCreateRule({ ...valid(), condition: 'nope' }), 'condition')).toBe(
      'condition must be a valid rule condition',
    );
  });

  it('rejects bad condition.field / condition.operator / condition.value with exact messages', () => {
    expect(
      errFor(validateCreateRule({ ...valid(), condition: { field: 'title', operator: 'eq', value: 'done' } }), 'condition.field'),
    ).toBe('condition.field must be one of: status');
    expect(
      errFor(validateCreateRule({ ...valid(), condition: { field: 'status', operator: 'gt', value: 'todo' } }), 'condition.operator'),
    ).toBe('condition.operator must be one of: eq');
    expect(
      errFor(validateCreateRule({ ...valid(), condition: { field: 'status', operator: 'eq', value: 'archived' } }), 'condition.value'),
    ).toBe('condition.value must be one of: todo, in_progress, done');
  });

  it('rejects a self-loop (condition.value === target_status) on the target_status field', () => {
    const result = validateCreateRule({
      board_id: 10,
      name: 'Loop',
      condition: { field: 'status', operator: 'eq', value: 'done' },
      target_status: 'done',
    });
    expect(result.ok).toBe(false);
    expect(errFor(result, 'target_status')).toBe(
      'target_status must differ from condition.value (a rule cannot move a card to the status it matches)',
    );
  });
});

describe('validateUpdateRule', () => {
  it('accepts an empty object (no-op update)', () => {
    const result = validateUpdateRule({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('accepts a partial enabled-only update', () => {
    const result = validateUpdateRule({ enabled: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ enabled: false });
  });

  it('accepts setting webhook_url to null (disable delivery)', () => {
    const result = validateUpdateRule({ webhook_url: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.webhook_url).toBeNull();
  });

  it('rejects attempting to change board_id (immutable) with the exact message', () => {
    const result = validateUpdateRule({ board_id: 99 });
    expect(result.ok).toBe(false);
    expect(errFor(result, 'board_id')).toBe('board_id cannot be changed after creation');
  });

  it('validates a present condition with the same shape rules as create', () => {
    const result = validateUpdateRule({ condition: { field: 'status', operator: 'eq', value: 'nope' } });
    expect(result.ok).toBe(false);
    expect(errFor(result, 'condition.value')).toBe('condition.value must be one of: todo, in_progress, done');
  });

  it('rejects a self-loop when both condition and target_status are supplied together', () => {
    const result = validateUpdateRule({
      condition: { field: 'status', operator: 'eq', value: 'todo' },
      target_status: 'todo',
    });
    expect(result.ok).toBe(false);
    expect(errFor(result, 'target_status')).toBe(
      'target_status must differ from condition.value (a rule cannot move a card to the status it matches)',
    );
  });

  it('trims a provided name', () => {
    const result = validateUpdateRule({ name: '  Renamed  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe('Renamed');
  });
});
