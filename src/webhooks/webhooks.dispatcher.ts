import { log } from '../config/logger';
import type { AutomationRule } from '../rules/rules.types';
import type { WebhooksRepository } from './webhooks.repository';
import type { TriggerExecution, WebhookError, WebhookPayload } from './webhooks.types';

/**
 * The injected webhook-delivery seam (FEAT-006 / TASK-006), mirroring the
 * `ActivityEmitter`/`RuleEngine` idiom. The engine hands each `webhook_url`-
 * bearing rule firing to `dispatch`; the dispatcher owns the entire delivery
 * lifecycle (creating the `pending` `webhook_deliveries` row, performing the
 * outbound POST + bounded retries) OFF the request path.
 *
 * `dispatch` is deliberately fire-and-forget: it returns `void` immediately so
 * webhook latency never enters the `PATCH /cards/:id` budget, and it MUST be
 * internally fail-safe — it never throws out to the engine and never crashes
 * the process (mirrors the AC-ERROR-3/AC-ERROR-4 fail-safe posture). This is
 * the single swap-point for the real `HttpWebhookDispatcher` (Phase 3).
 */
export interface WebhookDispatcher {
  /**
   * Hand a webhook-bearing rule firing to the dispatcher. `execution` is the
   * already-recorded `trigger_executions` row for the hop, `rule` carries the
   * `webhook_url` to POST to, and `payload` is the fixed-shape body (captured
   * once at fire time so `occurred_at` is byte-stable across retries).
   */
  dispatch(execution: TriggerExecution, rule: AutomationRule, payload: WebhookPayload): void;
}

/**
 * A temporary no-op dispatcher for Phase 2: it only logs that a dispatch was
 * requested, so the engine can wire and unit-test the seam (dispatch is called
 * exactly when a firing rule has a `webhook_url`) WITHOUT the real outbound
 * HTTP + retry lifecycle, which is Phase 3's `HttpWebhookDispatcher`.
 *
 * Per the observability guidance it logs identifiers only — never the payload
 * body or the full `webhook_url` (either could carry secrets).
 */
export class NoopWebhookDispatcher implements WebhookDispatcher {
  dispatch(execution: TriggerExecution, rule: AutomationRule, _payload: WebhookPayload): void {
    log('info', 'rules.webhook_dispatch_noop', {
      trigger_execution_id: execution.id,
      rule_id: rule.id,
      card_id: execution.card_id,
      board_id: execution.board_id,
    });
  }
}

/** Tuning knobs for {@link HttpWebhookDispatcher} (12-factor; sourced from `env`). */
export interface HttpWebhookDispatcherConfig {
  /** Per-attempt hard cap enforced via `AbortController` (default 5000). */
  timeoutMs: number;
  /** TOTAL attempts before `exhausted` — 1 initial + (max-1) retries (default 3). */
  maxAttempts: number;
  /** Fixed delay between attempts (default 30000). */
  retryBackoffMs: number;
}

/** The tagged outcome of a single timeout-bounded POST — `postWithTimeout` NEVER throws. */
type PostOutcome =
  | { kind: 'ok'; status: number }
  | { kind: 'non_2xx'; status: number }
  | { kind: 'timeout_or_network'; message: string };

/**
 * Build the coded `WebhookError` for a failed attempt (per the frozen vocabulary):
 * a non-2xx becomes `WEBHOOK_NON_2XX`; a timeout OR any network/DNS/TLS error
 * becomes `WEBHOOK_TIMEOUT` (the two share a code by the frozen rule).
 */
function classify(outcome: Exclude<PostOutcome, { kind: 'ok' }>, timeoutMs: number): WebhookError {
  if (outcome.kind === 'non_2xx') {
    return {
      code: 'WEBHOOK_NON_2XX',
      message: 'Webhook returned a non-2xx status',
      details: [{ field: 'status', error: `${outcome.status} is not 2xx` }],
    };
  }
  return {
    code: 'WEBHOOK_TIMEOUT',
    message: 'Webhook request timed out',
    details: [{ field: 'timeout', error: `no response within ${timeoutMs}ms` }],
  };
}

