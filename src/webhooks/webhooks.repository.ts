import type { Pool } from 'pg';
import type {
  CreateDeliveryInput,
  RecordTriggerExecutionInput,
  TriggerExecution,
  TriggerExecutionFilter,
  UpdateDeliveryInput,
  WebhookDelivery,
  WebhookDeliveryFilter,
} from './webhooks.types';

/**
 * Combined data-access contract for the webhook subsystem's two tightly-coupled
 * tables (`trigger_executions` + `webhook_deliveries`). A single repository per
 * module is the established house style (`ActivityRepository`, `CardsRepository`).
 * The read methods back the routes; the write methods back the Phase 2 engine
 * (on the request path) and Phase 3 dispatcher (off the request path).
 */
export interface WebhooksRepository {
  // --- writes: engine (on the request path) ---
  /** Records one trigger execution (one per rule firing). */
  recordExecution(input: RecordTriggerExecutionInput): Promise<TriggerExecution>;
  /** Creates the initial `pending` delivery row (`attempts:0`). */
  createDelivery(input: CreateDeliveryInput): Promise<WebhookDelivery>;

  // --- writes: dispatcher (off the request path, Phase 3) ---
  /** Applies a partial delivery-lifecycle advance; bumps `updated_at`. */
  updateDelivery(id: number, patch: UpdateDeliveryInput): Promise<WebhookDelivery | null>;
  /** Convenience: terminal success — `delivered`, stamps `delivered_at`. */
  markDelivered(id: number, patch: { attempts: number; last_status_code: number }): Promise<WebhookDelivery | null>;
  /** Convenience: a failed attempt with retries remaining — stays `failed`. */
  markFailed(
    id: number,
    patch: { attempts: number; last_status_code?: number | null; last_error: string },
  ): Promise<WebhookDelivery | null>;
  /** Convenience: terminal failure — `exhausted`. */
  markExhausted(
    id: number,
    patch: { attempts: number; last_status_code?: number | null; last_error: string },
  ): Promise<WebhookDelivery | null>;

  // --- reads: routes ---
  listTriggerExecutions(filter?: TriggerExecutionFilter): Promise<TriggerExecution[]>;
  listDeliveries(filter?: WebhookDeliveryFilter): Promise<WebhookDelivery[]>;
  findDeliveryById(id: number): Promise<WebhookDelivery | null>;

  // --- reads: optional startup re-drive (provisioned, unused at MVP) ---
  /** Non-terminal deliveries (`status IN ('pending','failed')`), `id ASC`, limited. */
  findNonTerminalDeliveries(limit: number): Promise<WebhookDelivery[]>;
}

/** Column projection for `trigger_executions`. */
const EXEC_COLUMNS = 'id, rule_id, card_id, board_id, from_status, to_status, status, created_at';

/**
 * Column projection for `webhook_deliveries`. `payload` is intentionally
 * omitted — it is an audit-only TEXT snapshot never returned on the read path.
 */
const DELIVERY_COLUMNS =
  'id, trigger_execution_id, rule_id, url, status, attempts, last_status_code, last_error, created_at, updated_at, delivered_at';

/** Map a raw `pg` row onto the `TriggerExecution` domain shape. */
function toTriggerExecution(r: {
  id: number;
  rule_id: number | null;
  card_id: number | null;
  board_id: number;
  from_status: TriggerExecution['from_status'];
  to_status: TriggerExecution['to_status'];
  status: TriggerExecution['status'];
  created_at: Date;
}): TriggerExecution {
  return {
    id: r.id,
    rule_id: r.rule_id,
    card_id: r.card_id,
    board_id: r.board_id,
    from_status: r.from_status,
    to_status: r.to_status,
    status: r.status,
    created_at: r.created_at,
  };
}

/** Map a raw `pg` row onto the `WebhookDelivery` domain shape. */
function toWebhookDelivery(r: {
  id: number;
  trigger_execution_id: number;
  rule_id: number | null;
  url: string;
  status: WebhookDelivery['status'];
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  delivered_at: Date | null;
}): WebhookDelivery {
  return {
    id: r.id,
    trigger_execution_id: r.trigger_execution_id,
    rule_id: r.rule_id,
    url: r.url,
    status: r.status,
    attempts: r.attempts,
    last_status_code: r.last_status_code,
    last_error: r.last_error,
    created_at: r.created_at,
    updated_at: r.updated_at,
    delivered_at: r.delivered_at,
  };
}

/**
 * Postgres-backed `WebhooksRepository`. All statements are parameterized (never
 * string-interpolated); mutations use `RETURNING` for a single write+read-back
 * round-trip. Reads are `id`-ordered (identity PK doubles as the natural
 * ordering, mirroring the activity module). Mirrors `PostgresCardsRepository`.
 */
