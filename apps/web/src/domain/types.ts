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
  /**
   * The degree programme, as the student stated it. "B.E.", "M.Tech.".
   *
   * NULL MEANS THEY HAVE NOT SAID, and it is never filled in from anything
   * else. VTU names the programme on nearly every notice it publishes, so
   * without this a programme-scoped notice cannot be matched to anybody — but
   * a branch, a scheme or a course code is evidence about the branch, the
   * scheme or the course, not about this (Phase 7B.3.1 §6, §13).
   */
  readonly programme: string | null;
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
  /**
   * The course's code, or null where the student is recording something that
   * has none.
   *
   * NOT THE IDENTITY. `id` is. A student's own record of "Placement &
   * Training" or of a course whose code they do not have is a real row, and
   * requiring a code forced them to invent one — which then reads on screen
   * exactly like a VTU code and is indexed as a subject. The same reasoning
   * that made `TimetableSlot.subjectCode` nullable applies here; what makes a
   * row storable is that it can be NAMED, so the title carries identity when
   * the code is absent, and `validateResultSubject` requires one or the other.
   */
  readonly subjectCode: string | null;
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
  /**
   * The catalogue course this row is DECLARED to be, or null.
   *
   * ---------------------------------------------------------------------------
   * A LINK, NOT A PROMOTION
   * ---------------------------------------------------------------------------
   *
   * `provenance` says how the row came to be and does not change afterwards.
   * This says what the student has since told us it corresponds to. The two
   * are different facts and a row can carry both: a subject they typed
   * themselves, linked to the catalogue's `BCS502`, is still a subject they
   * typed. Writing the link into `provenance` said the opposite — the row
   * stopped reading as theirs the moment they identified it, which is exactly
   * the promotion §7 forbids.
   *
   * It holds a CODE rather than a row id because the catalogue is reference
   * data keyed by code and versioned independently of any student: a link that
   * survives a re-import is a link to the course, not to one reading of it.
   * Set only from an exact code the catalogue actually has — never inferred
   * from a title, and never from a resemblance.
   */
  readonly catalogueCode: string | null;
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
 * One course as the Scheme of Teaching states it.
 *
 * REFERENCE DATA, NOT THE STUDENT'S (Phase 7C §10, §14). This is the top tier:
 * a credit here came off the university's own published table, so it is
 * labelled `VTU catalogue` on screen and may be trusted as the answer for a
 * code wherever that code appears. A figure the student typed must NEVER be
 * written into this store — the two tiers exist precisely so they can be told
 * apart, and folding them together is the bug §14 was written about.
 *
 * Kept apart from `SemesterSubject`, which is what a student PLANS to take. The
 * same code can be in both and they answer different questions: this one says
 * what the course is worth, that one says the student is taking it.
 */