/**
 * The Phase 3 outbound-webhook dispatcher: performs the POST + bounded retries
 * OFF the `PATCH /cards/:id` request path, driving `webhook_deliveries` through
 * `pending → delivered | failed → exhausted` per the Webhook Retry Algorithm.
 *
 * Mechanism (frozen): Node global `fetch` + `AbortController(timeoutMs)` for the
 * POST; in-process `setTimeout(retryBackoffMs).unref()` for retries; a single
 * re-entrant {@link deliver} function is the sole state-transition point.
 *
 * FULLY FAIL-SAFE: neither `dispatch` nor `deliver` ever throws or rejects out —
 * every `fetch` failure is mapped to a recorded delivery failure, and every
 * repository/serializer fault is swallowed by the outer guard (logged as
 * `rules.webhook_dispatch_error`), so a webhook fault can never crash the
 * process or roll back the already-committed auto-move.
 */
export class HttpWebhookDispatcher implements WebhookDispatcher {
  /** Armed retry timers by `deliveryId` (tracked for graceful shutdown + tests). */
  private readonly pendingRetries = new Map<number, NodeJS.Timeout>();
  /**
   * The byte-stable POST body per in-flight delivery, serialized ONCE at
   * dispatch time and reused identically on every attempt (idempotency — so
   * `occurred_at` and the receiver's dedupe key never drift on retry). The
   * `webhook_deliveries` read projection omits `payload`, so the body lives
   * here for the duration of the in-memory (non-durable) delivery lifecycle.
   */
  private readonly payloads = new Map<number, string>();

  constructor(
    private readonly webhooksRepo: WebhooksRepository,
    private readonly config: HttpWebhookDispatcherConfig,
  ) {}

  /**
   * Fire-and-forget entry from the engine (on the synchronous PATCH path).
   * Returns `void` immediately; the row creation + POST run in a guarded async
   * task the caller never awaits. A `null` `webhook_url` is a no-op (no row, no
   * fetch — delivery is opt-in).
   */
  dispatch(execution: TriggerExecution, rule: AutomationRule, payload: WebhookPayload): void {
    try {
      const url = rule.webhook_url;
      if (!url) {
        return; // opt-in: no delivery row, no fetch (edge 9)
      }
      // Serialize ONCE — this exact string is both the audit snapshot and the
      // byte-stable body reused on every retry.
      const body = JSON.stringify(payload);
      void this.createAndSchedule(execution, rule, url, body);
    } catch (err) {
      // dispatch must never throw out onto the request path.
      this.logDispatchError(undefined, err);
    }
  }

  /** Persist the `pending` row (off-path), then schedule the first attempt. Fail-safe. */
  private async createAndSchedule(
    execution: TriggerExecution,
    rule: AutomationRule,
    url: string,
    body: string,
  ): Promise<void> {
    try {
      const delivery = await this.webhooksRepo.createDelivery({
        trigger_execution_id: execution.id,
        rule_id: rule.id,
        url,
        payload: body,
      });
      this.payloads.set(delivery.id, body);
      this.scheduleAttempt(delivery.id, 0); // first attempt off the request path
    } catch (err) {
      this.logDispatchError(undefined, err);
    }
  }

  /** Arm a `setTimeout` for a (first or retry) attempt; `.unref()` so it never blocks shutdown. */
  private scheduleAttempt(deliveryId: number, delayMs: number): void {
    const handle = setTimeout(() => {
      this.pendingRetries.delete(deliveryId);
      void this.deliver(deliveryId);
    }, delayMs);
    if (typeof handle.unref === 'function') {
      handle.unref();
    }
    this.pendingRetries.set(deliveryId, handle);
  }

