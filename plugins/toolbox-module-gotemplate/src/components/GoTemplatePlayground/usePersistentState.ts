import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Everything the playground remembers is namespaced under one key, so clearing
 * it is a single operation and it cannot collide with other toolbox tools.
 */
const STORAGE_KEY = 'gotemplate-playground.v1';

/**
 * A `useState` that survives reloads and navigating away from the tool.
 *
 * Storage is deliberately best-effort: Safari's private mode throws on write,
 * and some deployments disable it altogether. A playground losing its draft is
 * an annoyance, not a reason to fail to render, so every access is guarded.
 */
export function usePersistentState<T>(
  field: string,
  initial: T,
): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readField(field, initial));

  // Persist on change rather than on every set call, so a burst of keystrokes
  // collapses into a single write per render.
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    writeField(field, latest.current);
  }, [field, value]);

  const set = useCallback((next: T | ((current: T) => T)) => {
    setValue(current =>
      typeof next === 'function' ? (next as (c: T) => T)(current) : next,
    );
  }, []);

  return [value, set];
}

function readAll(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function readField<T>(field: string, fallback: T): T {
  const stored = readAll()[field];
  return stored === undefined ? fallback : (stored as T);
}

function writeField(field: string, value: unknown): void {
  try {
    const all = readAll();
    all[field] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full, disabled or unavailable — the tool still works, it just
    // will not remember anything.
  }
}

/** Forgets every remembered value, used by the "reset" action. */
export function clearPersistedState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above: nothing to do if storage is unavailable.
  }
}
