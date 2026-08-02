import { act, renderHook, waitFor } from '@testing-library/react';

import { CursorFetcher, useCursorList } from './useCursorList';

interface Item {
  id: number;
}

function pagedFetcher(pages: Array<{ items: Item[]; nextCursor?: string }>) {
  const calls: Array<string | undefined> = [];
  const fetcher: CursorFetcher<Item> = async ({ cursor }) => {
    calls.push(cursor);
    const index = cursor === undefined ? 0 : Number(cursor);
    return pages[index] ?? { items: [] };
  };
  return { fetcher, calls };
}

describe('useCursorList', () => {
  it('loads the first page', async () => {
    const { fetcher } = pagedFetcher([{ items: [{ id: 1 }, { id: 2 }], nextCursor: '1' }]);

    const { result } = renderHook(() => useCursorList(fetcher, { key: 'run-1', limit: 2 }));

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
    expect(result.current.initialLoading).toBe(false);
  });

  it('appends the next page using the previous cursor', async () => {
    const { fetcher, calls } = pagedFetcher([{ items: [{ id: 1 }], nextCursor: '1' }, { items: [{ id: 2 }] }]);
    const { result } = renderHook(() => useCursorList(fetcher, { key: 'run-1', limit: 1 }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(calls).toEqual([undefined, '1']);
    expect(result.current.hasMore).toBe(false);
  });

  it('issues one request for two synchronous loadMore calls', async () => {
    const { fetcher, calls } = pagedFetcher([
      { items: [{ id: 1 }], nextCursor: '1' },
      { items: [{ id: 2 }], nextCursor: '2' },
    ]);
    const { result } = renderHook(() => useCursorList(fetcher, { key: 'run-1', limit: 1 }));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(calls).toEqual([undefined, '1']);
  });

  it('clears items synchronously when the key changes', async () => {
    const { fetcher } = pagedFetcher([{ items: [{ id: 1 }], nextCursor: '1' }]);
    const { result, rerender } = renderHook(({ key }) => useCursorList(fetcher, { key, limit: 1 }), {
      initialProps: { key: 'run-1' },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ key: 'run-2' });

    // No stale flash of the previous run's rows.
    expect(result.current.items).toEqual([]);
    expect(result.current.initialLoading).toBe(true);
  });

  it('ignores a response from a superseded key', async () => {
    const resolvers: Array<(value: { items: Item[] }) => void> = [];
    const fetcher: CursorFetcher<Item> = () =>
      new Promise(resolve => {
        resolvers.push(resolve);
      });

    const { result, rerender } = renderHook(({ key }) => useCursorList(fetcher, { key, limit: 1 }), {
      initialProps: { key: 'run-1' },
    });
    rerender({ key: 'run-2' });

    // Resolve the first (now superseded) request last.
    await act(async () => {
      resolvers[1]({ items: [{ id: 22 }] });
      resolvers[0]({ items: [{ id: 11 }] });
    });

    await waitFor(() => expect(result.current.items).toEqual([{ id: 22 }]));
  });

  it('aborts the in-flight request on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetcher: CursorFetcher<Item> = async ({ signal }) => {
      capturedSignal = signal;
      return { items: [] };
    };
    const { unmount } = renderHook(() => useCursorList(fetcher, { key: 'run-1' }));
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });

  it('surfaces a fetch error', async () => {
    const fetcher: CursorFetcher<Item> = async () => {
      throw new Error('boom');
    };

    const { result } = renderHook(() => useCursorList(fetcher, { key: 'run-1' }));

    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });

  it('does not fetch while disabled', async () => {
    const fetcher = jest.fn();

    renderHook(() => useCursorList(fetcher as unknown as CursorFetcher<Item>, { key: 'run-1', enabled: false }));

    expect(fetcher).not.toHaveBeenCalled();
  });
});