export class PostgresWebhooksRepository implements WebhooksRepository {
  constructor(private readonly pool: Pool) {}

  async recordExecution(input: RecordTriggerExecutionInput): Promise<TriggerExecution> {
    const result = await this.pool.query(
      `INSERT INTO trigger_executions (rule_id, card_id, board_id, from_status, to_status, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${EXEC_COLUMNS}`,
      [input.rule_id, input.card_id, input.board_id, input.from_status, input.to_status, input.status],
    );
    return toTriggerExecution(result.rows[0]);
  }

  async createDelivery(input: CreateDeliveryInput): Promise<WebhookDelivery> {
    const result = await this.pool.query(
      `INSERT INTO webhook_deliveries (trigger_execution_id, rule_id, url, payload)
       VALUES ($1, $2, $3, $4) RETURNING ${DELIVERY_COLUMNS}`,
      [input.trigger_execution_id, input.rule_id, input.url, input.payload],
    );
    return toWebhookDelivery(result.rows[0]);
  }

  async updateDelivery(id: number, patch: UpdateDeliveryInput): Promise<WebhookDelivery | null> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.attempts !== undefined) {
      params.push(patch.attempts);
      sets.push(`attempts = $${params.length}`);
    }
    if (patch.last_status_code !== undefined) {
      params.push(patch.last_status_code);
      sets.push(`last_status_code = $${params.length}`);
    }
    if (patch.last_error !== undefined) {
      params.push(patch.last_error);
      sets.push(`last_error = $${params.length}`);
    }
    if (patch.delivered_at !== undefined) {
      params.push(patch.delivered_at);
      sets.push(`delivered_at = $${params.length}`);
    }
    // Always bump the modification timestamp, even for a no-op field set.
    sets.push('updated_at = now()');

    params.push(id);
    const result = await this.pool.query(
      `UPDATE webhook_deliveries SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${DELIVERY_COLUMNS}`,
      params,
    );
    return result.rows[0] ? toWebhookDelivery(result.rows[0]) : null;
  }

  async markDelivered(
    id: number,
    patch: { attempts: number; last_status_code: number },
  ): Promise<WebhookDelivery | null> {
    return this.updateDelivery(id, {
      status: 'delivered',
      attempts: patch.attempts,
      last_status_code: patch.last_status_code,
      delivered_at: new Date(),
    });
  }

  async markFailed(
    id: number,
    patch: { attempts: number; last_status_code?: number | null; last_error: string },
  ): Promise<WebhookDelivery | null> {
    return this.updateDelivery(id, {
      status: 'failed',
      attempts: patch.attempts,
      last_status_code: patch.last_status_code ?? null,
      last_error: patch.last_error,
    });
  }

  async markExhausted(
    id: number,
    patch: { attempts: number; last_status_code?: number | null; last_error: string },
  ): Promise<WebhookDelivery | null> {
    return this.updateDelivery(id, {
      status: 'exhausted',
      attempts: patch.attempts,
      last_status_code: patch.last_status_code ?? null,
      last_error: patch.last_error,
    });
  }

  async listTriggerExecutions(filter: TriggerExecutionFilter = {}): Promise<TriggerExecution[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.board_id !== undefined) {
      params.push(filter.board_id);
      conditions.push(`board_id = $${params.length}`);
    }
    if (filter.rule_id !== undefined) {
      params.push(filter.rule_id);
      conditions.push(`rule_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT ${EXEC_COLUMNS} FROM trigger_executions${where} ORDER BY id DESC`,
      params,
    );
    return result.rows.map(toTriggerExecution);
  }

  async listDeliveries(filter: WebhookDeliveryFilter = {}): Promise<WebhookDelivery[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.rule_id !== undefined) {
      params.push(filter.rule_id);
      conditions.push(`rule_id = $${params.length}`);
    }
    if (filter.trigger_execution_id !== undefined) {
      params.push(filter.trigger_execution_id);
      conditions.push(`trigger_execution_id = $${params.length}`);
    }
    if (filter.status !== undefined) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT ${DELIVERY_COLUMNS} FROM webhook_deliveries${where} ORDER BY id DESC`,
      params,
    );
    return result.rows.map(toWebhookDelivery);
  }

  async findDeliveryById(id: number): Promise<WebhookDelivery | null> {
    const result = await this.pool.query(
      `SELECT ${DELIVERY_COLUMNS} FROM webhook_deliveries WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toWebhookDelivery(result.rows[0]) : null;
  }

  async findNonTerminalDeliveries(limit: number): Promise<WebhookDelivery[]> {
    const result = await this.pool.query(
      `SELECT ${DELIVERY_COLUMNS} FROM webhook_deliveries
       WHERE status IN ('pending', 'failed') ORDER BY id ASC LIMIT $1`,
      [limit],
    );
    return result.rows.map(toWebhookDelivery);
  }
}
