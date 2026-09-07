/**
 * Data hooks over the repository boundary.
 *
 * These hold loading state and expose mutation helpers. They contain no
 * academic logic whatsoever — every calculated value comes from
 * @gradtools/academic-rules at the point of display (M3 continuation §15).
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type {
  AttendanceRecord,
  BacklogRecord,
  ClassMark,
  SemesterRecord,
  SemesterResult,
  SchemeCourse,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../domain/types.js';
import type { SavedCalendar } from '../domain/calendar-import.js';
import type { SavedTimetable } from '../domain/timetable-import.js';
import { useRepositories } from '../repositories/context.js';

interface ListLike<T> {
  list(): Promise<T[]>;
  upsert(item: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CollectionState<T> {
  readonly items: readonly T[];
  readonly loading: boolean;
  readonly save: (item: T) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* One list per repository, shared by every component that asks for it        */
/* -------------------------------------------------------------------------- */

/**
 * THE STATE IS SHARED, AND THAT IS THE WHOLE POINT.
 *
 * This hook used to hold its records in a `useState` of its own. Two
 * components calling `useResults()` therefore held two INDEPENDENT copies of
 * the same list, and a save in one never reached the other.
 *
 * That is not a subtle inefficiency; it is the bug behind the reported
 * cluster. The import panel and the results page each call `useResults()`, so
 * confirming an import updated the panel's copy, wrote to storage, and left
 * the page behind it showing "No results yet". The dashboard, the degree page
 * and the analytics page were stale in exactly the same way, which is why a
 * student had to reload the browser to see anything they had just imported
 * (Phase 7C §19).
 *
 * So the list lives beside the repository instead of inside a component, and
 * every consumer subscribes to it. A WeakMap keyed on the repository object
 * means a new account scope gets a fresh list on its own and an abandoned one
 * is collected — there is no cache to invalidate, because there is only ever
 * one list.
 */
interface Store<T> {
  items: readonly T[];
  loading: boolean;
  /** Set once the first `list()` has been kicked off, so it happens once. */
  started: boolean;
  readonly listeners: Set<() => void>;
  /** A stable snapshot identity, so `useSyncExternalStore` can compare it. */
  snapshot: CollectionSnapshot<T>;
}

interface CollectionSnapshot<T> {
  readonly items: readonly T[];
  readonly loading: boolean;
}

const stores = new WeakMap<object, Store<never>>();

function storeFor<T extends { readonly id: string }>(repository: ListLike<T>): Store<T> {
  const existing = stores.get(repository) as Store<T> | undefined;
  if (existing !== undefined) return existing;

  const created: Store<T> = {
    items: [],
    loading: true,
    started: false,
    listeners: new Set(),
    snapshot: { items: [], loading: true },
  };
  stores.set(repository, created as unknown as Store<never>);
  return created;
}

/**
 * Publishes a new list to every subscriber.
 *
 * The snapshot object is replaced rather than mutated because
 * `useSyncExternalStore` compares snapshots by identity; mutating in place
 * would leave every consumer rendering the old array forever.
 */
function publish<T>(store: Store<T>, items: readonly T[], loading: boolean): void {
  store.items = items;
  store.loading = loading;
  store.snapshot = { items, loading };
  for (const listener of store.listeners) listener();
}

function useCollection<T extends { readonly id: string }>(
  repository: ListLike<T>,
): CollectionState<T> {
  const store = storeFor(repository);

  const subscribe = useCallback(
    (onChange: () => void) => {
      store.listeners.add(onChange);
      /*
       * The first subscriber triggers the read. Later ones join the list that
       * read produced, rather than issuing a duplicate query for records
       * already in memory (§30).
       */
      if (!store.started) {
        store.started = true;
        void repository.list().then(
          (loaded) => {
            publish(store, loaded, false);
          },
          () => {
            /*
             * A failed read leaves the list empty and STOPS the loading state.
             * Holding a skeleton on screen forever tells the student nothing;
             * the empty state at least says there is nothing here, and the next
             * write will still reach storage.
             */
            publish(store, store.items, false);
          },
        );
      }
      return () => {
        store.listeners.delete(onChange);
      };
    },
    [repository, store],
  );

  const snapshot = useSyncExternalStore(
    subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );

  const save = useCallback(
    async (item: T) => {
      /*
       * Optimistic: local writes are effectively instantaneous, and blocking
       * the input on a storage round-trip makes typing feel laggy. Every
       * consumer sees it at once, because there is one list.
       */
      const index = store.items.findIndex((candidate) => candidate.id === item.id);
      publish(
        store,
        index === -1
          ? [...store.items, item]
          : store.items.map((candidate, position) => (position === index ? item : candidate)),
        store.loading,
      );
      await repository.upsert(item);
    },
    [repository, store],
  );

  const remove = useCallback(
    async (id: string) => {
      publish(
        store,
        store.items.filter((candidate) => candidate.id !== id),
        store.loading,
      );
      await repository.remove(id);
    },
    [repository, store],
  );

  return { items: snapshot.items, loading: snapshot.loading, save, remove };
}

export function useAttendance(): CollectionState<AttendanceRecord> {
  return useCollection(useRepositories().attendance);
}

export function useResults(): CollectionState<SemesterResult> {
  return useCollection(useRepositories().results);
}

export function useTimetable(): CollectionState<TimetableSlot> {
  return useCollection(useRepositories().timetable);
}

export function useSemesters(): CollectionState<SemesterRecord> {
  return useCollection(useRepositories().semesters);
}

export function useSemesterSubjects(): CollectionState<SemesterSubject> {
  return useCollection(useRepositories().semesterSubjects);
}

export function useBacklogs(): CollectionState<BacklogRecord> {
  return useCollection(useRepositories().backlogs);
}

/** Academic calendars a student imported, as structured events (M10A.7). */
export function useCalendars(): CollectionState<SavedCalendar> {
  return useCollection(useRepositories().calendars);
}

/** Which import produced the active timetable, and its revision (M10A.8). */
export function useTimetableImports(): CollectionState<SavedTimetable> {
  return useCollection(useRepositories().timetableImports);
}

/**
 * What the student said happened to a scheduled class (M10A.11).
 *
 * Not an attendance source. Every number still comes from `useAttendance`;
 * this only says which classes have already been answered for.
 */
export function useClassMarks(): CollectionState<ClassMark> {
  return useCollection(useRepositories().classMarks);
}

/**
 * The university's own course table, from a Scheme of Teaching the student
 * imported.
 *
 * The credits tier that works offline (Phase 7C §10). The cloud reference API
 * is the other one, and on a device that has never reached it this is the only
 * one — which is why a result card imported without it could never be graded.
 */
export function useSchemeCourses(): CollectionState<SchemeCourse> {
  return useCollection(useRepositories().schemeCourses);
}

export interface ProfileState {
  readonly profile: StudentProfile | null;
  readonly loading: boolean;
  readonly save: (profile: StudentProfile) => Promise<void>;
}

export function useProfile(): ProfileState {
  const repository = useRepositories().profile;
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void repository.get().then((loaded) => {
      if (!cancelled) {
        setProfile(loaded);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const save = useCallback(
    async (next: StudentProfile) => {
      setProfile(next);
      await repository.save(next);
    },
    [repository],
  );

  return { profile, loading, save };
}
