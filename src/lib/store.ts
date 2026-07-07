import { useEffect, useReducer } from 'preact/hooks';

export interface Store<T> {
  get(): T;
  set(v: T): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
}

export function useStore<T>(store: Store<T>): T {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.subscribe(() => force(0)), [store]);
  return store.get();
}
