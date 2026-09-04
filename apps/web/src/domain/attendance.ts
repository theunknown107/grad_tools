/**
 * Recording that a class happened.
 *
 * Authority: docs/08 §8.9 · docs/16 §16.9 · core product §12, §32
 *
 * ---------------------------------------------------------------------------
 * THE ACTION THE PRODUCT IS USED FOR MOST, AND HAD NO BUTTON
 * ---------------------------------------------------------------------------
 *
 * Attendance is stored as two counts — attended and conducted — which is the
 * right shape (docs/08 §8.9) and gave the screen only two operations: add a
 * subject with both totals typed in, or delete it. A student who went to five
 * classes today had to retype five subject codes and ten numbers to record it.
 *
 * The daily loop is: a class happens, and it was attended or it was not. That
 * is one increment, and this is the whole of it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN @gradtools/academic-rules
 * ---------------------------------------------------------------------------
 *
 * Nothing here is a regulation. `calculateAttendance`, `calculateClassesCanMiss`
 * and `calculateClassesMustAttend` own every threshold and every percentage,
 * and they stay where they are. Adding one to a counter is bookkeeping, and
 * putting it in the rules package would mix "what the university requires" with
 * "what the student tapped".
 */

import type { AttendanceRecord, ClassMark } from './types.js';

/** What happened to one class. There is no third answer worth storing. */
export type ClassOutcome = 'attended' | 'missed';

/**
 * The same record, one class later.
 *
 * A missed class still HAPPENED: `conducted` rises either way, and only
 * `attended` depends on the outcome. Incrementing just `attended` on a present
 * day would quietly improve the percentage, and incrementing nothing on an
 * absent day would quietly preserve it — both are the same mistake, which is
 * treating attendance as a score rather than a ratio.
 */
export function markClass(record: AttendanceRecord, outcome: ClassOutcome): AttendanceRecord {
  return {
    ...record,
    attended: record.attended + (outcome === 'attended' ? 1 : 0),
    conducted: record.conducted + 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The first class of a subject that has no record yet.
 *
 * Reached from today's timetable, where the student is looking at a class for a
 * subject they have never opened the attendance screen for. Refusing to record
 * it — or making them go and create the subject first — is how a one-tap action
 * becomes a three-screen errand.
 *
 * The title comes from the caller, which resolves it through the subject index
 * (M10A.1) rather than asking the student to type a name they have already
 * entered somewhere else.
 */
export function startRecord(
  seed: {
    readonly id: string;
    readonly profileId: AttendanceRecord['profileId'];
    readonly semester: number;
    readonly subjectCode: string;
    readonly subjectTitle: string;
  },
  outcome: ClassOutcome,
): AttendanceRecord {
  return {
    id: seed.id,
    profileId: seed.profileId,
    semester: seed.semester,
    subjectCode: seed.subjectCode,
    subjectTitle: seed.subjectTitle,
    attended: outcome === 'attended' ? 1 : 0,
    conducted: 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Whether a record could have come from counting real classes.
 *
 * `attended > conducted` is not a rounding problem, it is a corrupt record: it
 * says a student went to more classes than were held, and every percentage
 * derived from it is above 100. The entry form already refuses it; this exists
 * so an increment path cannot introduce it either, and so a record that arrived
 * from sync or from an older build can be recognised rather than rendered.
 */
export function isCountable(record: AttendanceRecord): boolean {
  return (
    Number.isInteger(record.attended) &&
    Number.isInteger(record.conducted) &&
    record.attended >= 0 &&
    record.conducted >= 0 &&
    record.attended <= record.conducted
  );
}

/* -------------------------------------------------------------------------- */
/* The daily loop: one scheduled class, one decision                          */
/* -------------------------------------------------------------------------- */

/** One scheduled class on one day is one mark, whatever the caller does (§13). */
export function markId(date: string, slotId: string): string {
  return `${date}:${slotId}`;
}

/** The mark for a class on a day, or null where the student has not said. */
export function markFor(
  marks: readonly ClassMark[],
  date: string,
  slotId: string,
): ClassMark | null {
  const id = markId(date, slotId);
  return marks.find((mark) => mark.id === id) ?? null;
}

/**
 * What moving one class from `before` to `after` does to the two counters.
 *
 * `null` means "the student has not said". Every transition falls out of two
 * facts — a class that was marked at all was CONDUCTED, and a class marked
 * attended was ATTENDED — so this is subtraction rather than six cases:
 *
 *   unmarked → attended     +1 attended   +1 conducted
 *   unmarked → missed        0            +1 conducted
 *   attended → missed       -1 attended    0
 *   missed   → attended     +1 attended    0
 *   attended → unmarked     -1 attended   -1 conducted   (undo)
 *   missed   → unmarked      0            -1 conducted   (undo)
 *
 * Undo is the same arithmetic backwards, which is why nothing needs to store a
 * copy of the record it replaced.
 */
export function countDelta(
  before: ClassOutcome | null,
  after: ClassOutcome | null,
): { readonly attended: number; readonly conducted: number } {
  const attendedOf = (outcome: ClassOutcome | null) => (outcome === 'attended' ? 1 : 0);
  const conductedOf = (outcome: ClassOutcome | null) => (outcome === null ? 0 : 1);
  return {
    attended: attendedOf(after) - attendedOf(before),
    conducted: conductedOf(after) - conductedOf(before),
  };
}

/**
 * The record, moved by a delta.
 *
 * CLAMPED, because the counts are also editable by hand: a student who marks a
 * class attended, then opens the attendance screen and types the totals down to
 * zero, would otherwise undo their way to a negative record. Clamping keeps
 * every result countable (`isCountable`) rather than trusting the arithmetic to
 * be the only writer.
 */
export function applyDelta(
  record: AttendanceRecord,
  delta: { readonly attended: number; readonly conducted: number },
): AttendanceRecord {
  const conducted = Math.max(0, record.conducted + delta.conducted);
  return {
    ...record,
    attended: Math.min(conducted, Math.max(0, record.attended + delta.attended)),
    conducted,
    updatedAt: new Date().toISOString(),
  };
}

/** How long a mark is worth keeping. Long enough to look back over a week. */
export const MARK_RETENTION_DAYS = 14;

/**
 * Marks that have outgrown their purpose (§44).
 *
 * A mark answers "have I already marked this?" for a class the student is
 * looking at. A fortnight later nothing asks, and keeping it would turn a
 * duplicate guard into the per-class history this deliberately is not.
 */
export function staleMarks(marks: readonly ClassMark[], today: string): ClassMark[] {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - MARK_RETENTION_DAYS);
  const oldest = cutoff.toISOString().slice(0, 10);
  return marks.filter((mark) => mark.date < oldest);
}
