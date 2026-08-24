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

import type {
  AttendanceRecord,
  SemesterResult,
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

/**
 * The full set of repositories the app depends on.
 *
 * Supplied through React context so the entire storage layer is swapped in one
 * place. Tests inject an in-memory bundle; a future release injects an
 * API-backed bundle for signed-in students while keeping the local one for
 * anonymous use.
 */
export interface RepositoryBundle {
  readonly profile: StudentProfileRepository;
  readonly attendance: AttendanceRepository;
  readonly results: ResultRepository;
  readonly timetable: TimetableRepository;
}
