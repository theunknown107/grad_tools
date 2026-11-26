/**
 * Record-level contracts for a local backup (docs/51 "Record contracts").
 *
 * IndexedDB checks nothing, so before this a restore trusted every record in a
 * file. Each contract below was taken from what the app actually WRITES and
 * READS for that collection (the writers in features/ and hooks/, the v1
 * upgrade, `normalizeResultSubject`), not from the TypeScript types alone. They
 * differ in places that matter: a result's status letter is stored as printed,
 * so it is NOT checked against RESULT_STATUSES; `profileId` is often the literal
 * 'local', so it is NOT required to match the profile; and fields that older
 * versions never wrote are allowed to be absent.
 *
 * THE RULES, ONE PLACE:
 *
 * - Required fields must be present with the right type.
 * - A nullable field may be null, absent (older records), or the right type.
 * - Fields not listed are kept as they are: an older version may have written a
 *   field this one no longer reads, and dropping it would change the data.
 * - Enums, ISO dates ('YYYY-MM-DD'), 24-hour times ('HH:MM'), timestamps,
 *   semester numbers and derived ids are checked where every writer guarantees
 *   them.
 * - Within a file: ids are unique per collection, and every exam event belongs
 *   to an exam timetable in the same file.
 *
 * Pure: no storage, no network. Returns the first problem found, or null.
 */

import { announcementCategorySchema } from '@gradtools/shared-types';
import { NOTIFICATION_STATES } from '../../domain/notifications.js';
import { ATTEMPT_KINDS, WEEKDAYS } from '../../domain/types.js';
import type { StorageKey } from './store.js';

/** A check returns a description of what is wrong, or null. */
type Check = (value: unknown) => string | null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

const text: Check = (value) => (typeof value === 'string' ? null : 'is not text');
const idText: Check = (value) =>
  typeof value === 'string' && value.trim() !== '' ? null : 'is not a valid identifier';
const bool: Check = (value) => (typeof value === 'boolean' ? null : 'is not true or false');
const finite: Check = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? null : 'is not a number';
const isoDate: Check = (value) =>
  typeof value === 'string' && ISO_DATE.test(value) ? null : 'is not a date (YYYY-MM-DD)';
const hhmm: Check = (value) =>
  typeof value === 'string' && HH_MM.test(value) ? null : 'is not a time (HH:MM)';
const timestamp: Check = (value) =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'is not a timestamp';

