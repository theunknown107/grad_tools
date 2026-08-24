/**
 * Data hooks over the repository boundary.
 *
 * These hold loading state and expose mutation helpers. They contain no
 * academic logic whatsoever — every calculated value comes from
 * @gradtools/academic-rules at the point of display (M3 continuation §15).
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  AttendanceRecord,
  SemesterResult,
  StudentProfile,
  TimetableSlot,
} from '../domain/types.js';
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

function useCollection<T extends { readonly id: string }>(
  repository: ListLike<T>,
): CollectionState<T> {
  const [items, setItems] = useState<readonly T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void repository.list().then((loaded) => {
      if (!cancelled) {
        setItems(loaded);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const save = useCallback(
    async (item: T) => {
      // Optimistic: local writes are effectively instantaneous, and blocking
      // the input on a storage round-trip makes typing feel laggy.
      setItems((current) => {
        const index = current.findIndex((candidate) => candidate.id === item.id);
        return index === -1
          ? [...current, item]
          : current.map((candidate, position) => (position === index ? item : candidate));
      });
      await repository.upsert(item);
    },
    [repository],
  );

  const remove = useCallback(
    async (id: string) => {
      setItems((current) => current.filter((candidate) => candidate.id !== id));
      await repository.remove(id);
    },
    [repository],
  );

  return { items, loading, save, remove };
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
