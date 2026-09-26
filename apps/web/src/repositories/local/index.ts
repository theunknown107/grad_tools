/**
 * Local (browser-backed) repository implementations.
 *
 * Authority: docs/33 §33.3 — Stage 1 keeps ALL student data on the device.
 * No network call is made by anything in this file.
 */

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
} from '../../domain/types.js';
import { committed } from '../../domain/attendance.js';
import type { NotificationPreferences, NotificationRecord } from '../../domain/notifications.js';
import type { SavedCalendar } from '../../domain/calendar-import.js';
import type { SavedTimetable } from '../../domain/timetable-import.js';
import type { SavedExamTimetable, StoredExamEvent } from '../../domain/exam-import.js';
import { normalizeResult } from '../../domain/results.js';
import type {
  AttendanceLedgerRepository,
  DayOverrideRepository,
  NotificationRepository,
  RemoteSnapshotRepository,
  RepositoryBundle,
  StudentProfileRepository,
} from '../types.js';
import { runUpgrade } from './upgrade.js';
import { deleteValue, readValue, writeValue, type AccountScope, type StorageKey } from './store.js';

/**
 * Shared list behaviour: read, upsert by id, remove by id.
 *
 * EVERY REPOSITORY IS BOUND TO ONE ACCOUNT SCOPE (M9 §38). The scope is fixed
 * when the bundle is built, so no individual method can be called with the
 * wrong one — two accounts on one browser get two bundles reading two key
 * spaces, and neither can reach the other's.
 */
function createListRepository<T extends { readonly id: string }>(
  scope: AccountScope,
  key: StorageKey,
) {
  return {
    async list(): Promise<T[]> {
      return (await readValue<T[]>(scope, key)) ?? [];
    },
    async upsert(item: T): Promise<void> {
      const items = (await readValue<T[]>(scope, key)) ?? [];
      const index = items.findIndex((candidate) => candidate.id === item.id);
      const next =
        index === -1
          ? [...items, item]
          : items.map((candidate, position) => (position === index ? item : candidate));
      await writeValue(scope, key, next);
    },
    async remove(id: string): Promise<void> {
      const items = (await readValue<T[]>(scope, key)) ?? [];
      await writeValue(
        scope,
        key,
        items.filter((candidate) => candidate.id !== id),
      );
    },
  };
}

/**
 * A list that REFUSES to fail quietly.
 *
 * `createListRepository` drops the result of `writeValue`, which is the right
 * trade for a cache: a counter that failed to persist is re-derived next time.
 * It is the wrong trade for the ledger, where a dropped write is a class the
 * student recorded and the product then denies all knowledge of. This throws
 * instead, so the caller can tell them.
 */
function createDurableRepository<T extends { readonly id: string }>(
  scope: AccountScope,
  key: StorageKey,
  guard?: (existing: readonly T[], next: T | null, id: string) => void,
) {
  const read = async (): Promise<T[]> => (await readValue<T[]>(scope, key)) ?? [];

  const write = async (items: readonly T[]): Promise<void> => {
    const stored = await writeValue(scope, key, items);
    if (!stored) {
      throw new Error(`Could not save ${key} on this device.`);
    }
  };

  return {
    list: read,
    async upsert(item: T): Promise<void> {
      const items = await read();
      guard?.(items, item, item.id);
      const index = items.findIndex((candidate) => candidate.id === item.id);
      await write(
        index === -1
          ? [...items, item]
          : items.map((candidate, position) => (position === index ? item : candidate)),
      );
    },
    async remove(id: string): Promise<void> {
      const items = await read();
      guard?.(items, null, id);
      await write(items.filter((candidate) => candidate.id !== id));
    },
  };
}

/**
 * A committed adjustment is immutable, and the boundary enforces it.
 *
 * Adopting a synced figure gives the student a few seconds to take it back, and
 * that undo is a ROLLBACK of the whole adoption. Once the window has closed the
 * row is part of the audit trail: a later correction is another adjustment, and
 * nothing else in the app — reconciliation, an import, a timetable edit — is
 * allowed to rewrite what the student decided.
 */
function refuseCommittedAdjustment(
  entries: readonly LedgerEntry[],
  next: LedgerEntry | null,
  id: string,
): void {
  const existing = entries.find((entry) => entry.id === id);
  if (existing === undefined || existing.kind !== 'adjustment') return;
  if (!committed(existing)) return;
  void next;
  throw new Error(
    'This attendance adjustment has been committed and cannot be changed. Record a new one instead.',
  );
}

