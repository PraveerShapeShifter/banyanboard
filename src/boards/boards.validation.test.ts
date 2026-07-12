import { describe, it, expect } from 'vitest';
import { validateCreateBoard, validateUpdateBoard } from './boards.validation';

/**
 * Unit tests for the hand-rolled board payload validators (no external
 * validation dependency — simplicity-first per the task's design decisions).
 * The route layer relies on these to produce the 400 responses in AC-ERROR-2.
 */

describe('validateCreateBoard', () => {
  it('accepts a valid name-only payload and trims the name', () => {
    const result = validateCreateBoard({ name: '  Sprint Board  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Sprint Board' });
  });

  it('accepts name + description', () => {
    const result = validateCreateBoard({ name: 'B', description: 'desc' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'B', description: 'desc' });
  });

  it('rejects a missing name', () => {
    const result = validateCreateBoard({ description: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].field).toBe('name');
  });

  it('rejects a blank (whitespace-only) name', () => {
    expect(validateCreateBoard({ name: '   ' }).ok).toBe(false);
  });

  it('rejects a name longer than 120 characters', () => {
    expect(validateCreateBoard({ name: 'a'.repeat(121) }).ok).toBe(false);
  });

  it('rejects a non-string name', () => {
    expect(validateCreateBoard({ name: 123 }).ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateCreateBoard(null).ok).toBe(false);
    expect(validateCreateBoard('nope').ok).toBe(false);
    expect(validateCreateBoard([]).ok).toBe(false);
  });

  it('rejects a non-string, non-null description', () => {
    expect(validateCreateBoard({ name: 'B', description: 5 }).ok).toBe(false);
  });
});

describe('validateUpdateBoard', () => {
  it('accepts an empty object (bumps updated_at only)', () => {
    const result = validateUpdateBoard({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('accepts a partial name update', () => {
    const result = validateUpdateBoard({ name: 'Renamed' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: 'Renamed' });
  });

  it('accepts clearing the description with null', () => {
    const result = validateUpdateBoard({ description: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ description: null });
  });

  it('rejects an invalid name type', () => {
    expect(validateUpdateBoard({ name: 123 }).ok).toBe(false);
  });

  it('rejects a blank name when name is present', () => {
    expect(validateUpdateBoard({ name: '  ' }).ok).toBe(false);
  });
});
