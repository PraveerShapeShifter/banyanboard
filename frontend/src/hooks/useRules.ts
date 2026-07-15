import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRule,
  deleteRule,
  getRules,
  updateRule,
  type CreateRuleBody,
} from '../api/rules';
import type { MutationResult } from '../api/client';
import type { AutomationRule } from '../api/types';

/**
 * Mutable rule-list state machine (TASK-006 Phase 4). Reads (board, history)
 * use `useApiResource`; the rule LIST is real client state (create prepends,
 * toggle flips, delete removes, each with per-row pending) — the exact "state
 * to own" case that justified `useActivityStream`, whose discipline this
 * mirrors: a status for the initial load, a `reload` for retry, and a full
 * reset on `boardId` change. The list is the single source of truth; the form
 * and toggles mutate THROUGH it, never keeping their own copy.
 */

export type RulesStatus = 'loading' | 'ready' | 'error';

export interface UseRulesResult {
  status: RulesStatus;
  rules: AutomationRule[];
  /** Ids with an in-flight toggle (for `aria-busy` / disabled row controls). */
  pendingIds: Set<number>;
  reload(): void;
  create(body: CreateRuleBody): Promise<MutationResult<AutomationRule>>;
  toggle(id: number): Promise<MutationResult<AutomationRule>>;
  remove(id: number): Promise<MutationResult<void>>;
}

export function useRules(boardId: number | string): UseRulesResult {
  const [status, setStatus] = useState<RulesStatus>('loading');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [nonce, setNonce] = useState(0);

  // Synchronous mirror so the async mutation callbacks below always read the
  // latest list (avoids stale closures across an awaited request).
  const rulesRef = useRef<AutomationRule[]>([]);

  const commit = useCallback((next: AutomationRule[]) => {
    rulesRef.current = next;
    setRules(next);
  }, []);

  const reload = useCallback(() => {
    setStatus('loading');
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Reset up front so an in-place board switch never shows the old board's
    // rules under the new one (mirrors useActivityStream's reset discipline).
    setStatus('loading');
    commit([]);
    setPendingIds(new Set());
    getRules(boardId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        commit(result.data);
        setStatus('ready');
      } else {
        setStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boardId, nonce, commit]);

  const markPending = useCallback((id: number, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const create = useCallback(
    async (body: CreateRuleBody): Promise<MutationResult<AutomationRule>> => {
      const result = await createRule(body);
      if (result.ok) {
        commit([result.data, ...rulesRef.current]);
      }
      return result;
    },
    [commit],
  );

  const toggle = useCallback(
    async (id: number): Promise<MutationResult<AutomationRule>> => {
      const current = rulesRef.current.find((rule) => rule.id === id);
      if (!current) return { ok: false, kind: 'http', status: 404 };

      const nextEnabled = !current.enabled;
      // Optimistic flip — perceived latency; rolled back if the PATCH fails.
      commit(rulesRef.current.map((r) => (r.id === id ? { ...r, enabled: nextEnabled } : r)));
      markPending(id, true);

      const result = await updateRule(id, { enabled: nextEnabled });
      markPending(id, false);

      if (result.ok) {
        // Reconcile with the server's authoritative row.
        commit(rulesRef.current.map((r) => (r.id === id ? result.data : r)));
      } else {
        // Roll back to the prior enabled value.
        commit(
          rulesRef.current.map((r) => (r.id === id ? { ...r, enabled: current.enabled } : r)),
        );
      }
      return result;
    },
    [commit, markPending],
  );

  const remove = useCallback(
    async (id: number): Promise<MutationResult<void>> => {
      markPending(id, true);
      const result = await deleteRule(id);
      markPending(id, false);

      // A 404 (already gone) is treated as success — the row is removed either
      // way (coded RULE_NOT_FOUND or a plain http 404).
      const alreadyGone =
        !result.ok &&
        ((result.kind === 'validation' && result.error.code === 'RULE_NOT_FOUND') ||
          (result.kind === 'http' && result.status === 404));

      if (result.ok || alreadyGone) {
        commit(rulesRef.current.filter((r) => r.id !== id));
        return { ok: true, data: undefined };
      }
      return result;
    },
    [commit, markPending],
  );

  return { status, rules, pendingIds, reload, create, toggle, remove };
}
