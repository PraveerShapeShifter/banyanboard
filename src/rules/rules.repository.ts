import type { Pool } from 'pg';
import type { AutomationRule, CreateRuleInput, UpdateRuleInput } from './rules.types';

/**
 * Data-access contract for automation rules. The HTTP layer and the (Phase 2)
 * evaluation engine depend on this interface (not the concrete Postgres class)
 * so both are testable with an in-memory stub — mirroring `CardsRepository`.
 */
export interface RulesRepository {
  create(input: CreateRuleInput): Promise<AutomationRule>;
  /** All rules, or only those on `boardId` when supplied. */
  findByBoard(boardId?: number): Promise<AutomationRule[]>;
  findById(id: number): Promise<AutomationRule | null>;
  /**
   * Applies a partial update and returns the updated rule, or `null` if no rule
   * has that id. `board_id` is intentionally never updatable — a rule cannot
   * change boards (mirrors `cards.update` immutability of `board_id`).
   */
  update(id: number, input: UpdateRuleInput): Promise<AutomationRule | null>;
  /** Returns `true` if a row was removed, `false` if the id did not exist. */
  delete(id: number): Promise<boolean>;
  /**
   * The board's ENABLED rules, ordered `id ASC` — the engine's single per-pass
   * read (Phase 2). `id ASC` fixes the frozen first-match-wins-by-lowest-id
   * policy for ambiguous multi-rule matches.
   */
  findEnabledByBoard(boardId: number): Promise<AutomationRule[]>;
}

/** The full column projection, kept identical across every read for a stable row shape. */
const COLUMNS =
  'id, board_id, name, condition_field, condition_operator, condition_value, target_status, enabled, webhook_url, created_at, updated_at';

/**
 * Map a raw `pg` row onto the `AutomationRule` domain shape, folding the flat
 * `condition_*` columns into the nested `condition` object (the wire contract).
 * Mirrors `toCard()`/`toActivity()`.
 */
function toRule(r: {
  id: number;
  board_id: number;
  name: string;
  condition_field: AutomationRule['condition']['field'];
  condition_operator: AutomationRule['condition']['operator'];
  condition_value: AutomationRule['condition']['value'];
  target_status: AutomationRule['target_status'];
  enabled: boolean;
  webhook_url: string | null;
  created_at: Date;
  updated_at: Date;
}): AutomationRule {
  return {
    id: r.id,
    board_id: r.board_id,
    name: r.name,
    condition: {
      field: r.condition_field,
      operator: r.condition_operator,
      value: r.condition_value,
    },
    target_status: r.target_status,
    enabled: r.enabled,
    webhook_url: r.webhook_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Postgres-backed `RulesRepository`. All statements are parameterized (never
 * string-interpolated) to stay injection-safe, and mutations use `RETURNING`
 * so a single round-trip both writes and reads back the canonical row.
 * Mirrors `PostgresCardsRepository`.
 */
export class PostgresRulesRepository implements RulesRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateRuleInput): Promise<AutomationRule> {
    const result = await this.pool.query(
      `INSERT INTO automation_rules
         (board_id, name, condition_field, condition_operator, condition_value, target_status, enabled, webhook_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [
        input.board_id,
        input.name,
        input.condition.field,
        input.condition.operator,
        input.condition.value,
        input.target_status,
        input.enabled ?? true,
        input.webhook_url ?? null,
      ],
    );
    return toRule(result.rows[0]);
  }

  async findByBoard(boardId?: number): Promise<AutomationRule[]> {
    if (boardId === undefined) {
      const result = await this.pool.query(`SELECT ${COLUMNS} FROM automation_rules ORDER BY id`);
      return result.rows.map(toRule);
    }
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM automation_rules WHERE board_id = $1 ORDER BY id`,
      [boardId],
    );
    return result.rows.map(toRule);
  }

  async findById(id: number): Promise<AutomationRule | null> {
    const result = await this.pool.query(`SELECT ${COLUMNS} FROM automation_rules WHERE id = $1`, [id]);
    return result.rows[0] ? toRule(result.rows[0]) : null;
  }

  async update(id: number, input: UpdateRuleInput): Promise<AutomationRule | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) {
      params.push(input.name);
      sets.push(`name = $${params.length}`);
    }
    if (input.condition !== undefined) {
      params.push(input.condition.field);
      sets.push(`condition_field = $${params.length}`);
      params.push(input.condition.operator);
      sets.push(`condition_operator = $${params.length}`);
      params.push(input.condition.value);
      sets.push(`condition_value = $${params.length}`);
    }
    if (input.target_status !== undefined) {
      params.push(input.target_status);
      sets.push(`target_status = $${params.length}`);
    }
    if (input.enabled !== undefined) {
      params.push(input.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (input.webhook_url !== undefined) {
      params.push(input.webhook_url);
      sets.push(`webhook_url = $${params.length}`);
    }
    // Always bump the modification timestamp, even for a no-op field set.
    // `board_id` is intentionally never updatable — a rule cannot change boards.
    sets.push('updated_at = now()');

    params.push(id);
    const result = await this.pool.query(
      `UPDATE automation_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    return result.rows[0] ? toRule(result.rows[0]) : null;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM automation_rules WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async findEnabledByBoard(boardId: number): Promise<AutomationRule[]> {
    const result = await this.pool.query(
      `SELECT ${COLUMNS} FROM automation_rules WHERE board_id = $1 AND enabled = true ORDER BY id ASC`,
      [boardId],
    );
    return result.rows.map(toRule);
  }
}
