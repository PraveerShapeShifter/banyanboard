type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * Minimal structured (JSON) logger. Writes one JSON object per line to stdout.
 * Kept intentionally tiny; can be swapped for a full OpenTelemetry-backed
 * logger later without changing call sites.
 */
export function log(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
  const entry = { level, msg, time: new Date().toISOString(), ...meta };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
