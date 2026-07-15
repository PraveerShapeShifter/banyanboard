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
 * The rules module's coded `400`/`404` body (a deliberate divergence from the
 * `{error,details}` shape cards/boards use): `{ code, message, details? }` with
 * `details:[{field,error}]`. A form maps `details[].field` to inline errors.
 */
export interface CodedError {
  code: string;
  message: string;
  details?: { field: string; error: string }[];
}

/**
 * Result of a mutation (`POST`/`PATCH`/`DELETE`). Richer than {@link ApiResult}
 * because it must carry the coded validation body the read path never sees: a
 * `400`/`404` whose JSON body has a `code` becomes `kind:'validation'`; any
 * other non-2xx is `kind:'http'`; a transport failure is `kind:'network'`.
 */
export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'validation'; error: CodedError }
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

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
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

/**
 * The single mutation seam (TASK-006 Phase 4): the only place `POST`/`PATCH`/
 * `DELETE` are issued, mirroring `getJson`'s fetch-confinement. A `400`/`404`
 * whose body is a coded `{code,...}` envelope is surfaced as `kind:'validation'`
 * so a caller can map `details[].field` to inline field errors; anything else
 * non-2xx is `kind:'http'`. A `204` (or any empty 2xx body) resolves `data`
 * as `undefined` — callers of `DELETE` use `MutationResult<void>`.
 */
export async function mutateJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<MutationResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, kind: 'network', error };
  }

  if (!response.ok) {
    // A coded body (`{code,message,details?}`) drives inline field errors; a
    // non-coded / unparseable body falls back to a generic http failure.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { code?: unknown }).code === 'string'
    ) {
      return { ok: false, kind: 'validation', error: parsed as CodedError };
    }
    return { ok: false, kind: 'http', status: response.status };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch {
    // A 2xx with an empty/unparseable body (e.g. some DELETEs) — treat as an
    // empty success rather than a transport failure.
    return { ok: true, data: undefined as T };
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
