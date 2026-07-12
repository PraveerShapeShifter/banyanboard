import type { Pool } from 'pg';
import type { Board, CreateBoardInput, UpdateBoardInput } from './boards.types';

/**
 * Data-access contract for boards. The HTTP layer depends on this interface
 * (not the concrete Postgres class) so routes can be tested with an in-memory
 * stub — mirroring how `DbHealthCheck` is injected into the health router.
 */
export interface BoardsRepository {
  create(input: CreateBoardInput): Promise<Board>;
  findAll(): Promise<Board[]>;
  findById(id: number): Promise<Board | null>;
  /** Returns the updated board, or `null` if no board has that id. */
  update(id: number, input: UpdateBoardInput): Promise<Board | null>;
  /** Returns `true` if a row was removed, `false` if the id did not exist. */
  delete(id: number): Promise<boolean>;
}

/** The full column projection, kept identical across every read for a stable row shape. */
const COLUMNS = 'id, name, description, created_at, updated_at';

/** Map a raw `pg` row onto the `Board` domain shape (guards against stray columns). */
function toBoard(r: {
  id: number;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}): Board {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Postgres-backed `BoardsRepository`. All statements are parameterized (never
 * string-interpolated) to stay injection-safe, and mutations use `RETURNING`
 * so a single round-trip both writes and reads back the canonical row.
 */
export class PostgresBoardsRepository implements BoardsRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateBoardInput): Promise<Board> {
    const result = await this.pool.query(
      `INSERT INTO boards (name, description) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [input.name, input.description ?? null],
    );
    return toBoard(result.rows[0]);
  }

  async findAll(): Promise<Board[]> {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM boards ORDER BY id`);
    return result.rows.map(toBoard);
  }

  async findById(id: number): Promise<Board | null> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM boards WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toBoard(result.rows[0]) : null;
  }

  async update(id: number, input: UpdateBoardInput): Promise<Board | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.description !== undefined) {
      params.push(input.description);
      sets.push(`description = $${params.length}`);
    }
    // Always bump the modification timestamp, even for a no-op field set.
    sets.push('updated_at = now()');

    params.push(id);
    const result = await this.pool.query(
      `UPDATE boards SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    return result.rows[0] ? toBoard(result.rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM boards WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
