/**
 * GradTools domain types (Stage 1, local-first).
 *
 * Authority: docs/08_DATA_MODEL.md
 *
 * These mirror the approved data model's student-owned entities. Reference
 * data (schemes, subjects, syllabus) is server-backed and read-only, so it is
 * not modelled here — Stage 1 ships only the rule set from
 * @gradtools/academic-rules.
 *
 * NOTE: no date-of-birth field exists on any type here, and none may be added
 * (docs/32 DEC-008).
 */

import type { AuthUserId, StudentProfileId } from './identity.js';

/** Days of the week, 0 = Monday, matching the timetable grid's reading order. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * The student's academic profile.
 *
 * `authUserId` is null in Stage 1 and is the ONLY link to an identity provider
 * (docs/11, ./identity.ts). Every academic record below points at
 * `StudentProfileId`, never at a USN, email or name.
 */
export interface StudentProfile {
  readonly id: StudentProfileId;
  /** FUTURE. Always null in Stage 1 — no authentication is implemented. */
  readonly authUserId: AuthUserId | null;

  /** Profile information. Optional; used only to greet the student. */
  readonly displayName: string | null;
  /** Academic identifier, NOT an identity key. Optional. */
  readonly usn: string | null;

  /** Academic metadata. */
  readonly collegeName: string | null;
  readonly schemeId: string;
  readonly branch: string | null;
  readonly currentSemester: number | null;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Per-course attendance, stored as counts rather than per-class events
 * (docs/08 §8.9 — counts satisfy every attendance requirement in docs/02).
 */
export interface AttendanceRecord {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly semester: number;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly attended: number;
  readonly conducted: number;
  readonly updatedAt: string;
}

/** One subject inside a saved semester result. */
export interface ResultSubject {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  readonly credits: number;
  readonly gradeLetter: string;
}

/**
 * A saved semester result.
 *
 * `sgpaAsserted` is what the student's grade card says; the computed value is
 * derived on read from @gradtools/academic-rules and is never stored as a
 * competing source of truth. When the two disagree the UI shows BOTH and
 * flags it — neither silently overrides the other (docs/08 §SemesterRecord).
 */
export interface SemesterResult {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly semester: number;
  readonly schemeId: string;
  /**
   * The rule set this semester was graded under, PINNED at entry.
   *
   * Null on records saved before M6; those fall back to the scheme's active
   * rule set and the UI says so. Pinning matters because a newer rule set must
   * never silently re-grade a completed semester (M6 §6) — a regulation change
   * applies to the semesters that come after it, not to the ones already sat.
   */
  readonly ruleSetId: string | null;
  /** Optional: the SGPA printed on the grade card, as entered by the student. */
  readonly sgpaAsserted: number | null;
  readonly subjects: readonly ResultSubject[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* The eight-semester degree (M6)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Where a semester sits in the degree.
 *
 *   planned      not started. The default for every semester ahead
 *   in_progress  running now. At most one at a time
 *   completed    finished, and normally carrying a result
 */
export const SEMESTER_STATUSES = ['planned', 'in_progress', 'completed'] as const;
export type SemesterStatus = (typeof SEMESTER_STATUSES)[number];

/** A VTU degree is eight semesters. Not a setting; the shape of the product. */
export const SEMESTER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * One semester of the student's degree.
 *
 * A STUDENT DOES NOT NECESSARILY START AT SEMESTER 1 (M6 §2). Someone joining
 * GradTools in their third year has four completed semesters behind them and
 * types them in; nothing here assumes a forward march from the beginning, and
 * no status is derived from a date.
 */
export interface SemesterRecord {
  readonly id: string;
  readonly profileId: StudentProfileId;
  /** 1-8. */
  readonly number: number;
  readonly status: SemesterStatus;
  /** Optional, student-entered. Never used to infer status. */
  readonly startedOn: string | null;
  readonly completedOn: string | null;
  readonly updatedAt: string;
}

/**
 * A subject the student is taking this semester.
 *
 * Separate from `ResultSubject`, which is history: this one exists BEFORE any
 * grade does, and is what attendance and the timetable point at so a subject is
 * defined once rather than retyped in three places (M6 §14, §16).
 */
export interface SemesterSubject {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly semester: number;
  readonly code: string;
  readonly title: string;
  readonly credits: number;
  /** Student's own note. Rendered as text, never as markup. */
  readonly notes: string | null;
  readonly updatedAt: string;
}

/**
 * A subject not yet cleared.
 *
 *   active     carried, not attempted since
 *   attempted  sat again, result not known yet
 *   cleared    passed
 *
 * NO EXAM DATE FIELD, and none may be added here. Exam dates are university
 * facts that must come from a verified source (M6 §10); a student-entered date
 * would look identical to one and be trusted the same way.
 */
export const BACKLOG_STATUSES = ['active', 'attempted', 'cleared'] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export interface BacklogRecord {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly subjectCode: string;
  readonly subjectTitle: string;
  /** The semester the subject was originally taken in. */
  readonly originSemester: number;
  readonly status: BacklogStatus;
  /** How many times it has been sat. 0 when carried but not re-attempted. */
  readonly attempts: number;
  /** Set only when status is `cleared`, and only if the student knows it. */
  readonly clearedInSemester: number | null;
  readonly updatedAt: string;
}

export interface TimetableSlot {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly day: Weekday;
  /** 24-hour "HH:MM". */
  readonly startTime: string;
  readonly endTime: string;
  readonly subjectCode: string;
  readonly room: string | null;
  readonly faculty: string | null;
}
