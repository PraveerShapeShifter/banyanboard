/**
 * Board domain model and input shapes.
 *
 * A Board is the top-level container in BanyanBoard. This module holds only the
 * data shapes — the HTTP layer (`boards.routes.ts`) and data-access layer
 * (`boards.repository.ts`) depend on these types but not on each other's
 * concrete implementations.
 */

/** A persisted board, as returned by the repository. */
export interface Board {
  id: number;
  name: string;
  description: string | null;
  /** Set once on insert. Postgres `TIMESTAMPTZ`, surfaced as a JS `Date`. */
  created_at: Date;
  /** Bumped on every successful update. */
  updated_at: Date;
}

/** Fields accepted when creating a board. `description` is optional. */
export interface CreateBoardInput {
  name: string;
  description?: string | null;
}

/**
 * Fields accepted when partially updating a board. Every field is optional;
 * an omitted field is left unchanged. A `description` of `null` explicitly
 * clears it.
 */
export interface UpdateBoardInput {
  name?: string;
  description?: string | null;
}
