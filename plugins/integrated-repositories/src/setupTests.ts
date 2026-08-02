import '@testing-library/jest-dom';

/**
 * jsdom has no IntersectionObserver, which the repositories table uses to reveal rows on scroll.
 * The stub records the observed elements and exposes a trigger so tests can simulate scrolling.
 */
class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  readonly elements = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.elements.add(element);
  }

  unobserve(element: Element): void {
    this.elements.delete(element);
  }

  disconnect(): void {
    this.elements.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Reports every observed element as visible. */
  intersect(): void {
    const entries = [...this.elements].map(
      target => ({ target, isIntersecting: true } as unknown as IntersectionObserverEntry),
    );
    if (entries.length > 0) {
      this.callback(entries, this);
    }
  }
}

/** Fires the intersection callback of every live observer, i.e. simulates scrolling to the bottom. */
export function scrollToSentinel(): void {
  for (const instance of MockIntersectionObserver.instances) {
    instance.intersect();
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
});

global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