  /**
   * The single re-entrant state-transition function — one attempt per call.
   * Re-reads the row (terminal-guard), POSTs, classifies, advances the row, and
   * arms exactly one retry when attempts remain. NEVER throws / rejects.
   */
  async deliver(deliveryId: number): Promise<void> {
    try {
      const row = await this.webhooksRepo.findDeliveryById(deliveryId);
      if (row === null) {
        this.payloads.delete(deliveryId); // row gone (cascade delete) — no-op (edge 8)
        return;
      }
      if (row.status === 'delivered' || row.status === 'exhausted') {
        this.payloads.delete(deliveryId); // terminal — idempotent no-op (edge 7)
        return;
      }

      const attempt = row.attempts + 1; // THIS attempt's number: 1..maxAttempts
      const body = this.payloads.get(deliveryId) ?? '';
      const outcome = await this.postWithTimeout(row.url, body);

      if (outcome.kind === 'ok') {
        await this.webhooksRepo.markDelivered(deliveryId, {
          attempts: attempt,
          last_status_code: outcome.status,
        });
        this.payloads.delete(deliveryId);
        log('info', 'rules.webhook_delivered', {
          delivery_id: deliveryId,
          rule_id: row.rule_id,
          last_status_code: outcome.status,
          attempts: attempt,
        });
        return;
      }

      // Failure branch — classify and either retry (attempts remain) or exhaust.
      const coded = classify(outcome, this.config.timeoutMs);
      const statusCode = outcome.kind === 'non_2xx' ? outcome.status : null;

      if (attempt < this.config.maxAttempts) {
        await this.webhooksRepo.markFailed(deliveryId, {
          attempts: attempt,
          last_status_code: statusCode,
          last_error: JSON.stringify(coded),
        });
        log('error', 'rules.webhook_failed', {
          delivery_id: deliveryId,
          rule_id: row.rule_id,
          code: coded.code,
          attempt,
          last_status_code: statusCode,
        });
        this.scheduleAttempt(deliveryId, this.config.retryBackoffMs); // fixed backoff, off-path
      } else {
        const exhausted: WebhookError = {
          code: 'WEBHOOK_EXHAUSTED',
          message: `Webhook delivery exhausted after ${this.config.maxAttempts} attempts`,
          details: [
            {
              field: 'attempts',
              error: `${this.config.maxAttempts} of ${this.config.maxAttempts} attempts failed`,
            },
          ],
        };
        await this.webhooksRepo.markExhausted(deliveryId, {
          attempts: attempt,
          last_status_code: statusCode,
          last_error: JSON.stringify(exhausted),
        });
        this.payloads.delete(deliveryId);
        log('error', 'rules.webhook_exhausted', {
          delivery_id: deliveryId,
          rule_id: row.rule_id,
          code: 'WEBHOOK_EXHAUSTED',
          attempts: attempt,
        });
      }
    } catch (err) {
      // FAIL-SAFE: a rejected repo write / serializer / unexpected throw is
      // swallowed here — deliver() still resolves void; the process never crashes.
      this.logDispatchError(deliveryId, err);
    }
  }

  /**
   * One attempt's HTTP call, bounded by `timeoutMs` via `AbortController`.
   * NEVER throws — every failure mode (timeout/abort, network/DNS/TLS reject,
   * synchronous throw) is returned as a tagged `timeout_or_network` outcome.
   */
  private async postWithTimeout(url: string, body: string): Promise<PostOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (res.status >= 200 && res.status <= 299) {
        return { kind: 'ok', status: res.status };
      }
      return { kind: 'non_2xx', status: res.status };
    } catch (err) {
      return { kind: 'timeout_or_network', message: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Log the fail-safe swallow marker. The logger itself must not throw out of deliver(). */
  private logDispatchError(deliveryId: number | undefined, err: unknown): void {
    try {
      log('error', 'rules.webhook_dispatch_error', {
        delivery_id: deliveryId,
        code: 'WEBHOOK_DISPATCH_ERROR',
        message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      /* swallow — even a broken logger must not escape the dispatcher */
    }
  }
}
