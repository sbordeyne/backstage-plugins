/**
 * jsdom has no IntersectionObserver. This stand-in records every instance so a
 * test can drive intersection explicitly instead of waiting on layout.
 */
export class MockIntersectionObserver implements IntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly root: Element | Document | null = null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [0];

  private readonly elements = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.rootMargin = options?.rootMargin ?? '0px';
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

  get observedCount(): number {
    return this.elements.size;
  }

  trigger(isIntersecting = true): void {
    const entries = [...this.elements].map(
      target =>
        ({
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
        } as IntersectionObserverEntry),
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }

  static latest(): MockIntersectionObserver {
    const observer = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
    if (!observer) {
      throw new Error('No IntersectionObserver was created');
    }
    return observer;
  }

  static install(): void {
    MockIntersectionObserver.instances = [];
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockIntersectionObserver;
  }

  static uninstall(): void {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  }
}
