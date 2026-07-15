import { Router, type Request, type Response, type NextFunction } from 'express';
import type { WebhooksRepository } from './webhooks.repository';
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookError,
} from './webhooks.types';

/**
 * Parse an `:id` / query-filter value into a positive integer. Returns `null`
 * for anything that could not identify a real row. Mirrors `cards.routes.ts`.
 */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = [
  'pending',
  'delivered',
  'failed',
  'exhausted',
];

const DELIVERY_NOT_FOUND = { error: 'Webhook delivery not found' };

/**
 * Safely parse the serialized coded `last_error` back into an `error` object.
 * The writer is the only producer (`JSON.stringify(WebhookError)`), but the
 * parse is guarded so a malformed stored string never crashes a read.
 */
function parseError(lastError: string | null): WebhookError | null {
  if (lastError === null) return null;
  try {
    return JSON.parse(lastError) as WebhookError;
  } catch {
    return null;
  }
}

/**
 * Project a delivery for the read path: omit the audit-only `payload` (never
 * selected) and the raw serialized `last_error`, exposing the parsed coded
 * failure as an `error` object instead (AC-ERROR-4 "error projection of
 * last_error").
 */
function projectDelivery(d: WebhookDelivery): Record<string, unknown> {
  const { last_error, ...rest } = d;
  return { ...rest, error: parseError(last_error) };
}

/**
 * Build a READ-ONLY router for the webhook subsystem's history endpoints:
 * `GET /trigger-executions` (`?board_id=`/`?rule_id=`),
 * `GET /webhook-deliveries` (`?rule_id=`/`?trigger_execution_id=`/`?status=`),
 * `GET /webhook-deliveries/:id`.
 *
 * There are NO write endpoints — deliveries/executions are created and advanced
 * by the engine + dispatcher, never by a client. These reads follow the
 * `{error,...}` envelope used by cards/activity (NOT the coded `/rules` surface).
 */
export function createWebhooksRouter(webhooksRepo: WebhooksRepository): Router {
  const router = Router();

  router.get('/trigger-executions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter: { board_id?: number; rule_id?: number } = {};
      const rawBoardId = req.query.board_id;
      if (rawBoardId !== undefined) {
        const boardId = typeof rawBoardId === 'string' ? parseId(rawBoardId) : null;
        if (boardId === null) {
          res.status(400).json({ error: 'board_id query must be a positive integer' });
          return;
        }
        filter.board_id = boardId;
      }
      const rawRuleId = req.query.rule_id;
      if (rawRuleId !== undefined) {
        const ruleId = typeof rawRuleId === 'string' ? parseId(rawRuleId) : null;
        if (ruleId === null) {
          res.status(400).json({ error: 'rule_id query must be a positive integer' });
          return;
        }
        filter.rule_id = ruleId;
      }
      res.status(200).json(await webhooksRepo.listTriggerExecutions(filter));
    } catch (err) {
      next(err);
    }
  });

  router.get('/webhook-deliveries', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filter: {
        rule_id?: number;
        trigger_execution_id?: number;
        status?: WebhookDeliveryStatus;
      } = {};

      const rawRuleId = req.query.rule_id;
      if (rawRuleId !== undefined) {
        const ruleId = typeof rawRuleId === 'string' ? parseId(rawRuleId) : null;
        if (ruleId === null) {
          res.status(400).json({ error: 'rule_id query must be a positive integer' });
          return;
        }
        filter.rule_id = ruleId;
      }

      const rawTriggerId = req.query.trigger_execution_id;
      if (rawTriggerId !== undefined) {
        const triggerId = typeof rawTriggerId === 'string' ? parseId(rawTriggerId) : null;
        if (triggerId === null) {
          res.status(400).json({ error: 'trigger_execution_id query must be a positive integer' });
          return;
        }
        filter.trigger_execution_id = triggerId;
      }

      const rawStatus = req.query.status;
      if (rawStatus !== undefined) {
        if (
          typeof rawStatus !== 'string' ||
          !DELIVERY_STATUSES.includes(rawStatus as WebhookDeliveryStatus)
        ) {
          res
            .status(400)
            .json({ error: `status query must be one of: ${DELIVERY_STATUSES.join(', ')}` });
          return;
        }
        filter.status = rawStatus as WebhookDeliveryStatus;
      }

      const deliveries = await webhooksRepo.listDeliveries(filter);
      res.status(200).json(deliveries.map(projectDelivery));
    } catch (err) {
      next(err);
    }
  });

  router.get('/webhook-deliveries/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(404).json(DELIVERY_NOT_FOUND);
        return;
      }
      const delivery = await webhooksRepo.findDeliveryById(id);
      if (!delivery) {
        res.status(404).json(DELIVERY_NOT_FOUND);
        return;
      }
      res.status(200).json(projectDelivery(delivery));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
