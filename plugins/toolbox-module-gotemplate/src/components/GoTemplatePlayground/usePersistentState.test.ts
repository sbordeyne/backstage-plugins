import { act, renderHook } from '@testing-library/react';
import { clearPersistedState, usePersistentState } from './usePersistentState';

const STORAGE_KEY = 'gotemplate-playground.v1';

describe('usePersistentState', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts from the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistentState('template', 'hello'));
    expect(result.current[0]).toBe('hello');
  });

  it('restores a previously stored value', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ functionSet: 'helm' }),
    );
    const { result } = renderHook(() => usePersistentState('functionSet', 'sprig'));
    expect(result.current[0]).toBe('helm');
  });

  it('persists updates', () => {
    const { result } = renderHook(() => usePersistentState('functionSet', 'sprig'));
    act(() => result.current[1]('eso'));

    expect(result.current[0]).toBe('eso');
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.functionSet).toBe('eso');
  });

  it('supports updater functions', () => {
    const { result } = renderHook(() => usePersistentState('count', 1));
    act(() => result.current[1](current => current + 1));
    expect(result.current[0]).toBe(2);
  });

  // Every field shares one storage key, so writing one must not drop the others.
  it('does not clobber sibling fields', () => {
    const first = renderHook(() => usePersistentState('functionSet', 'sprig'));
    act(() => first.result.current[1]('helm'));

    const second = renderHook(() => usePersistentState('outputCollapsed', false));
    act(() => second.result.current[1](true));

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored).toMatchObject({ functionSet: 'helm', outputCollapsed: true });
  });

  it('falls back when the stored blob is corrupt', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json');
    const { result } = renderHook(() => usePersistentState('functionSet', 'sprig'));
    expect(result.current[0]).toBe('sprig');
  });

  // Safari's private mode throws on write; losing a draft must not break the UI.
  it('keeps working when storage throws', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    const { result } = renderHook(() => usePersistentState('functionSet', 'sprig'));
    expect(() => act(() => result.current[1]('helm'))).not.toThrow();
    expect(result.current[0]).toBe('helm');

    setItem.mockRestore();
  });

  it('clearPersistedState forgets everything', () => {
    const { result } = renderHook(() => usePersistentState('functionSet', 'sprig'));
    act(() => result.current[1]('helm'));

    clearPersistedState();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
