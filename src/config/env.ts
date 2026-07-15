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
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? '',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    activityBackfillLimit: Number(process.env.ACTIVITY_BACKFILL_LIMIT ?? 50),
    activityHeartbeatMs: Number(process.env.ACTIVITY_HEARTBEAT_MS ?? 15000),
  };
}
