import { act, render } from '@testing-library/react';

import { MockIntersectionObserver } from '../testing/MockIntersectionObserver';
import { useIntersectionSentinel } from './useIntersectionSentinel';

function Sentinel(props: { onIntersect: () => void; disabled?: boolean; deps?: unknown }) {
  const ref = useIntersectionSentinel(props.onIntersect, { disabled: props.disabled, deps: props.deps });
  return <div ref={ref} data-testid="sentinel" />;
}

describe('useIntersectionSentinel', () => {
  it('invokes the callback when the sentinel intersects', () => {
    const onIntersect = jest.fn();
    render(<Sentinel onIntersect={onIntersect} />);

    act(() => MockIntersectionObserver.latest().trigger());

    expect(onIntersect).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback when the sentinel leaves the viewport', () => {
    const onIntersect = jest.fn();
    render(<Sentinel onIntersect={onIntersect} />);

    act(() => MockIntersectionObserver.latest().trigger(false));

    expect(onIntersect).not.toHaveBeenCalled();
  });

  it('uses a lookahead margin so the next page starts before the bottom', () => {
    render(<Sentinel onIntersect={jest.fn()} />);

    expect(MockIntersectionObserver.latest().rootMargin).toBe('600px 0px');
  });

  it('observes nothing while disabled', () => {
    render(<Sentinel onIntersect={jest.fn()} disabled />);

    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('re-creates the observer when deps change', () => {
    const { rerender } = render(<Sentinel onIntersect={jest.fn()} deps={1} />);
    const first = MockIntersectionObserver.instances.length;

    rerender(<Sentinel onIntersect={jest.fn()} deps={2} />);

    // A page that does not fill the viewport would otherwise never fire again.
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(first);
  });

  it('disconnects on unmount', () => {
    const { unmount } = render(<Sentinel onIntersect={jest.fn()} />);
    const observer = MockIntersectionObserver.latest();

    unmount();

    expect(observer.observedCount).toBe(0);
  });

  it('mounts without throwing when IntersectionObserver is unavailable', () => {
    MockIntersectionObserver.uninstall();
    const onIntersect = jest.fn();

    expect(() => render(<Sentinel onIntersect={onIntersect} />)).not.toThrow();
    expect(onIntersect).not.toHaveBeenCalled();
  });
});
