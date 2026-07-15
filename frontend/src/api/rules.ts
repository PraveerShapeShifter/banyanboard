import { getJson, mutateJson } from './client';
import type { ApiResult, MutationResult } from './client';
import type { AutomationRule, CardStatus, RuleCondition } from './types';

/**
 * Concern-scoped seam for automation-rule I/O (TASK-006 Phase 4), mirroring the
 * `api/activityStream.ts` precedent: it builds typed request functions on top of
 * `client.ts`'s `getJson`/`mutateJson` (still the only module that touches
 * `fetch`), so pages depend on these functions and never on URLs. Reads return
 * `ApiResult<T>`; writes return `MutationResult<T>` (carrying the coded 400 body).
 */

/** Request body for `POST /rules`. `condition.field`/`operator` are frozen. */
export interface CreateRuleBody {
  board_id: number;
  name: string;
  condition: RuleCondition;
  target_status: CardStatus;
  enabled: boolean;
  webhook_url: string | null;
}

/** Partial body for `PATCH /rules/:id` (every field optional). */
export interface UpdateRuleBody {
  name?: string;
  condition?: RuleCondition;
  target_status?: CardStatus;
  enabled?: boolean;
  webhook_url?: string | null;
}

/** `GET /rules?board_id=` — the board's rules (read). */
export function getRules(boardId: number | string): Promise<ApiResult<AutomationRule[]>> {
  return getJson<AutomationRule[]>(
    `/rules?board_id=${encodeURIComponent(String(boardId))}`,
  );
}

/** `POST /rules` — create a rule. */
export function createRule(body: CreateRuleBody): Promise<MutationResult<AutomationRule>> {
  return mutateJson<AutomationRule>('POST', '/rules', body);
}

/** `PATCH /rules/:id` — partial update (e.g. `{enabled}`). */
export function updateRule(
  id: number | string,
  patch: UpdateRuleBody,
): Promise<MutationResult<AutomationRule>> {
  return mutateJson<AutomationRule>(
    'PATCH',
    `/rules/${encodeURIComponent(String(id))}`,
    patch,
  );
}

/** `DELETE /rules/:id` — delete a rule (`204` on success). */
export function deleteRule(id: number | string): Promise<MutationResult<void>> {
  return mutateJson<void>('DELETE', `/rules/${encodeURIComponent(String(id))}`);
}
