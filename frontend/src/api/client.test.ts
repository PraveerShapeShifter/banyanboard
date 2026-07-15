import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBoard, getBoards, getCards } from './client';
import type { Board, Card } from './types';

/**
 * Phase 1 tests (AC-HAPPY-1 support): the API client is the single I/O seam.
 * These lock in (a) the 12-factor base-URL-from-env behavior and (b) the exact
 * request paths for the three read endpoints, plus the error normalization the
 * later pages depend on to render error (AC-ERROR-1/2) vs. not-found (AC-ERROR-3)
 * states. Fetch is stubbed — no live backend, mirroring the backend's stub pattern.
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

const sampleBoard: Board = {
  id: 1,
  name: 'Marketing Launch',
  description: 'Q3 campaign planning',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const sampleCard: Card = {
  id: 10,
  board_id: 1,
  title: 'Draft brief',
  description: null,
  status: 'todo',
  due_date: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('api client — 12-factor base URL', () => {
  it('reads the API base URL from VITE_API_BASE_URL rather than hardcoding it', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/v1');
    const fetchMock = stubFetch({ jsonData: [] });

    await getBoards();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/boards',
      expect.anything(),
    );
  });

  it('defaults to same-origin /api when VITE_API_BASE_URL is unset', async () => {
    vi.stubEnv('VITE_API_BASE_URL', undefined);
    const fetchMock = stubFetch({ jsonData: [] });

    await getBoards();

    expect(fetchMock).toHaveBeenCalledWith('/api/boards', expect.anything());
  });
});

describe('api client — request shaping', () => {
  it('GET /boards/:id for a single board', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ jsonData: sampleBoard });

    await getBoard(42);

    expect(fetchMock).toHaveBeenCalledWith('/api/boards/42', expect.anything());
  });

  it('GET /cards?board_id= for a board’s cards', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api');
    const fetchMock = stubFetch({ jsonData: [sampleCard] });

    await getCards(42);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/cards?board_id=42',
      expect.anything(),
    );
  });
});

describe('api client — result normalization', () => {
  it('returns ok:true with parsed data on a 200', async () => {
    stubFetch({ ok: true, status: 200, jsonData: [sampleBoard] });

    const result = await getBoards();

    expect(result).toEqual({ ok: true, data: [sampleBoard] });
  });

  it('maps a 404 to a distinct http error result (AC-ERROR-3 support)', async () => {
    stubFetch({ ok: false, status: 404, jsonData: { error: 'Board not found' } });

    const result = await getBoard(999);

    expect(result).toEqual({ ok: false, kind: 'http', status: 404 });
  });

  it('maps a non-2xx (500) to an http error result', async () => {
    stubFetch({ ok: false, status: 500 });

    const result = await getBoards();

    expect(result).toEqual({ ok: false, kind: 'http', status: 500 });
  });

  it('maps a thrown fetch (network failure) to a network error result', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getBoards();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
    }
  });
});
