import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardRuleEngine } from './rules.engine';
import type { AutomationRule } from './rules.types';
import type { Card, UpdateCardInput } from '../cards/cards.types';
import type { CardsRepository } from '../cards/cards.repository';
import type { ActivityRepository } from '../activity/activity.repository';
import type { CardActivity, RecordActivityInput } from '../activity/activity.types';
import type { ActivityEmitter } from '../activity/activity.emitter';
import type { RulesRepository } from './rules.repository';
import type { WebhooksRepository } from '../webhooks/webhooks.repository';
import type {
  RecordTriggerExecutionInput,
  TriggerExecution,
  WebhookPayload,
} from '../webhooks/webhooks.types';
import type { WebhookDispatcher } from '../webhooks/webhooks.dispatcher';
import { log } from '../config/logger';

/**
 * Unit tests for `CardRuleEngine.evaluate` (TASK-006 Phase 2), covering the
 * frozen algorithm doc's Testing Strategy cases 1–11 PLUS the webhook seam:
 * a `trigger_executions` row is recorded per applied hop, and the injected
 * `WebhookDispatcher` is invoked exactly when a firing rule has a `webhook_url`.
 *
 * All collaborators are stubbed (`rulesRepo`, `cardsRepo`, `activityRepo`,
 * `activityEmitter`, `webhooksRepo`, `webhookDispatcher`) — no live database,
 * no real network. `log` is mocked so the structured `rules.cycle_detected` /
 * `rules.execution_failed` / `rules.applied` events can be asserted.
 */

vi.mock('../config/logger', () => ({ log: vi.fn() }));
const logMock = vi.mocked(log);

/** A canonical enabled rule; override per test. Matches `in_progress`, moves to `done`. */
function makeRule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 1,
    board_id: 100,
    name: 'rule',
    condition: { field: 'status', operator: 'eq', value: 'in_progress' },
    target_status: 'done',
    enabled: true,
    webhook_url: null,
    created_at: new Date('2026-07-15T00:00:00.000Z'),
    updated_at: new Date('2026-07-15T00:00:00.000Z'),
    ...over,
  };
}

/** A canonical post-update card; override per test. */
function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: 500,
    board_id: 100,
    title: 'Ship v1',
    description: null,
    status: 'in_progress',
    due_date: null,
    created_at: new Date('2026-07-15T00:00:00.000Z'),
    updated_at: new Date('2026-07-15T00:00:00.000Z'),
    ...over,
  };
}

interface HarnessOpts {
  findThrows?: boolean;
  /** Throw inside `cardsRepo.update` on the Nth call (1-based). */
  updateThrowAtCall?: number;
  /** Throw inside `activityRepo.record` on the Nth call (1-based). */
  recordThrowAtCall?: number;
}

