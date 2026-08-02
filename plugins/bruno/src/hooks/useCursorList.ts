import { useCallback, useEffect, useRef, useState } from 'react';

export interface CursorPageResult<T> {
  items: T[];
  nextCursor?: string;
  totalCount?: number;
}

export type CursorFetcher<T> = (args: {
  cursor?: string;
  limit: number;
  signal: AbortSignal;
}) => Promise<CursorPageResult<T>>;

export interface UseCursorListOptions {
  /** Changing this resets the list. Use the id whose data is being listed. */
  key: string;
  limit?: number;
  enabled?: boolean;
}

export interface CursorList<T> {
  items: T[];
  totalCount?: number;
  error?: Error;
  hasMore: boolean;
  loading: boolean;
  /** True only while the very first page of the current key is in flight. */
  initialLoading: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State<T> {
  key: string;
  items: T[];
  cursor?: string;
  totalCount?: number;
  hasMore: boolean;
  loading: boolean;
  error?: Error;
}

function initialState<T>(key: string): State<T> {
  return { key, items: [], cursor: undefined, totalCount: undefined, hasMore: true, loading: true, error: undefined };
}

export function useCursorList<T>(fetchPage: CursorFetcher<T>, options: UseCursorListOptions): CursorList<T> {
  const { key, limit = 50, enabled = true } = options;

  // Callers pass inline arrow functions; without this the list would reset on
  // every parent render.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const [state, setState] = useState<State<T>>(() => initialState<T>(key));

  // Reset during render rather than in an effect, so a key change never paints
  // the previous key's rows.
  const current = state.key === key ? state : initialState<T>(key);
  if (current !== state) {
    setState(current);
  }

  // Invalidates responses belonging to a superseded key or mount. Together with
  // the in-flight guard this makes StrictMode's double-invoke harmless.
  const generation = useRef(0);
  const inFlight = useRef(false);
  const abortController = useRef<AbortController>();

  const load = useCallback(
    (cursor: string | undefined, replace: boolean) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      const myGeneration = ++generation.current;
      const controller = new AbortController();
      abortController.current = controller;
      setState(previous => ({ ...previous, loading: true, error: undefined }));

      fetchRef.current({ cursor, limit, signal: controller.signal }).then(
        page => {
          if (myGeneration !== generation.current) {
            return;
          }
          inFlight.current = false;
          setState(previous => ({
            ...previous,
            items: replace ? page.items : previous.items.concat(page.items),
            cursor: page.nextCursor,
            totalCount: page.totalCount ?? previous.totalCount,
            hasMore: Boolean(page.nextCursor),
            loading: false,
          }));
        },
        error => {
          if (myGeneration !== generation.current) {
            return;
          }
          inFlight.current = false;
          setState(previous => ({ ...previous, loading: false, error: error as Error }));
        },
      );
    },
    [limit],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    load(undefined, true);
    return () => {
      // These refs are plain counters/handles, not React-rendered nodes, and the
      // cleanup must mutate the shared values so a late response is discarded —
      // which is exactly what the rule's "copy it to a local" advice would break.
      /* eslint-disable react-hooks/exhaustive-deps */
      generation.current++;
      inFlight.current = false;
      abortController.current?.abort();
      /* eslint-enable react-hooks/exhaustive-deps */
    };
  }, [key, enabled, load]);

  const loadMore = useCallback(() => {
    // Read the cursor from committed state, not from a stale closure.
    setState(previous => {
      if (previous.loading || !previous.hasMore || inFlight.current) {
        return previous;
      }
      queueMicrotask(() => load(previous.cursor, false));
      return previous;
    });
  }, [load]);

  const reload = useCallback(() => {
    generation.current++;
    inFlight.current = false;
    abortController.current?.abort();
    setState(initialState<T>(key));
    load(undefined, true);
  }, [key, load]);

  return {
    items: current.items,
    totalCount: current.totalCount,
    error: current.error,
    hasMore: current.hasMore,
    loading: current.loading,
    initialLoading: current.loading && current.items.length === 0,
    loadMore,
    reload,
  };
}
