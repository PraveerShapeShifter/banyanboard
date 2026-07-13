import type { Board, Card } from './types';

/**
 * The single I/O seam for the app: the only module that calls `fetch`. Pages
 * depend on these typed functions, never on `fetch` or a URL; component tests
 * stub this module (mirroring the backend's dependency-injection pattern).
 */

/**
 * Discriminated result so pages can distinguish success, an HTTP status
 * (including 404, which drives the distinct not-found state), and a
 * network/transport failure — without try/catch sprawl in each page.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'http'; status: number }
  | { ok: false; kind: 'network'; error: unknown };

/**
 * Base path for all API calls. Read from the environment (12-factor) so the
 * built artifact is environment-agnostic; defaults to same-origin `/api`, which
 * the Vite dev-server proxy forwards to the Express API (prefix stripped). Read
 * per call (not once at module load) so it is never baked in and stays testable.
 */
function baseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '/api';
}

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    // Transport failure (offline, DNS, CORS, connection reset) — fetch rejects.
    return { ok: false, kind: 'network', error };
  }

  if (!response.ok) {
    return { ok: false, kind: 'http', status: response.status };
  }

  try {
    // Intentionally unvalidated cast (simplicity-first: no schema-validation lib
    // for a frozen, read-only 3-endpoint contract). Revisit if the contract churns.
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (error) {
    // 2xx but an unparseable body — treat as a transport-level failure.
    return { ok: false, kind: 'network', error };
  }
}

export function getBoards(): Promise<ApiResult<Board[]>> {
  return getJson<Board[]>('/boards');
}

export function getBoard(id: number | string): Promise<ApiResult<Board>> {
  return getJson<Board>(`/boards/${encodeURIComponent(String(id))}`);
}

export function getCards(boardId: number | string): Promise<ApiResult<Card[]>> {
  return getJson<Card[]>(
    `/cards?board_id=${encodeURIComponent(String(boardId))}`,
  );
}