/** Build the engine over spying stubs, seeded with `rules` and an initial card. */
function makeHarness(rules: AutomationRule[], initial: Card, opts: HarnessOpts = {}) {
  const updateCalls: { id: number; input: UpdateCardInput }[] = [];
  const recordCalls: RecordActivityInput[] = [];
  const emitCalls: { boardId: number; event: CardActivity }[] = [];
  const executionCalls: RecordTriggerExecutionInput[] = [];
  const dispatchCalls: { execution: TriggerExecution; rule: AutomationRule; payload: WebhookPayload }[] =
    [];

  let cur = { ...initial };
  let activityId = 1;
  let execId = 1;

  const rulesRepo = {
    findEnabledByBoard: async () => {
      if (opts.findThrows) throw new Error('rules read down');
      return rules;
    },
  } as unknown as RulesRepository;

  const cardsRepo = {
    async update(id: number, input: UpdateCardInput) {
      updateCalls.push({ id, input });
      if (opts.updateThrowAtCall === updateCalls.length) throw new Error('card update down');
      const previousStatus = cur.status;
      cur = { ...cur, status: input.status ?? cur.status };
      return { card: { ...cur }, previousStatus };
    },
  } as unknown as CardsRepository;

  const activityRepo = {
    async record(input: RecordActivityInput) {
      recordCalls.push(input);
      if (opts.recordThrowAtCall === recordCalls.length) throw new Error('activity store down');
      const event: CardActivity = {
        id: activityId++,
        board_id: input.board_id,
        card_id: input.card_id,
        card_title: input.card_title,
        from_status: input.from_status,
        to_status: input.to_status,
        triggered_by: input.triggered_by ?? 'manual',
        rule_id: input.rule_id ?? null,
        created_at: new Date(),
      };
      return event;
    },
  } as unknown as ActivityRepository;

  const activityEmitter: ActivityEmitter = {
    subscribe: () => () => {},
    emit(boardId: number, event: CardActivity) {
      emitCalls.push({ boardId, event });
    },
  };

  const webhooksRepo = {
    async recordExecution(input: RecordTriggerExecutionInput) {
      executionCalls.push(input);
      const execution: TriggerExecution = {
        id: execId++,
        rule_id: input.rule_id,
        card_id: input.card_id,
        board_id: input.board_id,
        from_status: input.from_status,
        to_status: input.to_status,
        status: input.status,
        created_at: new Date(),
      };
      return execution;
    },
  } as unknown as WebhooksRepository;

  const webhookDispatcher: WebhookDispatcher = {
    dispatch(execution: TriggerExecution, rule: AutomationRule, payload: WebhookPayload) {
      dispatchCalls.push({ execution, rule, payload });
    },
  };

  const engine = new CardRuleEngine({
    rulesRepo,
    cardsRepo,
    activityRepo,
    activityEmitter,
    webhooksRepo,
    webhookDispatcher,
  });

  return { engine, updateCalls, recordCalls, emitCalls, executionCalls, dispatchCalls };
}

/** Count `log` calls for a given event name. */
function logCount(event: string): number {
  return logMock.mock.calls.filter((c) => c[1] === event).length;
}

/** The meta object of the first `log` call for a given event name. */
function logMeta(event: string): Record<string, unknown> | undefined {
  const call = logMock.mock.calls.find((c) => c[1] === event);
  return call?.[2] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  logMock.mockClear();
});