export interface SchemeCourse {
  readonly id: string;
  readonly profileId: StudentProfileId;
  /** The programme's scheme year, as the document heads itself: "2022". */
  readonly schemeYear: string | null;
  /** The programme the scheme is for, as printed. Null when it prints none. */
  readonly programme: string | null;
  readonly semester: number;
  readonly code: string;
  readonly title: string;
  /** The scheme's own figure. Never null: a row without one is not saved. */
  readonly credits: number;
  /** The page of the scheme this row was read from. */
  readonly sourcePage: number;
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

/**
 * One scheduled hour of the student's week.
 *
 * ---------------------------------------------------------------------------
 * NOT EVERYTHING A TIMETABLE SCHEDULES IS A COURSE
 * ---------------------------------------------------------------------------
 *
 * A real college timetable prints hours that carry no subject code and never
 * will: the Semester 5 V(B) document schedules "Value added Course",
 * "Placement & Training" and "ESEVM" in the same grid as Computer Networks,
 * and its own subject table defines none of them.
 *
 * `subjectCode` was required, so those hours were parsed, kept through review,
 * warned about — and then dropped at save, because the only way to store one
 * was to invent a code for it. A code we invented would then be indexed as a
 * subject, offered for attendance and shown beside real VTU codes, which is a
 * worse answer than losing the row.
 *
 * So a slot is one of two things, and says which:
 *
 *   a COURSE    subjectCode = 'BCS502',  activity = null
 *   an ACTIVITY subjectCode = null,      activity = 'Placement & Training'
 *
 * Exactly one is set. A break is neither — it is not a slot at all, but a
 * `TimeSlot` the imported document marks `isBreak`, and it never becomes a
 * record here.
 *
 * Read these two fields through `timetableEntry` (domain/timetable-import)
 * rather than testing them at each call site: what to display, what to put
 * beside it, and whether the hour can bear attendance are one decision, and
 * answering it in six places is how the six come to disagree.
 */
export interface TimetableSlot {
  readonly id: string;
  readonly profileId: StudentProfileId;
  /**
   * The STABLE identity of this recurring class, across every import.
   *
   * `id` cannot carry it: importing a timetable deletes every slot and mints a
   * new `id` for each row (features/import/DocumentImport), so attendance keyed
   * on `id` would lose its history the first time a student re-imported the
   * same document. `classId` is minted once and carried by `reconcileTimetable`
   * (domain/timetable-identity) only where the old and new rows match
   * unambiguously - never guessed.
   *
   * Optional only for records written before it existed; `slotClassId` reads it
   * and the v1 upgrade fills it in.
   */
  readonly classId?: string;
  readonly day: Weekday;
  /** 24-hour "HH:MM". */
  readonly startTime: string;
  readonly endTime: string;
  /** The course this hour teaches, or null where the hour is an activity. */
  readonly subjectCode: string | null;
  /** What the timetable called this hour, where it names no course. */
  readonly activity: string | null;
  readonly room: string | null;
  readonly faculty: string | null;
  /**
   * What this hour IS, said explicitly rather than guessed (domain/day-schedule).
   *
   * Absent on every row written before this existed, which is why `slotKind`
   * falls back to reading the name. `'unscheduled'` is the explicit "no class
   * happens here" - a free period, or an hour the printed timetable occupies
   * but teaches nothing in. It is NEVER inferred from clock arithmetic: a slot
   * whose end is not after its start is corrupt data, not a zero-hour.
   */
  readonly kind?: SlotKind;
}

/** What an hour of the week is. See `TimetableSlot.kind`. */
export type SlotKind = 'course' | 'activity' | 'break' | 'unscheduled';

/* -------------------------------------------------------------------------- */
/* The attendance ledger (v1)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ---------------------------------------------------------------------------
 * TWO AXES, NEVER ONE
 * ---------------------------------------------------------------------------
 *
 * A class the student attended and a class the institution cancelled are two
 * different facts about the same hour, and the product needs both: "cancelled"
 * must not count towards the denominator, and cancelling an hour must not erase
 * the student's own record of having been there.
 *
 * So the schedule and the student are kept apart:
 *
 *   OccurrenceStatus   owned by the TIMETABLE   stored as a DayOverride
 *   AttendanceOutcome  owned by the STUDENT     stored as a ClassOccurrence
 *
 * `cancelled` is deliberately NOT an attendance outcome. A cancelled hour
 * contributes 0/0 because no non-`scheduled` occurrence is counted at all, not
 * because a third outcome value is filtered out - and the mark underneath
 * survives untouched, counting again the moment the cancellation is reversed.
 */
export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'removed' | 'replaced';

/** What the student did. There is no third answer; see OccurrenceStatus. */
export type AttendanceOutcome = 'attended' | 'missed';

/**
 * What a subject had already counted before the ledger existed.
 *
 * The v1 upgrade turns each stored `AttendanceRecord` into exactly one of
 * these, so no figure a student was looking at yesterday moves overnight.
 */
export interface OpeningBalance {
  readonly kind: 'opening';
  /** `opening:<subjectCode>` - derived, so the upgrade is idempotent. */
  readonly id: string;
  readonly subjectCode: string;
  readonly attended: number;
  readonly conducted: number;
  /** The stored counters this was built from, kept for audit. */
  readonly migratedFrom: { readonly attended: number; readonly conducted: number } | null;
  /**
   * Whether the legacy state was self-consistent.
   *
   * `'inconsistent'` means the stored counters were SMALLER than the surviving
   * class marks imply. Both are then preserved rather than reconciled by
   * guesswork: the counters stand as the opening balance, and the marks are
   * kept as evidence in `unreconciledMarks`, counted nowhere.
   */
  readonly reconciliation: 'exact' | 'inconsistent';
  readonly unreconciledMarks: readonly UnreconciledLegacyMark[];
  readonly createdAt: string;
}

/**
 * A legacy `ClassMark` that could not become history, kept anyway.
 *
 * Absorbing it into a number and then deleting the marks would destroy the only
 * evidence that the class was ever recorded. Its numeric contribution is inside
 * the opening balance exactly once; this is the audit trail beside it.
 */
export interface UnreconciledLegacyMark {
  readonly date: string;
  /** Null where the slot it referred to no longer exists. */
  readonly classId: string | null;
  readonly outcome: AttendanceOutcome;
  readonly reason: 'missing_slot' | 'counter_mismatch';
}

/**
 * One class on one date, as the student answered for it.
 *
 * Unlike `ClassMark` this IS the ledger: it is summed, it is the denominator,
 * and it is never pruned. The id is `${date}:${classId}`, so marking the same
 * class twice replaces rather than appends, whatever the caller does.
 *
 * The timetable fields are denormalised because history has to render when the
 * weekly template has moved on - the slot may have been edited, deleted or
 * re-imported since.
 */
export interface ClassOccurrence {
  readonly kind: 'occurrence';
  readonly id: string;
  readonly classId: string;
  /** The calendar day, 'YYYY-MM-DD', in the device's own timezone. */
  readonly date: string;
  readonly subjectCode: string;
  readonly subjectTitle: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly outcome: AttendanceOutcome;
  readonly markedAt: string;
}

/**
 * A correction the student made after the ledger was already running.
 *
 * Only ever created by adopting a synced figure (features/auth/useSync), which
 * is an explicit action with a short undo window. Once committed it is
 * immutable: never edited, never deleted, never folded into the opening
 * balance, and no timetable operation can touch it. A later correction is a NEW
 * adjustment.
 */
export interface AttendanceAdjustment {
  readonly kind: 'adjustment';
  readonly id: string;
  readonly subjectCode: string;
  /** Signed: the figure may legitimately go down. */
  readonly attendedDelta: number;
  readonly conductedDelta: number;
  readonly reason: 'adopt_remote_snapshot';
  /**
   * ALWAYS NULL in this phase. Sync carries no device attribution - a row's
   * provenance cannot be proven, so it is not claimed.
   */
  readonly sourceDevice: string | null;
  /** The `RemoteSnapshot` this came from; the other half of the audit link. */
  readonly fromSnapshot: string | null;
  readonly createdAt: string;
  /** ISO: when the undo window closes and this becomes immutable. */
  readonly commitAfter: string;
}

export type LedgerEntry = OpeningBalance | ClassOccurrence | AttendanceAdjustment;

/**
 * A change to ONE date, leaving the weekly template alone.
 *
 * Cancelling next Tuesday's class must not cancel every Tuesday, and a class
 * replaced for one date must not rewrite what the student attended last week.
 * Overrides are keyed `${date}:${classId}`, so one occurrence can never hold
 * two contradictory instructions.
 *
 * DEVICE-LOCAL in this phase, like the ledger: the weekly timetable still syncs
 * exactly as it did, but date-specific changes do not (see AccountPage).
 */
export interface DayOverride {
  readonly id: string;
  readonly profileId: StudentProfileId;
  readonly date: string;
  readonly classId: string;
  readonly status: OccurrenceStatus;
  /**
   * The class this date holds instead, where one was added or a replacement was
   * put in. A replacement is a DIFFERENT `classId` with its own override, so
   * "attended Mathematics" is never rewritten into "attended Programming".
   */
  readonly addition: OneOffClass | null;
  /** For a `replaced` occurrence: the `classId` that took its place. */
  readonly replacedBy: string | null;
  readonly createdAt: string;
}

/** A class that exists on one date only: a one-off, or a replacement. */
export interface OneOffClass {
  readonly startTime: string;
  readonly endTime: string;
  readonly subjectCode: string | null;
  readonly activity: string | null;
  readonly room: string | null;
  readonly faculty: string | null;
  readonly kind: SlotKind;
}

/**
 * A synced attendance aggregate, observed and NOT adopted.
 *
 * On a ledger-authoritative device a pulled `AttendanceRecord` is never
 * promoted to a fact: it is recorded here, compared, and shown to the student,
 * who decides. The id is derived from the record and its revision, so seeing
 * the same row ten times produces ONE observation rather than ten.
 *
 * Provenance is limited to what the sync schema can prove: the row's revision.
 * It is not attributed to a device, because nothing in sync identifies one -
 * the value may even be this device's own, written before it upgraded.
 */
export interface RemoteSnapshot {
  /** `snapshot:${remoteRecordId}:${revision}` - derived, never random. */
  readonly id: string;
  readonly remoteRecordId: string;
  readonly subjectCode: string;
  readonly attended: number;
  readonly conducted: number;
  readonly revision: number;
  readonly status: 'open' | 'kept' | 'adopted' | 'rejected' | 'superseded';
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** Set when adopted: the `AttendanceAdjustment` it produced. */
  readonly adjustmentId: string | null;
}
