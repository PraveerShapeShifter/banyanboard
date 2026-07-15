import 'dotenv/config';

/**
 * Application configuration, sourced entirely from environment variables
 * (12-factor). No values are hardcoded in application code.
 */
export interface Env {
  port: number;
  databaseUrl: string;
  logLevel: string;
  /** Max events returned by a single activity backfill/replay read (TASK-005). */
  activityBackfillLimit: number;
  /** Interval, in ms, between SSE `: keep-alive` frames on the activity stream (TASK-005). */
  activityHeartbeatMs: number;
  /** Per-attempt webhook `AbortController` timeout, in ms (TASK-006). */
  webhookTimeoutMs: number;
  /** TOTAL webhook attempts (1 initial + retries) before `exhausted` (TASK-006). */
  webhookMaxAttempts: number;
  /** Fixed delay, in ms, between webhook delivery attempts (TASK-006). */
  webhookRetryBackoffMs: number;
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? '',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    activityBackfillLimit: Number(process.env.ACTIVITY_BACKFILL_LIMIT ?? 50),
    activityHeartbeatMs: Number(process.env.ACTIVITY_HEARTBEAT_MS ?? 15000),
    webhookTimeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000),
    webhookMaxAttempts: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 3),
    webhookRetryBackoffMs: Number(process.env.WEBHOOK_RETRY_BACKOFF_MS ?? 30000),
  };
}
