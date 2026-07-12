import { Pool } from 'pg';

/**
 * Creates a PostgreSQL connection pool from a 12-factor connection string.
 * No connection is opened until the first query, so this is safe to call at
 * boot even when the database is not yet reachable.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

/**
 * Reports whether the database answers a trivial round-trip query.
 * Returns `false` (never throws) so callers can treat it as a simple liveness
 * signal for the `/health` endpoint.
 */
export async function checkConnection(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
