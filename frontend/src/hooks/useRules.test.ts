import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRules } from './useRules';
import * as rulesApi from '../api/rules';
import type { AutomationRule } from '../api/types';

/**
 * TASK-006 Phase 4: `useRules` owns the mutable rule-list state (initial load /
 * reload + create-prepend / optimistic toggle-with-rollback / remove incl.
 * 404-as-success), resetting on `boardId` change. The rules seam is mocked (the
 * single stubbed I/O boundary) so the hook's state machine is tested in isolation.
 */
vi.mock('../api/rules');

function rule(id: number, overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id,
    board_id: 1,
    name: `Rule ${id}`,
    condition: { field: 'status', operator: 'eq', value: 'todo' },
    target_status: 'done',
    enabled: true,
    webhook_url: null,
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useRules — initial load & reload', () => {
  it('starts loading, then becomes ready with the fetched rules', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });

    const { result } = renderHook(() => useRules(1));
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0].id).toBe(1);
  });

  it('surfaces an error status when the load fails, and reload retries', async () => {
    vi.mocked(rulesApi.getRules)
      .mockResolvedValueOnce({ ok: false, kind: 'network', error: new Error('x') })
      .mockResolvedValueOnce({ ok: true, data: [rule(9)] });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.rules[0].id).toBe(9);
  });
});

describe('useRules — create', () => {
  it('prepends the created rule to the list on success', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.createRule).mockResolvedValue({ ok: true, data: rule(2) });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.create({
        board_id: 1,
        name: 'Rule 2',
        condition: { field: 'status', operator: 'eq', value: 'todo' },
        target_status: 'done',
        enabled: true,
        webhook_url: null,
      });
    });

    expect(result.current.rules.map((r) => r.id)).toEqual([2, 1]);
  });

  it('does not mutate the list when create fails', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.createRule).mockResolvedValue({
      ok: false,
      kind: 'validation',
      error: { code: 'INVALID_RULE', message: 'Validation failed', details: [] },
    });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.create({
        board_id: 1,
        name: '',
        condition: { field: 'status', operator: 'eq', value: 'todo' },
        target_status: 'done',
        enabled: true,
        webhook_url: null,
      });
    });

    expect(result.current.rules.map((r) => r.id)).toEqual([1]);
  });
});

describe('useRules — toggle (optimistic + rollback)', () => {
  it('flips enabled immediately and reconciles with the server row on success', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1, { enabled: true })] });
    vi.mocked(rulesApi.updateRule).mockResolvedValue({
      ok: true,
      data: rule(1, { enabled: false }),
    });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.toggle(1);
    });

    expect(result.current.rules[0].enabled).toBe(false);
    expect(rulesApi.updateRule).toHaveBeenCalledWith(1, { enabled: false });
  });

  it('rolls back the flip when the PATCH fails', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1, { enabled: true })] });
    vi.mocked(rulesApi.updateRule).mockResolvedValue({ ok: false, kind: 'http', status: 500 });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.toggle(1);
    });

    expect(result.current.rules[0].enabled).toBe(true);
  });
});

describe('useRules — remove', () => {
  it('removes the row on success', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1), rule(2)] });
    vi.mocked(rulesApi.deleteRule).mockResolvedValue({ ok: true, data: undefined });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.remove(1);
    });

    expect(result.current.rules.map((r) => r.id)).toEqual([2]);
  });

  it('treats a coded 404 RULE_NOT_FOUND as success (already gone)', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.deleteRule).mockResolvedValue({
      ok: false,
      kind: 'validation',
      error: { code: 'RULE_NOT_FOUND', message: 'Rule not found' },
    });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.remove(1);
    });

    expect(outcome?.ok).toBe(true);
    expect(result.current.rules).toEqual([]);
  });

  it('keeps the row and returns the error on a non-404 delete failure', async () => {
    vi.mocked(rulesApi.getRules).mockResolvedValue({ ok: true, data: [rule(1)] });
    vi.mocked(rulesApi.deleteRule).mockResolvedValue({ ok: false, kind: 'http', status: 500 });

    const { result } = renderHook(() => useRules(1));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.remove(1);
    });

    expect(outcome?.ok).toBe(false);
    expect(result.current.rules.map((r) => r.id)).toEqual([1]);
  });
});

describe('useRules — board switch reset', () => {
  it('resets and reloads when boardId changes', async () => {
    vi.mocked(rulesApi.getRules).mockImplementation((boardId) =>
      Promise.resolve({ ok: true, data: [rule(Number(boardId) * 10)] }),
    );

    const { result, rerender } = renderHook(({ id }) => useRules(id), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(result.current.rules[0]?.id).toBe(10));

    rerender({ id: 2 });
    await waitFor(() => expect(result.current.rules[0]?.id).toBe(20));
  });
});
