import { describe, expect, it } from 'vitest';
import {
  mapServerFieldToControl,
  validateName,
  validateRuleForm,
  validateTargetStatus,
  validateWebhookUrl,
} from './rulesValidation';

/**
 * TASK-006 Phase 4: client validation mirrors the backend `rules.validation.ts`
 * field checks so the two surfaces read identically. These assert the EXACT
 * inline strings, the self-loop guard, and that an empty webhook is accepted.
 */

describe('validateName', () => {
  it('rejects a blank name with the exact backend string', () => {
    expect(validateName('   ')).toBe('name must not be blank');
  });

  it('rejects an over-120-char name with the exact backend string', () => {
    expect(validateName('a'.repeat(121))).toBe('name must be at most 120 characters');
  });

  it('accepts a normal name', () => {
    expect(validateName('Auto-done')).toBeUndefined();
  });
});

describe('validateTargetStatus', () => {
  it('rejects a self-loop (target equals condition value)', () => {
    expect(validateTargetStatus('done', 'done')).toBe(
      'a rule cannot move a card to the status it is already in',
    );
  });

  it('accepts a target that differs from the condition value', () => {
    expect(validateTargetStatus('done', 'in_progress')).toBeUndefined();
  });
});

describe('validateWebhookUrl', () => {
  it('accepts an empty string (delivery disabled → null)', () => {
    expect(validateWebhookUrl('')).toBeUndefined();
    expect(validateWebhookUrl('   ')).toBeUndefined();
  });

  it('accepts an absolute https URL', () => {
    expect(validateWebhookUrl('https://example.test/hook')).toBeUndefined();
  });

  it('rejects a non-http(s) / relative URL with the exact backend string', () => {
    expect(validateWebhookUrl('ftp://example.test')).toBe(
      'webhook_url must be an absolute http(s) URL',
    );
    expect(validateWebhookUrl('not-a-url')).toBe('webhook_url must be an absolute http(s) URL');
  });

  it('rejects an over-2048-char URL', () => {
    const long = `https://example.test/${'a'.repeat(2100)}`;
    expect(validateWebhookUrl(long)).toBe('webhook_url must be at most 2048 characters');
  });
});

describe('validateRuleForm', () => {
  it('returns no errors for a valid form', () => {
    expect(
      validateRuleForm({
        name: 'Auto-done',
        conditionValue: 'in_progress',
        target_status: 'done',
        webhook_url: '',
        enabled: true,
      }),
    ).toEqual({});
  });

  it('collects blank-name and self-loop errors together', () => {
    const errors = validateRuleForm({
      name: '',
      conditionValue: 'done',
      target_status: 'done',
      webhook_url: '',
      enabled: true,
    });
    expect(errors.name).toBe('name must not be blank');
    expect(errors.target_status).toBe('a rule cannot move a card to the status it is already in');
  });
});

describe('mapServerFieldToControl', () => {
  it('maps known fields directly', () => {
    expect(mapServerFieldToControl('name')).toBe('name');
    expect(mapServerFieldToControl('target_status')).toBe('target_status');
    expect(mapServerFieldToControl('webhook_url')).toBe('webhook_url');
  });

  it('collapses condition and condition.* onto the condition control', () => {
    expect(mapServerFieldToControl('condition')).toBe('condition');
    expect(mapServerFieldToControl('condition.value')).toBe('condition');
    expect(mapServerFieldToControl('condition.field')).toBe('condition');
  });

  it('returns null for unmapped fields (routed to the banner)', () => {
    expect(mapServerFieldToControl('board_id')).toBeNull();
    expect(mapServerFieldToControl('body')).toBeNull();
  });
});
