import 'dotenv/config';

/**
 * Application configuration, sourced entirely from environment variables
 * (12-factor). No values are hardcoded in application code.
 */
export interface Env {
  port: number;
  databaseUrl: string;
  logLevel: string;
}

export function loadEnv(): Env {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: process.env.DATABASE_URL ?? '',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
