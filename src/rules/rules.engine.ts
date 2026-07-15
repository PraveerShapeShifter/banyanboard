import type { Card, CardStatus } from '../cards/cards.types';
import type { CardsRepository } from '../cards/cards.repository';
import type { ActivityRepository } from '../activity/activity.repository';
import type { ActivityEmitter } from '../activity/activity.emitter';
import type { WebhooksRepository } from '../webhooks/webhooks.repository';
import type { WebhookDispatcher } from '../webhooks/webhooks.dispatcher';
import type { WebhookPayload } from '../webhooks/webhooks.types';
import type { RulesRepository } from './rules.repository';
import type { AutomationRule } from './rules.types';
import { log } from '../config/logger';

/**
 * The three card statuses, in canonical order. The transition graph the engine
 * walks has exactly these three nodes (edges are enabled rules), which is what
 * makes a small fixed hop bound provably correct.
 */
const CARD_STATUSES: readonly CardStatus[] = ['todo', 'in_progress', 'done'];

/**
 * The defensive hop ceiling (frozen Algorithm decision). Derived from the
 * status-enum size so it auto-scales and self-documents: a card can occupy each
 * of the N statuses at most once per pass, so an Nth distinct hop is impossible.
 * NOT env- or per-rule-configurable (AC-ERROR-1: a small fixed constant to
 * protect the p95 < 200ms budget under synchronous evaluation).
 */
const MAX_HOPS = CARD_STATUSES.length;

/**
 * The injected rule-evaluation seam (FEAT-006 / TASK-006), mirroring the
 * `ActivityEmitter` seam. `createCardsRouter` invokes `evaluate` inside the
 * real-transition gate of `PATCH /cards/:id`, immediately after the FEAT-005
 * activity-capture block.
 */
export interface RuleEngine {
  /**
   * Evaluate `card`'s post-transition state against its board's enabled rules
   * and apply bounded auto-move hops. Returns the card's final
   * (last-successfully-applied) state. INTERNALLY FAIL-SAFE: never throws — on a
   * cycle-guard trip or a mid-pass persistence error it logs a structured event
   * and returns the last-applied card (committed hops stay committed).
   */
  evaluate(card: Card): Promise<Card>;
}

/** Constructor dependencies for {@link CardRuleEngine}. */
export interface CardRuleEngineDeps {
  rulesRepo: RulesRepository;
  cardsRepo: CardsRepository;
  activityRepo: ActivityRepository;
  activityEmitter: ActivityEmitter;
  webhooksRepo: WebhooksRepository;
  webhookDispatcher: WebhookDispatcher;
}

/**
 * The synchronous, bounded, fail-safe rule-evaluation engine (frozen Algorithm
 * decision — Option 3: a visited-status `Set<CardStatus>` as the operative
 * cycle detector, backed by a defensive `MAX_HOPS` ceiling).
 *
 * Per applied hop it: moves the card (`cardsRepo.update`), records the
 * distinguishable `triggered_by:'rule'` activity (`activityRepo.record` +
 * `activityEmitter.emit`), logs a `trigger_executions` row
 * (`webhooksRepo.recordExecution`), and — only when the firing rule has a
 * `webhook_url` — hands the firing to the injected `WebhookDispatcher`. Every
 * faulting path (a thrown repo call, a cycle trip, the defensive ceiling) logs
 * a structured event and returns the last-applied card without rethrowing.
 */
export class CardRuleEngine implements RuleEngine {
  constructor(private readonly deps: CardRuleEngineDeps) {}

