import { describe, it, expect } from 'vitest';
import { validateCreateCard, validateUpdateCard } from './cards.validation';

/**
 * Unit tests for the card request validators. These assert the field rules
 * (title required/non-blank/≤200, board_id required positive integer, status
 * restricted to the enum, description/due_date optional + typed, board_id not
 * patchable) independent of the HTTP layer. Mirrors `boards.validation.test.ts`.
 */

describe('validateCreateCard', () => {
  it('accepts a valid payload and trims the title', () => {
    const result = validateCreateCard({
      board_id: 10,
      title: '  Write spec  ',
      description: 'Draft it',
      status: 'in_progress',
      due_date: '2026-08-01',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        board_id: 10,
        title: 'Write spec',
        description: 'Draft it',
        status: 'in_progress',
        due_date: '2026-08-01',
      });
    }
  });

  it('accepts a minimal payload (board_id + title only)', () => {
    const result = validateCreateCard({ board_id: 1, title: 'Minimal' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ board_id: 1, title: 'Minimal' });
      // status default is applied by the repository, not the validator.
      expect(result.value.status).toBeUndefined();
    }
  });

  it('rejects a non-object body', () => {
    expect(validateCreateCard(null).ok).toBe(false);
    expect(validateCreateCard('nope').ok).toBe(false);
    expect(validateCreateCard([]).ok).toBe(false);
  });

  it('rejects a missing or blank title', () => {
    expect(validateCreateCard({ board_id: 1 }).ok).toBe(false);
    expect(validateCreateCard({ board_id: 1, title: '   ' }).ok).toBe(false);
    expect(validateCreateCard({ board_id: 1, title: 123 }).ok).toBe(false);
  });

  it('rejects a title over 200 characters', () => {
    const result = validateCreateCard({ board_id: 1, title: 'a'.repeat(201) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === 'title')).toBe(true);
  });

  it('rejects a missing or non-positive-integer board_id', () => {
    expect(validateCreateCard({ title: 'No board' }).ok).toBe(false);
    expect(validateCreateCard({ board_id: 0, title: 'x' }).ok).toBe(false);
    expect(validateCreateCard({ board_id: -1, title: 'x' }).ok).toBe(false);
    expect(validateCreateCard({ board_id: 1.5, title: 'x' }).ok).toBe(false);
    expect(validateCreateCard({ board_id: '1', title: 'x' }).ok).toBe(false);
  });

  it('rejects a status outside the enum', () => {
    const result = validateCreateCard({ board_id: 1, title: 'x', status: 'archived' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === 'status')).toBe(true);
  });

  it('rejects a non-string, non-null description', () => {
    expect(validateCreateCard({ board_id: 1, title: 'x', description: 5 }).ok).toBe(false);
  });

  it('accepts a null description and a null due_date', () => {
    const result = validateCreateCard({ board_id: 1, title: 'x', description: null, due_date: null });
    expect(result.ok).toBe(true);
  });

  it('rejects an unparseable due_date', () => {
    const result = validateCreateCard({ board_id: 1, title: 'x', due_date: 'not-a-date' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === 'due_date')).toBe(true);
  });
});

describe('validateUpdateCard', () => {
  it('accepts an empty object (no-op update)', () => {
    const result = validateUpdateCard({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('accepts a partial status-only update', () => {
    const result = validateUpdateCard({ status: 'done' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ status: 'done' });
  });

  it('rejects attempting to change board_id (immutable)', () => {
    const result = validateUpdateCard({ board_id: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === 'board_id')).toBe(true);
  });

  it('rejects an invalid field type', () => {
    expect(validateUpdateCard({ title: 123 }).ok).toBe(false);
    expect(validateUpdateCard({ status: 'nope' }).ok).toBe(false);
    expect(validateUpdateCard({ title: '   ' }).ok).toBe(false);
  });

  it('trims a provided title', () => {
    const result = validateUpdateCard({ title: '  Renamed  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.title).toBe('Renamed');
  });
});
