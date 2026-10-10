/**
 * One piece of state per repository, shared by every component that asks.
 *
 * THE STATE IS SHARED, AND THAT IS THE WHOLE POINT.
 *
 * A hook that holds its records in a `useState` of its own gives two
 * components two INDEPENDENT copies of the same data, and a write in one never
 * reaches the other. That is the bug behind "Mark all read leaves the badge
 * showing 9+": the shell's badge and the notifications page each called
 * `useNotifications()`, so marking read updated one copy and left the other
 * saying there were unread notices until the page was reloaded.
 *
 * So the state lives beside the repository instead of inside a component, and
 * every consumer subscribes to it. A WeakMap keyed on the repository object
 * means a new account scope gets fresh state of its own and an abandoned one is
 * collected — there is no cache to invalidate, because there is only ever one
 * copy.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface SharedStore<T> {
  /**
   * A stable snapshot identity, so `useSyncExternalStore` can compare it. It is
   * REPLACED rather than mutated on every publish; mutating in place would
   * leave every consumer rendering the old value forever.
   */
  snapshot: T;
  /** Set once the first load has been kicked off, so it happens once. */
  started: boolean;
  readonly listeners: Set<() => void>;
}

const stores = new WeakMap<object, SharedStore<unknown>>();

/** The one store for this key, created on first use. */
export function storeFor<T>(key: object, initial: () => T): SharedStore<T> {
  const existing = stores.get(key) as SharedStore<T> | undefined;
  if (existing !== undefined) return existing;

  const created: SharedStore<T> = { snapshot: initial(), started: false, listeners: new Set() };
  stores.set(key, created as SharedStore<unknown>);
  return created;
}

/** Publishes a new snapshot to every subscriber. */
export function publish<T>(store: SharedStore<T>, snapshot: T): void {
  store.snapshot = snapshot;
  for (const listener of store.listeners) listener();
}

/**
 * Subscribes to a shared store, kicking off `load` for the first subscriber.
 *
 * Later subscribers join the state that read produced rather than issuing a
 * duplicate query for records already in memory.
 */
export function useShared<T>(store: SharedStore<T>, load: () => Promise<T>): T {
  /*
   * The loader is called at most once per store, and callers build a fresh
   * closure on every render, so it is held in a ref rather than in the
   * subscribe dependency list — otherwise every render would resubscribe.
   */
  const loader = useRef(load);
  loader.current = load;

  const subscribe = useCallback(
    (onChange: () => void) => {
      store.listeners.add(onChange);
      if (!store.started) {
        store.started = true;
        void loader.current().then(
          (loaded) => {
            publish(store, loaded);
          },
          () => {
            /*
             * A failed read publishes what is already there, which STOPS the
             * loading state. Holding a skeleton on screen forever tells the
             * student nothing; the empty state at least says there is nothing
             * here, and the next write will still reach storage.
             */
            publish(store, store.snapshot);
          },
        );
      }
      return () => {
        store.listeners.delete(onChange);
      };
    },
    [store],
  );

  return useSyncExternalStore(
    subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );
}