  async evaluate(card: Card): Promise<Card> {
    const { rulesRepo, cardsRepo, activityRepo, activityEmitter, webhooksRepo, webhookDispatcher } =
      this.deps;

    let rules: AutomationRule[];
    try {
      // ONE read per pass — the board's enabled rules, ordered `id ASC` so
      // first-match-wins is by lowest id.
      rules = await rulesRepo.findEnabledByBoard(card.board_id);
    } catch (err) {
      log('error', 'rules.execution_failed', {
        code: 'RULE_EXECUTION_FAILED',
        card_id: card.id,
        board_id: card.board_id,
        message: err instanceof Error ? err.message : String(err),
      });
      return card; // fail-safe: the manual card stands (AC-ERROR-3)
    }

    let current = card;
    const visited = new Set<CardStatus>([current.status]);
    let hops = 0;

    while (hops < MAX_HOPS) {
      const rule = firstMatch(rules, current.status);
      if (rule === null) {
        break; // natural termination — no rule matches the current status
      }

      const target = rule.target_status;
      if (visited.has(target)) {
        // Revisiting an occupied status is, in this deterministic status-only
        // model, definitionally a cycle. Trip BEFORE applying, so no spurious
        // revisit activity row is written (AC-ERROR-1).
        log('error', 'rules.cycle_detected', {
          code: 'RULE_CYCLE_DETECTED',
          card_id: current.id,
          board_id: current.board_id,
          hops,
          last_status: current.status,
        });
        return current;
      }

      try {
        const fromStatus = current.status;
        const result = await cardsRepo.update(current.id, { status: target });
        if (!result) {
          // The card vanished mid-pass (e.g. concurrently deleted). Nothing more
          // to apply; return the last-applied card, fail-safe.
          log('error', 'rules.execution_failed', {
            code: 'RULE_EXECUTION_FAILED',
            card_id: current.id,
            board_id: current.board_id,
            rule_id: rule.id,
            message: 'card not found during auto-move',
          });
          return current;
        }
        const moved = result.card;

        const event = await activityRepo.record({
          board_id: moved.board_id,
          card_id: moved.id,
          card_title: moved.title,
          from_status: fromStatus,
          to_status: target,
          triggered_by: 'rule',
          rule_id: rule.id,
        });
        activityEmitter.emit(moved.board_id, event);

        // Trigger-execution log (one row per firing). Its `status` reflects only
        // whether the auto-move applied — separate from any webhook outcome.
        const execution = await webhooksRepo.recordExecution({
          rule_id: rule.id,
          card_id: moved.id,
          board_id: moved.board_id,
          from_status: fromStatus,
          to_status: target,
          status: 'executed',
        });

        // Opt-in webhook delivery: hand the firing to the dispatcher only when
        // the rule carries a `webhook_url` (delivery is off the request path).
        if (rule.webhook_url) {
          const payload: WebhookPayload = {
            event: 'rule.triggered',
            rule_id: rule.id,
            board_id: moved.board_id,
            card_id: moved.id,
            card_title: moved.title,
            from_status: fromStatus,
            to_status: target,
            triggered_by: 'rule',
            occurred_at: new Date().toISOString(),
          };
          webhookDispatcher.dispatch(execution, rule, payload);
        }

        log('info', 'rules.applied', {
          card_id: moved.id,
          board_id: moved.board_id,
          rule_id: rule.id,
          from_status: fromStatus,
          to_status: target,
          activity_id: event.id,
        });

        current = moved;
        visited.add(current.status);
        hops += 1;
      } catch (err) {
        // Fail-safe: any thrown persistence/dispatch call halts the pass; hops
        // already committed stay committed (AC-ASYNC-2 — no rollback).
        log('error', 'rules.execution_failed', {
          code: 'RULE_EXECUTION_FAILED',
          card_id: current.id,
          board_id: current.board_id,
          rule_id: rule.id,
          message: err instanceof Error ? err.message : String(err),
        });
        return current;
      }
    }

    // Defensive ceiling — only reachable if the visited-status detector is ever
    // weakened by a future model change (dead code in the 3-status model).
    if (hops === MAX_HOPS && firstMatch(rules, current.status) !== null) {
      log('error', 'rules.cycle_detected', {
        code: 'RULE_CYCLE_DETECTED',
        card_id: current.id,
        board_id: current.board_id,
        hops,
        last_status: current.status,
      });
    }

    return current;
  }
}

/**
 * The first (lowest-`id`, since `rules` arrive ordered `id ASC`) enabled rule
 * whose single status-equality predicate matches `status`, or `null`.
 */
function firstMatch(rules: AutomationRule[], status: CardStatus): AutomationRule | null {
  for (const rule of rules) {
    if (
      rule.condition.field === 'status' &&
      rule.condition.operator === 'eq' &&
      rule.condition.value === status
    ) {
      return rule;
    }
  }
  return null;
}
