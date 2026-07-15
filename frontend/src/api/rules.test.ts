import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRule, deleteRule, getRules, updateRule } from './rules';
import type { AutomationRule } from './types';

/**
 * TASK-006 Phase 4: the rules seam is built on `client.ts`'s `getJson`/
 * `mutateJson` (the only modules that touch `fetch`). These lock in (a) the
 * request shaping for each verb (method / path / `Content-Type` / body) and
 * (b) `mutateJson`'s coded-error normalization — a coded `400`/`404` body maps
 * to `kind:'validation'` (so a form can read `details[].field`), anything else
 * non-2xx to `kind:'http'`, a thrown fetch to `kind:'network'`. Fetch is
 * stubbed — no live backend (mirrors `client.test.ts`).
 */

function stubFetch(response: {
  ok?: boolean;
  status?: number;
  jsonData?: unknown;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonData,
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const sampleRule: AutomationRule = {
  id: 5,
  board_id: 3,
  name: 'Auto-done',
  condition: { field: 'status', operator: 'eq', value: 'in_progress' },
  target_status: 'done',
  enabled: true,
  webhook_url: null,
  created_at: '2026-07-15T00:00:00.000Z',
  updated_at: '2026-07-15T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('rules seam — request shaping', () => {
  it('GET /rules?board_id= for a board’s rules', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ jsonData: [sampleRule] });

    await getRules(3);

    expect(fetchMock).toHaveBeenCalledWith('/api/rules?board_id=3', expect.anything());
  });

  it('POST /rules with a JSON body and Content-Type header', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ ok: true, status: 201, jsonData: sampleRule });

    const body = {
      board_id: 3,
      name: 'Auto-done',
      condition: { field: 'status', operator: 'eq', value: 'in_progress' } as const,
      target_status: 'done' as const,
      enabled: true,
      webhook_url: null,
    };
    await createRule(body);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rules',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      }),
    );
  });

  it('PATCH /rules/:id with the partial patch body', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ ok: true, status: 200, jsonData: sampleRule });

    await updateRule(5, { enabled: false });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rules/5',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      }),
    );
  });

  it('DELETE /rules/:id with no body', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ ok: true, status: 204, jsonData: undefined });

    await deleteRule(5);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

describe('rules seam — result normalization', () => {
  it('returns ok:true with the created rule on 201', async () => {
    stubFetch({ ok: true, status: 201, jsonData: sampleRule });

    const result = await createRule({
      board_id: 3,
      name: 'Auto-done',
      condition: { field: 'status', operator: 'eq', value: 'in_progress' },
      target_status: 'done',
      enabled: true,
      webhook_url: null,
    });

    expect(result).toEqual({ ok: true, data: sampleRule });
  });

  it('maps a coded 400 INVALID_RULE body to kind:validation carrying details', async () => {
    stubFetch({
      ok: false,
      status: 400,
      jsonData: {
        code: 'INVALID_RULE',
        message: 'Validation failed',
        details: [{ field: 'target_status', error: 'must be one of: todo, in_progress, done' }],
      },
    });

    const result = await createRule({
      board_id: 3,
      name: 'x',
      condition: { field: 'status', operator: 'eq', value: 'done' },
      target_status: 'done',
      enabled: true,
      webhook_url: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('validation');
      if (result.kind === 'validation') {
        expect(result.error.code).toBe('INVALID_RULE');
        expect(result.error.details?.[0]).toEqual({
          field: 'target_status',
          error: 'must be one of: todo, in_progress, done',
        });
      }
    }
  });

  it('maps a coded 400 BOARD_NOT_FOUND (no details) to kind:validation', async () => {
    stubFetch({
      ok: false,
      status: 400,
      jsonData: { code: 'BOARD_NOT_FOUND', message: 'board_id does not reference an existing board' },
    });

    const result = await createRule({
      board_id: 999,
      name: 'x',
      condition: { field: 'status', operator: 'eq', value: 'todo' },
      target_status: 'done',
      enabled: true,
      webhook_url: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'validation') {
      expect(result.error.code).toBe('BOARD_NOT_FOUND');
      expect(result.error.details).toBeUndefined();
    }
  });

  it('maps a coded 404 RULE_NOT_FOUND to kind:validation (delete of a gone rule)', async () => {
    stubFetch({ ok: false, status: 404, jsonData: { code: 'RULE_NOT_FOUND', message: 'Rule not found' } });

    const result = await deleteRule(123);

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'validation') {
      expect(result.error.code).toBe('RULE_NOT_FOUND');
    }
  });

  it('maps a non-coded non-2xx (500) to kind:http', async () => {
    stubFetch({ ok: false, status: 500, jsonData: 'oops' });

    const result = await updateRule(5, { enabled: false });

    expect(result).toEqual({ ok: false, kind: 'http', status: 500 });
  });

  it('maps a thrown fetch to kind:network', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteRule(5);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('network');
  });

  it('resolves a 204 as an empty success (data undefined)', async () => {
    stubFetch({ ok: true, status: 204, jsonData: undefined });

    const result = await deleteRule(5);

    expect(result).toEqual({ ok: true, data: undefined });
  });
});
