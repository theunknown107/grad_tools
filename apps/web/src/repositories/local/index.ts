/**
 * Local (browser-backed) repository implementations.
 *
 * Authority: docs/33 §33.3 — Stage 1 keeps ALL student data on the device.
 * No network call is made by anything in this file.
 */

import type {
  AttendanceRecord,
  BacklogRecord,
  SemesterRecord,
  SemesterResult,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../../domain/types.js';
import type { NotificationPreferences, NotificationRecord } from '../../domain/notifications.js';
import type { SavedCalendar } from '../../domain/calendar-import.js';
import type { SavedTimetable } from '../../domain/timetable-import.js';
import { normalizeResult } from '../../domain/results.js';
import type {
  NotificationRepository,
  RepositoryBundle,
  StudentProfileRepository,
} from '../types.js';
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