/**
 * The repository bundle for one account scope.
 *
 * `scope === null` is the signed-out student, whose data is as real and as
 * durable as anybody's — it is simply stored under its own prefix and offered
 * for merge if they later create an account (M9 §27).
 */
export function createLocalRepositories(scope: AccountScope): RepositoryBundle {
  const profile: StudentProfileRepository = {
    async get() {
      return readValue<StudentProfile>(scope, 'profile');
    },
    async save(record) {
      await writeValue(scope, 'profile', record);
    },
    async clear() {
      await deleteValue(scope, 'profile');
    },
  };

  const notifications: NotificationRepository = {
    async listStates() {
      return (await readValue<NotificationRecord[]>(scope, 'notificationState')) ?? [];
    },
    async saveStates(records) {
      await writeValue(scope, 'notificationState', [...records]);
    },
    async getPreferences() {
      return readValue<NotificationPreferences>(scope, 'notificationPreferences');
    },
    async savePreferences(preferences) {
      await writeValue(scope, 'notificationPreferences', preferences);
    },
  };

  /*
   * RESULTS ARE NORMALISED ON READ (OQ-049).
   *
   * A row saved before the marks fields existed carries `undefined` where the
   * type now says `number | null`, and IndexedDB type-checks nothing. Doing this
   * at the storage boundary rather than in a component means every reader —
   * pages, hooks and the sync collector alike — sees one shape.
   */
  const results = createListRepository<SemesterResult>(scope, 'results');

  /*
   * THE UPGRADE RUNS ONCE, LAZILY, AND EVERY LEDGER READ WAITS FOR IT.
   *
   * `createLocalRepositories` is synchronous — it is called during render — so
   * the v0 -> v1 upgrade cannot happen here. It is kicked off by the first
   * ledger access instead and memoised, so twenty components asking for the
   * ledger at once produce one upgrade, and none of them can observe the
   * half-migrated state in between.
   */
  let upgraded: Promise<number> | null = null;
  const ensureUpgraded = (): Promise<number> => {
    upgraded ??= runUpgrade(scope);
    return upgraded;
  };

  const ledger = createDurableRepository<LedgerEntry>(
    scope,
    'attendanceLedger',
    refuseCommittedAdjustment,
  );
  const overrides = createDurableRepository<DayOverride>(scope, 'timetableOverrides');
  const snapshots = createDurableRepository<RemoteSnapshot>(scope, 'remoteSnapshots');

  const afterUpgrade = <T extends { readonly id: string }>(
    repository: ReturnType<typeof createDurableRepository<T>>,
  ) => ({
    async list() {
      await ensureUpgraded();
      return repository.list();
    },
    async upsert(item: T) {
      await ensureUpgraded();
      return repository.upsert(item);
    },
    async remove(id: string) {
      await ensureUpgraded();
      return repository.remove(id);
    },
  });

  return {
    profile,
    attendance: createListRepository<AttendanceRecord>(scope, 'attendance'),
    results: {
      ...results,
      async list() {
        return (await results.list()).map(normalizeResult);
      },
    },
    timetable: createListRepository<TimetableSlot>(scope, 'timetable'),
    semesters: createListRepository<SemesterRecord>(scope, 'semesters'),
    semesterSubjects: createListRepository<SemesterSubject>(scope, 'semesterSubjects'),
    backlogs: createListRepository<BacklogRecord>(scope, 'backlogs'),
    calendars: createListRepository<SavedCalendar>(scope, 'calendars'),
    timetableImports: createListRepository<SavedTimetable>(scope, 'timetableImports'),
    attendanceLedger: afterUpgrade<LedgerEntry>(ledger) satisfies AttendanceLedgerRepository,
    timetableOverrides: afterUpgrade<DayOverride>(overrides) satisfies DayOverrideRepository,
    remoteSnapshots: afterUpgrade<RemoteSnapshot>(snapshots) satisfies RemoteSnapshotRepository,
    schemeCourses: createListRepository<SchemeCourse>(scope, 'schemeCourses'),
    /*
     * Exam time tables are their own two collections, kept apart from the
     * weekly timetable for the reason the domain is: one is a recurring week,
     * the other a handful of dated events (domain/exam-import).
     */
    examTimetables: createListRepository<SavedExamTimetable>(scope, 'examTimetables'),
    examEvents: createListRepository<StoredExamEvent>(scope, 'examEvents'),
    notifications,
  };
}

/**
 * The signed-out bundle.
 *
 * Kept as the default export shape because it is what the app uses before
 * anyone signs in, and what it returns to after a sign-out.
 */
export const localRepositories: RepositoryBundle = createLocalRepositories(null);