describe('CardRuleEngine.evaluate', () => {
  it('1. match -> a single auto-move applies, records activity + trigger execution, emits once', async () => {
    const rules = [makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' })];
    const { engine, updateCalls, recordCalls, emitCalls, executionCalls, dispatchCalls } = makeHarness(
      rules,
      makeCard({ status: 'in_progress' }),
    );

    const result = await engine.evaluate(makeCard({ status: 'in_progress' }));

    expect(result.status).toBe('done');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].input).toEqual({ status: 'done' });
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0]).toMatchObject({
      triggered_by: 'rule',
      rule_id: 1,
      from_status: 'in_progress',
      to_status: 'done',
    });
    expect(emitCalls).toHaveLength(1);
    // A trigger execution row is recorded even without a webhook_url.
    expect(executionCalls).toHaveLength(1);
    expect(executionCalls[0]).toMatchObject({ status: 'executed', rule_id: 1, to_status: 'done' });
    // No webhook_url => the dispatcher is never invoked.
    expect(dispatchCalls).toHaveLength(0);
  });

  it('2. no match -> no-op: input card returned unchanged, no side effects', async () => {
    const rules = [makeRule({ condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'done' })];
    const { engine, updateCalls, recordCalls, emitCalls, executionCalls } = makeHarness(
      rules,
      makeCard({ status: 'in_progress' }),
    );

    const input = makeCard({ status: 'in_progress' });
    const result = await engine.evaluate(input);

    expect(result).toEqual(input);
    expect(updateCalls).toHaveLength(0);
    expect(recordCalls).toHaveLength(0);
    expect(emitCalls).toHaveLength(0);
    expect(executionCalls).toHaveLength(0);
  });

  it('3. disabled rule -> no-op (findEnabledByBoard filters it out, engine sees [])', async () => {
    const { engine, updateCalls, recordCalls } = makeHarness([], makeCard({ status: 'in_progress' }));

    const result = await engine.evaluate(makeCard({ status: 'in_progress' }));

    expect(result.status).toBe('in_progress');
    expect(updateCalls).toHaveLength(0);
    expect(recordCalls).toHaveLength(0);
  });

  it('4. legitimate 2-hop chain (todo -> in_progress -> done): both hops, each tagged with its rule', async () => {
    const rules = [
      makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'in_progress' }),
      makeRule({ id: 2, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' }),
    ];
    const { engine, updateCalls, recordCalls, emitCalls } = makeHarness(rules, makeCard({ status: 'todo' }));

    const result = await engine.evaluate(makeCard({ status: 'todo' }));

    expect(result.status).toBe('done');
    expect(updateCalls.map((c) => c.input.status)).toEqual(['in_progress', 'done']);
    expect(recordCalls).toHaveLength(2);
    expect(recordCalls[0]).toMatchObject({ rule_id: 1, from_status: 'todo', to_status: 'in_progress' });
    expect(recordCalls[1]).toMatchObject({ rule_id: 2, from_status: 'in_progress', to_status: 'done' });
    expect(emitCalls).toHaveLength(2);
    expect(logCount('rules.cycle_detected')).toBe(0);
  });

  it('5. multiple matches on a status -> first-match-wins by lowest id', async () => {
    const rules = [
      makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'in_progress' }),
      makeRule({ id: 2, condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'done' }),
    ];
    const { engine, updateCalls, recordCalls } = makeHarness(rules, makeCard({ status: 'todo' }));

    const result = await engine.evaluate(makeCard({ status: 'todo' }));

    // id=1 fires first (to in_progress); from in_progress no rule matches -> stop.
    expect(updateCalls[0].input.status).toBe('in_progress');
    expect(recordCalls[0].rule_id).toBe(1);
    expect(result.status).toBe('in_progress');
  });

  it('6. cycle halts at the bound BEFORE applying the looping hop (AC-ERROR-1)', async () => {
    const rules = [
      makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' }),
      makeRule({ id: 2, condition: { field: 'status', operator: 'eq', value: 'done' }, target_status: 'in_progress' }),
    ];
    const { engine, updateCalls } = makeHarness(rules, makeCard({ status: 'in_progress' }));

    const result = await engine.evaluate(makeCard({ status: 'in_progress' }));

    // Only the A hop applies; the B/revisit hop is never applied.
    expect(updateCalls).toHaveLength(1);
    expect(result.status).toBe('done');
    expect(logCount('rules.cycle_detected')).toBe(1);
    expect(logMeta('rules.cycle_detected')).toMatchObject({
      code: 'RULE_CYCLE_DETECTED',
      hops: 1,
      last_status: 'done',
    });
  });

  it('7. self-loop rule at runtime -> never applied, cycle logged, card unchanged', async () => {
    const rules = [
      makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'done' }, target_status: 'done' }),
    ];
    const { engine, updateCalls } = makeHarness(rules, makeCard({ status: 'done' }));

    const result = await engine.evaluate(makeCard({ status: 'done' }));

    expect(updateCalls).toHaveLength(0);
    expect(result.status).toBe('done');
    expect(logCount('rules.cycle_detected')).toBe(1);
  });

  it('8. fail-safe on a thrown cardsRepo.update -> no rethrow, input card returned, execution_failed logged (AC-ERROR-3)', async () => {
    const rules = [makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' })];
    const { engine, recordCalls } = makeHarness(rules, makeCard({ status: 'in_progress' }), {
      updateThrowAtCall: 1,
    });

    const input = makeCard({ status: 'in_progress' });
    const result = await engine.evaluate(input);

    expect(result).toEqual(input);
    expect(recordCalls).toHaveLength(0);
    expect(logCount('rules.execution_failed')).toBe(1);
    expect(logMeta('rules.execution_failed')).toMatchObject({ code: 'RULE_EXECUTION_FAILED' });
  });

  it("9. fail-safe on a thrown findEnabledByBoard -> input card returned, no update attempted", async () => {
    const { engine, updateCalls } = makeHarness([makeRule()], makeCard({ status: 'in_progress' }), {
      findThrows: true,
    });

    const input = makeCard({ status: 'in_progress' });
    const result = await engine.evaluate(input);

    expect(result).toEqual(input);
    expect(updateCalls).toHaveLength(0);
    expect(logCount('rules.execution_failed')).toBe(1);
  });

  it('10. partial progress preserved on mid-chain failure (AC-ASYNC-2)', async () => {
    const rules = [
      makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'in_progress' }),
      makeRule({ id: 2, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' }),
    ];
    const { engine, updateCalls, recordCalls } = makeHarness(rules, makeCard({ status: 'todo' }), {
      updateThrowAtCall: 2,
    });

    const result = await engine.evaluate(makeCard({ status: 'todo' }));

    // Hop 1 committed (not rolled back); hop 2's update threw.
    expect(result.status).toBe('in_progress');
    expect(updateCalls).toHaveLength(2);
    expect(recordCalls).toHaveLength(1);
    expect(logCount('rules.execution_failed')).toBe(1);
  });

  it('11. fail-safe on a thrown activityRepo.record -> caught, execution_failed logged, no rethrow', async () => {
    const rules = [makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' })];
    const { engine, updateCalls, recordCalls } = makeHarness(rules, makeCard({ status: 'in_progress' }), {
      recordThrowAtCall: 1,
    });

    const result = await engine.evaluate(makeCard({ status: 'in_progress' }));

    // Per the frozen pseudocode, `current` is reassigned only after record; on a
    // record throw the pre-hop card is returned (the update itself did persist).
    expect(result.status).toBe('in_progress');
    expect(updateCalls).toHaveLength(1);
    expect(recordCalls).toHaveLength(1);
    expect(logCount('rules.execution_failed')).toBe(1);
  });

  describe('webhook seam', () => {
    it('records a trigger_executions row per applied hop', async () => {
      const rules = [
        makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'todo' }, target_status: 'in_progress' }),
        makeRule({ id: 2, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done' }),
      ];
      const { engine, executionCalls } = makeHarness(rules, makeCard({ status: 'todo' }));

      await engine.evaluate(makeCard({ status: 'todo' }));

      expect(executionCalls).toHaveLength(2);
      expect(executionCalls[0]).toMatchObject({ status: 'executed', rule_id: 1, from_status: 'todo', to_status: 'in_progress' });
      expect(executionCalls[1]).toMatchObject({ status: 'executed', rule_id: 2, from_status: 'in_progress', to_status: 'done' });
    });

    it('invokes the dispatcher with (execution, rule, payload) when webhook_url is set', async () => {
      const rules = [
        makeRule({
          id: 7,
          condition: { field: 'status', operator: 'eq', value: 'in_progress' },
          target_status: 'done',
          webhook_url: 'https://example.test/hook',
        }),
      ];
      const { engine, dispatchCalls, executionCalls } = makeHarness(rules, makeCard({ status: 'in_progress' }));

      await engine.evaluate(makeCard({ status: 'in_progress', title: 'Ship v1' }));

      expect(dispatchCalls).toHaveLength(1);
      const { execution, rule, payload } = dispatchCalls[0];
      expect(rule.id).toBe(7);
      // The dispatcher receives the recorded trigger_executions row (with its id).
      expect(executionCalls).toHaveLength(1);
      expect(typeof execution.id).toBe('number');
      expect(execution).toMatchObject({ status: 'executed', rule_id: 7 });
      expect(payload).toMatchObject({
        event: 'rule.triggered',
        rule_id: 7,
        board_id: 100,
        card_id: 500,
        card_title: 'Ship v1',
        from_status: 'in_progress',
        to_status: 'done',
        triggered_by: 'rule',
      });
      expect(typeof payload.occurred_at).toBe('string');
    });

    it('does NOT invoke the dispatcher when webhook_url is null (but still records the execution)', async () => {
      const rules = [
        makeRule({ id: 1, condition: { field: 'status', operator: 'eq', value: 'in_progress' }, target_status: 'done', webhook_url: null }),
      ];
      const { engine, dispatchCalls, executionCalls } = makeHarness(rules, makeCard({ status: 'in_progress' }));

      await engine.evaluate(makeCard({ status: 'in_progress' }));

      expect(dispatchCalls).toHaveLength(0);
      expect(executionCalls).toHaveLength(1);
    });
  });
});
