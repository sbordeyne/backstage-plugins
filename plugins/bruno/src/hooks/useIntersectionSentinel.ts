import { useEffect, useRef, useState } from 'react';

export interface UseIntersectionSentinelOptions {
  disabled?: boolean;
  rootMargin?: string;
  /**
   * Re-creates the observer when this changes. Pass the current item count:
   * IntersectionObserver only fires on transitions, so if an appended page does
   * not fill the viewport the sentinel stays visible and would never fire again.
   */
  deps?: unknown;
}

/**
 * Returns a ref callback to attach to a sentinel element at the end of a list.
 */
export function useIntersectionSentinel(
  onIntersect: () => void,
  options: UseIntersectionSentinelOptions = {},
): (node: HTMLElement | null) => void {
  const { disabled = false, rootMargin = '600px 0px', deps } = options;

  const callbackRef = useRef(onIntersect);
  callbackRef.current = onIntersect;

  // State rather than a ref: the effect must re-run when the sentinel remounts,
  // which happens every time skeleton rows are swapped for real ones.
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!node || disabled || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          callbackRef.current();
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, disabled, rootMargin, deps]);

  return setNode;
}
