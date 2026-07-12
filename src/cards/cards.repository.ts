import type { Pool } from 'pg';
import type { Card, CreateCardInput, UpdateCardInput } from './cards.types';

/**
 * Data-access contract for cards. The HTTP layer depends on this interface
 * (not the concrete Postgres class) so routes can be tested with an in-memory
 * stub — mirroring `BoardsRepository`.
 */
export interface CardsRepository {
  create(input: CreateCardInput): Promise<Card>;
  /** All cards, or only those on `boardId` when supplied. */
  findAll(boardId?: number): Promise<Card[]>;
  findById(id: number): Promise<Card | null>;
  /** Returns the updated card, or `null` if no card has that id. */
  update(id: number, input: UpdateCardInput): Promise<Card | null>;
  /** Returns `true` if a row was removed, `false` if the id did not exist. */
  delete(id: number): Promise<boolean>;
}

/** The full column projection, kept identical across every read for a stable row shape. */
const COLUMNS = 'id, board_id, title, description, status, due_date, created_at, updated_at';

/** Map a raw `pg` row onto the `Card` domain shape (guards against stray columns). */
function toCard(r: {
  id: number;
  board_id: number;
  title: string;
  description: string | null;
  status: Card['status'];
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
}): Card {
  return {
    id: r.id,
    board_id: r.board_id,
    title: r.title,
    description: r.description,
    status: r.status,
    due_date: r.due_date,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Postgres-backed `CardsRepository`. All statements are parameterized (never
 * string-interpolated) to stay injection-safe, and mutations use `RETURNING`
 * so a single round-trip both writes and reads back the canonical row.
 * Mirrors `PostgresBoardsRepository`.
 */
export class PostgresCardsRepository implements CardsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateCardInput): Promise<Card> {
    const result = await this.pool.query(
      `INSERT INTO cards (board_id, title, description, status, due_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [
        input.board_id,
        input.title,
        input.description ?? null,
        input.status ?? 'todo',
        input.due_date ?? null,
      ],
    );
    return toCard(result.rows[0]);
  }

  async findAll(boardId?: number): Promise<Card[]> {
    if (boardId === undefined) {
      const result = await this.pool.query(`SELECT ${COLUMNS} FROM cards ORDER BY id`);
      return result.rows.map(toCard);
    }
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM cards WHERE board_id = $1 ORDER BY id`,
      [boardId],
    );
    return result.rows.map(toCard);
  }

  async findById(id: number): Promise<Card | null> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM cards WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toCard(result.rows[0]) : null;
  }

  async update(id: number, input: UpdateCardInput): Promise<Card | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) {
      params.push(input.title);
      sets.push(`title = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      sets.push(`description = $${params.length}`);
    }
    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.due_date !== undefined) {
      params.push(input.due_date);
      sets.push(`due_date = $${params.length}`);
    }
    // Always bump the modification timestamp, even for a no-op field set.
    // `board_id` is intentionally never updatable — a card cannot change boards.
    sets.push('updated_at = now()');

    params.push(id);
    const result = await this.pool.query(
      `UPDATE cards SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    return result.rows[0] ? toCard(result.rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM cards WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
