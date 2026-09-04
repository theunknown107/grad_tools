/**
 * Repository interfaces — the storage boundary.
 *
 * Authority: docs/33 §33.3, M3 continuation §6, §21, §22.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE ASYNC IN A LOCAL-FIRST APP
 * ---------------------------------------------------------------------------
 *
 * Stage 1 stores everything in the browser and makes no network call. A
 * synchronous localStorage API would be simpler today — and would force every
 * caller to be rewritten the day an API-backed repository arrives, because
 * that one is unavoidably async.
 *
 * Async from the start means the future swap is genuinely a swap:
 *
 *   Stage 1:  React -> RepositoryBundle -> LocalRepository -> IndexedDB
 *   Later:    React -> RepositoryBundle -> ApiRepository   -> Express -> Postgres
 *
 * This is not architecture theatre: there are no fake network calls, no
 * pretend latency, and no server code. The application is genuinely
 * local-first. Only the shape of the boundary anticipates the change.
 *
 * ---------------------------------------------------------------------------
 * WHAT REPOSITORIES DO NOT DO
 * ---------------------------------------------------------------------------
 *
 * They persist and retrieve. They never calculate. Every academic value comes
 * from @gradtools/academic-rules so that local and future server modes cannot
 * drift apart (M3 continuation §6). A repository that computed an SGPA would
 * be a second implementation of the domain.
 */

import type { SavedCalendar } from '../domain/calendar-import.js';
import type { NotificationPreferences, NotificationRecord } from '../domain/notifications.js';
import type {
  AttendanceRecord,
  BacklogRecord,
  SemesterRecord,
  SemesterResult,
  SemesterSubject,
  StudentProfile,
  TimetableSlot,
} from '../domain/types.js';

export interface StudentProfileRepository {
  get(): Promise<StudentProfile | null>;
  save(profile: StudentProfile): Promise<void>;
  clear(): Promise<void>;
}

export interface AttendanceRepository {
  list(): Promise<AttendanceRecord[]>;
  upsert(record: AttendanceRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ResultRepository {
  list(): Promise<SemesterResult[]>;
  upsert(result: SemesterResult): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface TimetableRepository {
  list(): Promise<TimetableSlot[]>;
  upsert(slot: TimetableSlot): Promise<void>;
  remove(id: string): Promise<void>;
}

/* -- The eight-semester degree (M6). Same shape, same boundary. ------------ */

export interface SemesterRepository {
  list(): Promise<SemesterRecord[]>;
  upsert(record: SemesterRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SemesterSubjectRepository {
  list(): Promise<SemesterSubject[]>;
  upsert(subject: SemesterSubject): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface BacklogRepository {
  list(): Promise<BacklogRecord[]>;
  upsert(record: BacklogRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * Read state and notification preferences (M7).
 *
 * BOTH STAY ON THE DEVICE. There is no server notification table and no
 * preferences endpoint: "have I read this" is the student's business, and a
 * service that never learns it cannot leak it (M7 §40).
 *
 * Not a list repository — the whole set is read and written at once, because
 * marking everything read is one operation rather than N.
 */
export interface NotificationRepository {
  listStates(): Promise<NotificationRecord[]>;
  saveStates(records: readonly NotificationRecord[]): Promise<void>;
  getPreferences(): Promise<NotificationPreferences | null>;
  savePreferences(preferences: NotificationPreferences): Promise<void>;
}

/**
 * The full set of repositories the app depends on.
 *
 * Supplied through React context so the entire storage layer is swapped in one
 * place. Tests inject an in-memory bundle; a future release injects an
 * API-backed bundle for signed-in students while keeping the local one for
 * anonymous use.
 */
/**
 * Saved academic calendars (M10A.7).
 *
 * A LIST, not a single record, because the same term can be reissued: a
 * revision and the calendar it replaces are both facts, and which one is
 * active is a question the student answers rather than one storage settles by
 * overwriting.
 */
export interface CalendarRepository {
  list(): Promise<SavedCalendar[]>;
  upsert(calendar: SavedCalendar): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface RepositoryBundle {
  readonly profile: StudentProfileRepository;
  readonly attendance: AttendanceRepository;
  readonly results: ResultRepository;
  readonly timetable: TimetableRepository;
  readonly semesters: SemesterRepository;
  readonly semesterSubjects: SemesterSubjectRepository;
  readonly backlogs: BacklogRepository;
  readonly notifications: NotificationRepository;
  readonly calendars: CalendarRepository;
}
