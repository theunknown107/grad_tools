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

/**
 * What the student said happened to ONE scheduled class on ONE day.
 *
 * Authority: M10A.11 §11, §12, §13, §28, §44
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT A SECOND ATTENDANCE SYSTEM
 * ---------------------------------------------------------------------------
 *
 * `AttendanceRecord` stays the only source of every attendance number. Nothing
 * here is summed, averaged or shown as a percentage, and deleting the whole
 * collection would change no figure the product displays.
 *
 * It exists because the counts genuinely cannot answer two questions the daily
 * loop asks. "Have I already marked this class?" - without which a second tap,
 * a re-render or a walk to another screen and back silently counts the same
 * class twice. And "what did I just do?" - without which a mis-tap is
 * permanent.
 *
 * It is deliberately NOT class history (M10A.11 §11, §12). Marks are pruned to
 * a rolling fortnight, so this cannot accumulate into a per-class record the
 * product then has to keep true. Per-class history remains unavailable, and
 * that limitation is intended.
 *
 * The id is `${date}:${slotId}` rather than random: one scheduled class on one
 * day is one document by construction, so a repeated write REPLACES rather than
 * appends, whatever the caller does.
 */
export interface ClassMark {
  readonly id: string;
  readonly profileId: StudentProfileId;
  /** The calendar day, 'YYYY-MM-DD', in the device's own timezone. */
  readonly date: string;
  /** The `TimetableSlot` this mark is about. */
  readonly slotId: string;
  /** Denormalised so a mark stays readable if the slot is edited or removed. */
  readonly subjectCode: string;
  readonly outcome: 'attended' | 'missed';
  readonly markedAt: string;
}

/**
 * What a result card prints in its status column.
 *
 * OBSERVED, NOT DEFINED (OQ-049 §12). These six are the nomenclature block a
 * real VTU provisional result prints at the foot of the page. GradTools stores
 * and displays them; it assigns academic meaning to NONE of them, because the
 * card legends them and the regulation defines pass/fail through the marks,
 * which `evaluateCourseResult` already reads. A status GradTools has never seen
 * is stored as typed rather than rejected — an unknown letter on a real card is
 * a fact about the card, not a data error.
 */
export const RESULT_STATUSES = ['P', 'F', 'A', 'W', 'X', 'NE'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** How a subject row came to be. Display information, never a trust level. */
export const SUBJECT_PROVENANCES = ['catalogue', 'manual'] as const;
export type SubjectProvenance = (typeof SUBJECT_PROVENANCES)[number];

/**
 * One subject inside a saved semester result.
 *
 * ---------------------------------------------------------------------------
 * EVERY ACADEMIC FIELD IS NULLABLE, AND THAT IS THE POINT (OQ-049)
 * ---------------------------------------------------------------------------
 *
 * This type used to REQUIRE `credits` and `gradeLetter` and could store none of
 * internal, external, total or status. A VTU provisional result is the exact
 * inverse: it prints the four marks fields and prints no grade, no grade point,
 * no credits and no SGPA. A student copying their own card therefore had to
 * invent a grade before they could save anything — the manufacturing of missing
 * values docs/37 forbids, forced by the schema.
 *
 * So: **source fields hold what the card printed, and nothing else.** Where the
 * card is silent the field is null and stays null. Every computed counterpart —
 * the total from the marks, the grade from the rule set, the grade point, the
 * backlog state — is derived on read in `domain/results.ts` and is NEVER
 * written back over its source (OQ-049 §3).
 *
 * `credits` and `hasSee` are the two fields that are neither printed nor
 * inferable. They come from the subject catalogue when the subject is in it
 * (`provenance: 'catalogue'`), and are null otherwise. An external of 0 must
 * never be read as "no SEE" — DEC-037 — so `hasSee: null` means unknown, and
 * unknown propagates into a backlog state of "not known" rather than a guess.
 */
export interface ResultSubject {
  readonly id: string;
  readonly subjectCode: string;
  readonly subjectTitle: string;

  /* ---- Source: what the result card printed, as the student read it ------ */

  /** CIE marks. */
  readonly internal: number | null;
  /** The SEE's PRINTED contribution, on the card's own scale — not a raw script. */
  readonly external: number | null;
  /** The printed total. Kept as printed; never repaired to match the columns. */
  readonly total: number | null;
  /** The printed status letter, verbatim. See RESULT_STATUSES. */
  readonly resultStatus: string | null;
  /** The card's "Announced / Updated on" date, ISO `YYYY-MM-DD`. */
  readonly announcedOn: string | null;
  /** A grade letter the SOURCE gave. Null on a provisional card, which prints none. */
  readonly gradeLetter: string | null;
  /** A grade point the SOURCE gave. Almost always null; a few consolidated cards print one. */
  readonly gradePoint: number | null;

  /* ---- Reference: authoritative, or absent -------------------------------- */

  /** From the subject catalogue. Null when the subject is not in it (§15). */
  readonly credits: number | null;
  /** Whether this course has a semester-end examination. Null = unknown (DEC-037). */
  readonly hasSee: boolean | null;
  readonly provenance: SubjectProvenance;
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
