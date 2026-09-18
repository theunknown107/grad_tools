/**
 * Data hooks over the repository boundary.
 *
 * These hold loading state and expose mutation helpers. They contain no
 * academic logic whatsoever — every calculated value comes from
 * @gradtools/academic-rules at the point of display (M3 continuation §15).
 */

import { useCallback, useEffect, useState } from 'react';
import { publish, storeFor, useShared } from './shared-store.js';
import type {
  AttendanceRecord,
  BacklogRecord,
  DayOverride,
  LedgerEntry,
  RemoteSnapshot,
  SemesterRecord,
  SemesterResult,
  SchemeCourse,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../domain/types.js';
import type { SavedCalendar } from '../domain/calendar-import.js';
import type { SavedTimetable } from '../domain/timetable-import.js';
import type { SavedExamTimetable, StoredExamEvent } from '../domain/exam-import.js';
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
 * The list lives beside the repository, not inside a component.
 *
 * Two components calling `useResults()` used to hold two INDEPENDENT copies of
 * the same list, so a save in one never reached the other: confirming an import
 * updated the panel's copy, wrote to storage, and left the page behind it
 * showing "No results yet" (Phase 7C §19). `shared-store.ts` holds the one copy
 * every consumer subscribes to; see its comment for why.
 */
interface CollectionSnapshot<T> {
  readonly items: readonly T[];
  readonly loading: boolean;
}

const EMPTY = { items: [], loading: true };

function useCollection<T extends { readonly id: string }>(
  repository: ListLike<T>,
): CollectionState<T> {
  const store = storeFor<CollectionSnapshot<T>>(repository, () => EMPTY);

  const snapshot = useShared(store, async () => ({
    items: await repository.list(),
    loading: false,
  }));

  const save = useCallback(
    async (item: T) => {
      /*
       * Optimistic: local writes are effectively instantaneous, and blocking
       * the input on a storage round-trip makes typing feel laggy. Every
       * consumer sees it at once, because there is one list.
       */
      const { items, loading } = store.snapshot;
      const index = items.findIndex((candidate) => candidate.id === item.id);
      publish(store, {
        items:
          index === -1
            ? [...items, item]
            : items.map((candidate, position) => (position === index ? item : candidate)),
        loading,
      });
      await repository.upsert(item);
    },
    [repository, store],
  );

  const remove = useCallback(
    async (id: string) => {
      publish(store, {
        items: store.snapshot.items.filter((candidate) => candidate.id !== id),
        loading: store.snapshot.loading,
      });
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
 * The attendance ledger: openings, per-class occurrences and adjustments.
 *
 * THE AUTHORITY behind every attendance figure on a device that has upgraded.
 * `useAttendance` above is the derived cache of this (domain/attendance
 * `deriveCounts`), which is why nothing outside the marking path writes to it.
 */
export function useAttendanceLedger(): CollectionState<LedgerEntry> {
  return useCollection(useRepositories().attendanceLedger);
}

/** What one date did to the recurring week. Device-local (see AccountPage). */
export function useTimetableOverrides(): CollectionState<DayOverride> {
  return useCollection(useRepositories().timetableOverrides);
}

/** Synced aggregates seen and not adopted. Never a fact until the student says. */
export function useRemoteSnapshots(): CollectionState<RemoteSnapshot> {
  return useCollection(useRepositories().remoteSnapshots);
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

/** Exam time tables the student supplied, and the exams read out of them. */
export function useExamTimetables(): CollectionState<SavedExamTimetable> {
  return useCollection(useRepositories().examTimetables);
}

export function useExamEvents(): CollectionState<StoredExamEvent> {
  return useCollection(useRepositories().examEvents);
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
