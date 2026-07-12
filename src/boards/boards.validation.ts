import type { CreateBoardInput, UpdateBoardInput } from './boards.types';

/**
 * Hand-rolled validation for board request payloads.
 *
 * No external validation dependency is used (simplicity-first, per the task's
 * design decisions) — the rules here are small and explicit. Validators return
 * a discriminated result so the route layer can turn failures into 400
 * responses without throwing.
 */

/** Maximum length of a board name, matching `boards.name VARCHAR(120)`. */
const NAME_MAX_LENGTH = 120;

/** A single field-level validation failure. */
export interface FieldError {
  field: string;
  message: string;
}

/** Success carries the coerced value; failure carries the field errors. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

/** Push errors for an invalid `name`; a valid name is a non-blank string ≤120 chars. */
function checkName(name: unknown, errors: FieldError[]): void {
  if (typeof name !== 'string') {
    errors.push({ field: 'name', message: 'name must be a string' });
    return;
  }
  if (name.trim().length === 0) {
    errors.push({ field: 'name', message: 'name must not be blank' });
    return;
  }
  if (name.length > NAME_MAX_LENGTH) {
    errors.push({
      field: 'name',
      message: `name must be at most ${NAME_MAX_LENGTH} characters`,
    });
  }
}

/** Push an error for an invalid `description`; it must be a string or null when present. */
function checkDescription(description: unknown, errors: FieldError[]): void {
  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.push({ field: 'description', message: 'description must be a string or null' });
  }
}

/**
 * Validate a `POST /boards` body. `name` is required (non-blank, ≤120 chars);
 * `description` is optional (string or null). The returned name is trimmed.
 */
export function validateCreateBoard(body: unknown): ValidationResult<CreateBoardInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', message: 'request body must be a JSON object' }] };
  }

  const errors: FieldError[] = [];
  checkName(body.name, errors);
  checkDescription(body.description, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: CreateBoardInput = { name: (body.name as string).trim() };
  if (body.description !== undefined) {
    value.description = body.description as string | null;
  }
  return { ok: true, value };
}

/**
 * Validate a `PATCH /boards/:id` body. Every field is optional; a present
 * `name` must be a non-blank string ≤120 chars, and a present `description`
 * must be a string or null (null clears it). An empty object is valid.
 */
export function validateUpdateBoard(body: unknown): ValidationResult<UpdateBoardInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', message: 'request body must be a JSON object' }] };
  }

  const errors: FieldError[] = [];
  if (body.name !== undefined) checkName(body.name, errors);
  checkDescription(body.description, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: UpdateBoardInput = {};
  if (body.name !== undefined) value.name = (body.name as string).trim();
  if (body.description !== undefined) value.description = body.description as string | null;
  return { ok: true, value };
}