function integer(min: number, max = Number.MAX_SAFE_INTEGER): Check {
  return (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? null
      : max === Number.MAX_SAFE_INTEGER
        ? `is not a whole number of at least ${String(min)}`
        : `is not a whole number from ${String(min)} to ${String(max)}`;
}

const semesterNumber = integer(1, 8);

function oneOf(allowed: readonly (string | number)[]): Check {
  return (value) =>
    allowed.includes(value as string | number) ? null : `is not one of ${allowed.join(', ')}`;
}

/** Null, absent (an older record), or `check`. */
function nullable(check: Check): Check {
  return (value) => (value === null || value === undefined ? null : check(value));
}

/** Absent (an older record) or `check`. Null is not accepted unless `check` takes it. */
function optional(check: Check): Check {
  return (value) => (value === undefined ? null : check(value));
}

function listOf(check: Check): Check {
  return (value) => {
    if (!Array.isArray(value)) return 'is not a list';
    for (const [index, item] of value.entries()) {
      const problem = check(item);
      if (problem !== null) return `item ${String(index + 1)} ${problem}`;
    }
    return null;
  };
}

type Shape = Readonly<Record<string, Check>>;

function shape(fields: Shape, extra?: (record: Record<string, unknown>) => string | null): Check {
  return (value) => {
    if (!isObject(value)) return 'is not a record';
    for (const [field, check] of Object.entries(fields)) {
      const problem = check(value[field]);
      if (problem !== null) return `field “${field}” ${problem}`;
    }
    return extra?.(value) ?? null;
  };
}

/* -------------------------------------------------------------------------- */
/* Shared parts                                                               */
/* -------------------------------------------------------------------------- */

const SLOT_KINDS = ['course', 'activity', 'break', 'unscheduled'] as const;
const OUTCOMES = ['attended', 'missed'] as const;

const owned: Shape = { id: idText, profileId: idText };

/** `${date}:${classId}`, as `occurrenceId` and `overrideId` build it. */
const keyedByDateAndClass = (record: Record<string, unknown>): string | null =>
  record.id === `${String(record.date)}:${String(record.classId)}`
    ? null
    : 'has an id that does not match its date and class';

const oneOffClass = shape({
  startTime: hhmm,
  endTime: hhmm,
  subjectCode: nullable(text),
  activity: nullable(text),
  room: nullable(text),
  faculty: nullable(text),
  kind: oneOf(SLOT_KINDS),
});

/**
 * A subject inside a saved result, exactly as tolerant as
 * `normalizeResultSubject`, which reads it: legacy rows may lack any field, but
 * a field that IS present must have the type that reader expects. Status and
 * grade letters are stored as printed, so they are text, not an enum.
 */
const resultSubject = shape({
  id: optional(text),
  subjectCode: nullable(text),
  subjectTitle: optional(text),
  internal: nullable(finite),
  external: nullable(finite),
  total: nullable(finite),
  resultStatus: nullable(text),
  announcedOn: nullable((value) => (value === '' ? null : isoDate(value))),
  gradeLetter: nullable(text),
  gradePoint: nullable(finite),
  credits: nullable(finite),
  hasSee: nullable(bool),
  provenance: optional(text),
  catalogueCode: nullable(text),
});

const calendarEvent = shape({
  id: idText,
  startDate: isoDate,
  endDate: nullable(isoDate),
  title: text,
  category: oneOf([
    'SEMESTER_START',
    'REGISTRATION',
    'LAST_WORKING_DAY',
    'EXAM_PERIOD',
    'ACADEMIC_PERIOD',
    'HOLIDAY',
    'OTHER_ACADEMIC',
  ]),
  sourceLine: text,
  page: integer(0),
});

const ledgerEntry: Check = (value) => {
  if (!isObject(value)) return 'is not a record';
  switch (value.kind) {
    case 'opening':
      return shape(
        {
          id: idText,
          subjectCode: text,
          attended: integer(0),
          conducted: integer(0),
          migratedFrom: nullable(shape({ attended: integer(0), conducted: integer(0) })),
          reconciliation: oneOf(['exact', 'inconsistent']),
          unreconciledMarks: listOf(
            shape({
              date: isoDate,
              classId: nullable(text),
              outcome: oneOf(OUTCOMES),
              reason: oneOf(['missing_slot', 'counter_mismatch']),
            }),
          ),
          createdAt: timestamp,
        },
        (record) =>
          record.id === `opening:${String(record.subjectCode)}`
            ? null
            : 'has an id that does not match its subject',
      )(value);
    case 'occurrence':
      return shape(
        {
          id: idText,
          classId: idText,
          date: isoDate,
          subjectCode: text,
          subjectTitle: nullable(text),
          startTime: hhmm,
          endTime: hhmm,
          outcome: oneOf(OUTCOMES),
          markedAt: timestamp,
        },
        keyedByDateAndClass,
      )(value);
    case 'adjustment':
      return shape({
        id: idText,
        subjectCode: text,
        attendedDelta: integer(Number.MIN_SAFE_INTEGER),
        conductedDelta: integer(Number.MIN_SAFE_INTEGER),
        reason: oneOf(['adopt_remote_snapshot']),
        sourceDevice: nullable(text),
        fromSnapshot: nullable(text),
        createdAt: timestamp,
        commitAfter: timestamp,
      })(value);
    default:
      return 'is not an opening, occurrence or adjustment';
  }
};

/* -------------------------------------------------------------------------- */
/* One contract per collection                                                */
/* -------------------------------------------------------------------------- */

/** The record contract for every collection a backup may carry. */
export const RECORD_CONTRACTS: Readonly<Partial<Record<StorageKey, Check>>> = {
  profile: shape({
    id: idText,
    authUserId: nullable(text),
    displayName: nullable(text),
    usn: nullable(text),
    collegeName: nullable(text),
    schemeId: text,
    programme: nullable(text),
    branch: nullable(text),
    currentSemester: nullable(semesterNumber),
    admissionYear: nullable(integer(1900, 2200)),
    expectedPassoutYear: nullable(integer(1900, 2200)),
    entryRoute: nullable(oneOf(['puc', 'diploma'])),
    identityConfirmedAt: nullable(timestamp),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  attendance: shape({
    ...owned,
    semester: semesterNumber,
    subjectCode: text,
    subjectTitle: text,
    attended: integer(0),
    conducted: integer(0),
    updatedAt: timestamp,
  }),
  results: shape({
    ...owned,
    semester: semesterNumber,
    schemeId: text,
    ruleSetId: nullable(text),
    sgpaAsserted: nullable(finite),
    subjects: listOf(resultSubject),
    source: optional(
      shape({
        kind: oneOf(['vtu-result-page', 'document', 'manual']),
        sessionId: nullable(text),
        importedAt: timestamp,
        parserVersion: text,
      }),
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  timetable: shape({
    ...owned,
    classId: optional(idText),
    day: oneOf(WEEKDAYS),
    startTime: hhmm,
    endTime: hhmm,
    subjectCode: nullable(text),
    activity: nullable(text),
    room: nullable(text),
    faculty: nullable(text),
    kind: optional(oneOf(SLOT_KINDS)),
  }),
  semesters: shape({
    ...owned,
    number: semesterNumber,
    status: oneOf(['planned', 'in_progress', 'completed']),
    startedOn: nullable(isoDate),
    completedOn: nullable(isoDate),
    updatedAt: timestamp,
  }),
  semesterSubjects: shape({
    ...owned,
    semester: semesterNumber,
    code: text,
    title: text,
    credits: finite,
    notes: nullable(text),
    updatedAt: timestamp,
  }),
  backlogs: shape({
    ...owned,
    subjectCode: text,
    subjectTitle: text,
    originSemester: semesterNumber,
    status: oneOf(['active', 'attempted', 'cleared']),
    attempts: integer(0),
    clearedInSemester: nullable(semesterNumber),
    updatedAt: timestamp,
  }),
  notificationState: shape({
    id: idText,
    state: oneOf(NOTIFICATION_STATES),
    seenVersion: text,
    updatedAt: text,
  }),
  notificationPreferences: shape({ muted: listOf(oneOf(announcementCategorySchema.options)) }),
  calendars: shape({
    id: idText,
    semester: nullable(integer(0)),
    academicYear: nullable(text),
    events: listOf(calendarEvent),
    fingerprint: text,
    importedAt: timestamp,
    sourceKind: oneOf(['text', 'ocr']),
  }),
  timetableImports: shape({
    id: idText,
    className: nullable(text),
    semester: nullable(integer(0)),
    academicYear: nullable(text),
    revision: nullable(text),
    effectiveFrom: nullable(text),
    batch: nullable(text),
    fingerprint: text,
    importedAt: timestamp,
    slotCount: integer(0),
  }),
  classMarks: shape({
    id: idText,
    date: isoDate,
    slotId: idText,
    subjectCode: text,
    outcome: oneOf(OUTCOMES),
    markedAt: timestamp,
  }),
  attendanceLedger: ledgerEntry,
  timetableOverrides: shape(
    {
      ...owned,
      date: isoDate,
      classId: idText,
      status: oneOf(['scheduled', 'cancelled', 'removed', 'replaced']),
      addition: nullable(oneOffClass),
      replacedBy: nullable(idText),
      createdAt: timestamp,
    },
    (record) => {
      const keyed = keyedByDateAndClass(record);
      if (keyed !== null) return keyed;
      // Only a replacement names what replaced it (DateView, useMarkClass).
      const replaced = record.status === 'replaced';
      const named = typeof record.replacedBy === 'string';
      return replaced === named ? null : 'has a replacement that does not match its status';
    },
  ),
  schemeCourses: shape({
    ...owned,
    schemeYear: nullable(text),
    programme: nullable(text),
    semester: integer(1),
    code: text,
    title: text,
    credits: finite,
    sourcePage: integer(1),
    updatedAt: timestamp,
  }),
  examTimetables: shape({
    ...owned,
    examCycle: nullable(text),
    publicationState: nullable(text),
    notification: nullable(text),
    fingerprint: text,
    fileName: nullable(text),
    importedAt: timestamp,
    eventCount: integer(0),
  }),
  /* Student-entered grade-card figures (docs/53). Earned never exceeds registered. */
  gradeCards: shape(
    {
      ...owned,
      semester: semesterNumber,
      sgpa: (value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10
          ? null
          : 'is not an SGPA between 0 and 10',
      creditsRegistered: integer(1),
      creditsEarned: integer(0),
      updatedAt: timestamp,
    },
    (record) =>
      (record.creditsEarned as number) <= (record.creditsRegistered as number)
        ? null
        : 'has more credits earned than registered',
  ),
  /* A later sitting of a course not passed (docs/53, 22OB 6.3(9)). */
  courseAttempts: shape({
    ...owned,
    semester: semesterNumber,
    subjectCode: idText,
    kind: oneOf(ATTEMPT_KINDS),
    session: idText,
    external: nullable(finite),
    total: nullable(finite),
    resultStatus: nullable(text),
    recordedAt: timestamp,
  }),
  examEvents: shape({
    ...owned,
    timetableId: idText,
    examDate: isoDate,
    weekday: nullable(text),
    session: nullable(text),
    startTime: nullable(text),
    endTime: nullable(text),
    scheme: nullable(text),
    semester: nullable(integer(0)),
    printed: text,
    kind: oneOf(['code', 'alternatives', 'pattern', 'other']),
    codes: listOf(text),
  }),
};

export interface RecordProblem {
  readonly collection: StorageKey;
  /** 1-based position in the collection, or null for a single-record collection. */
  readonly position: number | null;
  readonly problem: string;
}

/**
 * The first record in `collections` that breaks its contract, or a relation
 * across the file that does not hold. Null when the whole file is valid.
 */
export function findRecordProblem(
  collections: Readonly<Partial<Record<StorageKey, unknown>>>,
): RecordProblem | null {
  for (const [key, value] of Object.entries(collections) as [StorageKey, unknown][]) {
    const check = RECORD_CONTRACTS[key];
    if (check === undefined) return { collection: key, position: null, problem: 'is not allowed' };
    if (!Array.isArray(value)) {
      const problem = check(value);
      if (problem !== null) return { collection: key, position: null, problem };
      continue;
    }
    const seen = new Set<unknown>();
    for (const [index, record] of value.entries()) {
      const problem = check(record);
      if (problem !== null) return { collection: key, position: index + 1, problem };
      const id = (record as { id: unknown }).id;
      if (seen.has(id)) {
        return {
          collection: key,
          position: index + 1,
          problem: 'repeats an id already in the file',
        };
      }
      seen.add(id);
    }
  }

  /* Every exam event belongs to an exam timetable: nothing removes one alone. */
  const timetables = new Set(
    ((collections.examTimetables as { id: string }[] | undefined) ?? []).map((item) => item.id),
  );
  const events = (collections.examEvents as { timetableId: string }[] | undefined) ?? [];
  for (const [index, event] of events.entries()) {
    if (!timetables.has(event.timetableId)) {
      return {
        collection: 'examEvents',
        position: index + 1,
        problem: 'belongs to an exam timetable that is not in the file',
      };
    }
  }
  return null;
}
