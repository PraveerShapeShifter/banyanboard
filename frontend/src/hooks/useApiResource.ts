import { useCallback, useEffect, useState } from 'react';
import type { ApiResult } from '../api/client';

/**
 * Render-friendly state machine for a single async API read. Maps the client's
 * discriminated {@link ApiResult} into loading / success / error, and exposes a
 * `reload` for retry. Modeling each page's fetch as one state value (rather than
 * ad-hoc booleans) mechanically enforces "never show stale/blank content while
 * pending" (AC-ASYNC-1) — the page render is a switch over `state.status`.
 */
export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; kind: 'http' | 'network'; httpStatus?: number };

export function useApiResource<T>(
  fetcher: () => Promise<ApiResult<T>>,
  deps: unknown[] = [],
): { state: ResourceState<T>; reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetcher().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ status: 'success', data: result.data });
      } else {
        setState({
          status: 'error',
          kind: result.kind,
          httpStatus: result.kind === 'http' ? result.status : undefined,
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // `fetcher` is an inline closure (fresh each render); re-run only on mount,
    // on retry (nonce), or when a caller-provided dependency (e.g. board id) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { state, reload };
}
