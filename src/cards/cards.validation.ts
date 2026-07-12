import type { CreateCardInput, UpdateCardInput, CardStatus } from './cards.types';

/**
 * Hand-rolled validation for card request payloads.
 *
 * No external validation dependency is used (simplicity-first, per the task's
 * design decisions) — the rules here are small and explicit. Validators return
 * a discriminated result so the route layer can turn failures into 400
 * responses without throwing. Mirrors `boards.validation.ts`.
 */

/** Maximum length of a card title, matching `cards.title VARCHAR(200)`. */
const TITLE_MAX_LENGTH = 200;

/** The permitted `status` values, matching the `cards.status` CHECK constraint. */
const CARD_STATUSES: readonly CardStatus[] = ['todo', 'in_progress', 'done'];

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

/** Push errors for an invalid `title`; a valid title is a non-blank string ≤200 chars. */
function checkTitle(title: unknown, errors: FieldError[]): void {
  if (typeof title !== 'string') {
    errors.push({ field: 'title', message: 'title must be a string' });
    return;
  }
  if (title.trim().length === 0) {
    errors.push({ field: 'title', message: 'title must not be blank' });
    return;
  }
  if (title.length > TITLE_MAX_LENGTH) {
    errors.push({
      field: 'title',
      message: `title must be at most ${TITLE_MAX_LENGTH} characters`,
    });
  }
}

/** Push an error for an invalid `description`; it must be a string or null when present. */
function checkDescription(description: unknown, errors: FieldError[]): void {
  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.push({ field: 'description', message: 'description must be a string or null' });
  }
}

/** Push an error for an invalid `status`; it must be one of the enum values when present. */
function checkStatus(status: unknown, errors: FieldError[]): void {
  if (status === undefined) return;
  if (typeof status !== 'string' || !CARD_STATUSES.includes(status as CardStatus)) {
    errors.push({
      field: 'status',
      message: `status must be one of: ${CARD_STATUSES.join(', ')}`,
    });
  }
}

/**
 * Push an error for an invalid `due_date`; it must be a null, or a string that
 * parses to a real calendar date, when present. Kept lenient (any parseable
 * date string) — the `DATE` column is the source of truth for storage.
 */
function checkDueDate(dueDate: unknown, errors: FieldError[]): void {
  if (dueDate === undefined || dueDate === null) return;
  if (typeof dueDate !== 'string' || Number.isNaN(Date.parse(dueDate))) {
    errors.push({ field: 'due_date', message: 'due_date must be a valid date string or null' });
  }
}

/** Push an error for an invalid `board_id`; a valid board_id is a positive integer. */
function checkBoardId(boardId: unknown, errors: FieldError[]): void {
  if (typeof boardId !== 'number' || !Number.isInteger(boardId) || boardId <= 0) {
    errors.push({ field: 'board_id', message: 'board_id must be a positive integer' });
  }
}

/**
 * Validate a `POST /cards` body. `board_id` (positive integer) and `title`
 * (non-blank, ≤200 chars) are required; `status` (enum), `description`
 * (string|null), and `due_date` (date string|null) are optional. The returned
 * title is trimmed.
 */
export function validateCreateCard(body: unknown): ValidationResult<CreateCardInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', message: 'request body must be a JSON object' }] };
  }

  const errors: FieldError[] = [];
  checkBoardId(body.board_id, errors);
  checkTitle(body.title, errors);
  checkDescription(body.description, errors);
  checkStatus(body.status, errors);
  checkDueDate(body.due_date, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: CreateCardInput = {
    board_id: body.board_id as number,
    title: (body.title as string).trim(),
  };
  if (body.description !== undefined) value.description = body.description as string | null;
  if (body.status !== undefined) value.status = body.status as CardStatus;
  if (body.due_date !== undefined) value.due_date = body.due_date as string | null;
  return { ok: true, value };
}

/**
 * Validate a `PATCH /cards/:id` body. Every field is optional; a present
 * `title`/`description`/`status`/`due_date` must satisfy the same rules as on
 * create. `board_id` is immutable — supplying it is rejected. An empty object
 * is valid.
 */
export function validateUpdateCard(body: unknown): ValidationResult<UpdateCardInput> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: [{ field: 'body', message: 'request body must be a JSON object' }] };
  }

  const errors: FieldError[] = [];
  if (body.board_id !== undefined) {
    errors.push({ field: 'board_id', message: 'board_id cannot be changed after creation' });
  }
  if (body.title !== undefined) checkTitle(body.title, errors);
  checkDescription(body.description, errors);
  checkStatus(body.status, errors);
  checkDueDate(body.due_date, errors);
  if (errors.length > 0) return { ok: false, errors };

  const value: UpdateCardInput = {};
  if (body.title !== undefined) value.title = (body.title as string).trim();
  if (body.description !== undefined) value.description = body.description as string | null;
  if (body.status !== undefined) value.status = body.status as CardStatus;
  if (body.due_date !== undefined) value.due_date = body.due_date as string | null;
  return { ok: true, value };
}
