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
import type {
  AttendanceRepository,
  BacklogRepository,
  RepositoryBundle,
  ResultRepository,
  SemesterRepository,
  SemesterSubjectRepository,
  StudentProfileRepository,
  TimetableRepository,
} from '../types.js';
import { deleteValue, readValue, writeValue, type StorageKey } from './store.js';

/** Shared list behaviour: read, upsert by id, remove by id. */
function createListRepository<T extends { readonly id: string }>(key: StorageKey) {
  return {
    async list(): Promise<T[]> {
      return (await readValue<T[]>(key)) ?? [];
    },
    async upsert(item: T): Promise<void> {
      const items = (await readValue<T[]>(key)) ?? [];
      const index = items.findIndex((candidate) => candidate.id === item.id);
      const next =
        index === -1
          ? [...items, item]
          : items.map((candidate, position) => (position === index ? item : candidate));
      await writeValue(key, next);
    },
    async remove(id: string): Promise<void> {
      const items = (await readValue<T[]>(key)) ?? [];
      await writeValue(
        key,
        items.filter((candidate) => candidate.id !== id),
      );
    },
  };
}

export const localProfileRepository: StudentProfileRepository = {
  async get() {
    return readValue<StudentProfile>('profile');
  },
  async save(profile) {
    await writeValue('profile', profile);
  },
  async clear() {
    await deleteValue('profile');
  },
};

export const localAttendanceRepository: AttendanceRepository =
  createListRepository<AttendanceRecord>('attendance');

export const localResultRepository: ResultRepository =
  createListRepository<SemesterResult>('results');

export const localTimetableRepository: TimetableRepository =
  createListRepository<TimetableSlot>('timetable');

export const localSemesterRepository: SemesterRepository =
  createListRepository<SemesterRecord>('semesters');

export const localSemesterSubjectRepository: SemesterSubjectRepository =
  createListRepository<SemesterSubject>('semesterSubjects');

export const localBacklogRepository: BacklogRepository =
  createListRepository<BacklogRecord>('backlogs');

export const localRepositories: RepositoryBundle = {
  profile: localProfileRepository,
  attendance: localAttendanceRepository,
  results: localResultRepository,
  timetable: localTimetableRepository,
  semesters: localSemesterRepository,
  semesterSubjects: localSemesterSubjectRepository,
  backlogs: localBacklogRepository,
};
