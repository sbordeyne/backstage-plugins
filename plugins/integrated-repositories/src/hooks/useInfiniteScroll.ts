import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInfiniteScrollOptions {
  /** How many items to reveal initially and on each extension. */
  pageSize: number;
  /** Total number of items available after filtering. */
  totalCount: number;
  /**
   * Value that identifies the current result set. When it changes the list scrolls back to the
   * first page, so applying a filter never leaves the user deep in a stale offset.
   */
  resetKey: string;
}

export interface UseInfiniteScrollResult {
  /** How many items should currently be rendered. */
  visibleCount: number;
  /** Attach to an element rendered after the list; entering the viewport reveals the next page. */
  sentinelRef: (element: HTMLElement | null) => void;
  hasMore: boolean;
  /** Reveals the next page directly, for environments without an IntersectionObserver. */
  showMore: () => void;
}

/**
 * Reveals a long list incrementally as the sentinel scrolls into view.
 *
 * `@backstage/ui`'s `Table` has no infinite scroll and does not expose its scroll container, so the
 * sentinel is observed against the viewport and the caller owns the slicing.
 */
export function useInfiniteScroll(options: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const { pageSize, totalCount, resetKey } = options;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const observerRef = useRef<IntersectionObserver | undefined>(undefined);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [resetKey, pageSize]);

  const hasMore = visibleCount < totalCount;

  const showMore = useCallback(() => {
    setVisibleCount(current => Math.min(current + pageSize, totalCount));
  }, [pageSize, totalCount]);

  const sentinelRef = useCallback(
    (element: HTMLElement | null) => {
      observerRef.current?.disconnect();

      // Guard the API itself: jsdom and older browsers do not provide it, and a missing observer
      // must degrade to a still-usable list rather than throwing.
      if (!element || !hasMore || typeof IntersectionObserver === 'undefined') {
        return;
      }

      observerRef.current = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          showMore();
        }
      });
      observerRef.current.observe(element);
    },
    [hasMore, showMore],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { visibleCount, sentinelRef, hasMore, showMore };
}
