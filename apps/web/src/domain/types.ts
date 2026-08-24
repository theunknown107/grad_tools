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
  /** Optional: the SGPA printed on the grade card, as entered by the student. */
  readonly sgpaAsserted: number | null;
  readonly subjects: readonly ResultSubject[];
  readonly createdAt: string;
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
