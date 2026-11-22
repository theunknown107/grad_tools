/**
 * What is actually on for one date.
 *
 * The weekly template says what recurs; `DayOverride` says what happened to one
 * date. This composes the two into the list a student looks at, and answers the
 * one question the attendance control depends on: can this hour be marked at
 * all?
 *
 * ---------------------------------------------------------------------------
 * A ZERO-HOUR IS SAID, NOT INFERRED
 * ---------------------------------------------------------------------------
 *
 * It is tempting to read `endTime <= startTime` as "no class here". It is not:
 * no writer in the app can produce such a row. The importer's `readSlot`
 * returns null unless the range moves forward, and the manual form rejects it
 * too. A degenerate row in storage is therefore CORRUPT DATA, and treating it
 * as a semantic would silently swallow the corruption.
 *
 * So "no class happens in this hour" is an explicit `kind: 'unscheduled'`, and
 * a degenerate row is shown with a repair prompt rather than quietly dropped.
 */

import type {
  DayOverride,
  OccurrenceStatus,
  OneOffClass,
  SlotKind,
  TimetableSlot,
  Weekday,
} from './types.js';
import { WEEKDAYS } from './types.js';
import { slotClassId } from './timetable-identity.js';

/** What a row that names no course is called, when the name says so. */
const BREAK_NAME = /\b(break|lunch|recess|interval)\b/i;

/**
 * What this hour is.
 *
 * The stored `kind` wins where a row has one. Everything written before the
 * field existed is read the way the timetable screen already read it, so no
 * stored record needs migrating: a course teaches a subject, a row named "lunch"
 * is a break, and anything else is an activity.
 */
export function slotKind(slot: {
  readonly subjectCode: string | null;
  readonly activity?: string | null;
  readonly kind?: SlotKind;
}): SlotKind {
  if (slot.kind !== undefined) return slot.kind;
  if (slot.subjectCode !== null) return 'course';
  return BREAK_NAME.test(slot.activity ?? '') ? 'break' : 'activity';
}

/**
 * A row whose hour does not move forwards.
 *
 * Corrupt, not meaningful. Kept visible so it can be repaired; never markable,
 * because nobody can say a class was held between 10:00 and 10:00.
 */
export function degenerate(slot: {
  readonly startTime: string;
  readonly endTime: string;
}): boolean {
  return slot.endTime <= slot.startTime;
}

/**
 * Whether an hour can bear attendance.
 *
 * Breaks, activities, explicit unscheduled hours and corrupt rows get no
 * control, no occurrence and no place in the denominator. There is exactly one
 * answer to this question and it is here, so the control, the counting and the
 * history cannot come to disagree.
 */
export function markable(slot: {
  readonly subjectCode: string | null;
  readonly activity?: string | null;
  readonly kind?: SlotKind;
  readonly startTime: string;
  readonly endTime: string;
}): boolean {
  return slotKind(slot) === 'course' && slot.subjectCode !== null && !degenerate(slot);
}

/** The weekday a 'YYYY-MM-DD' date falls on, in the device's own timezone. */
export function weekdayOf(date: string): Weekday | null {
  const parts = date.split('-').map(Number);
  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) return null;
  const index = new Date(year, month - 1, day).getDay();
  /* Sunday has no column in the week the product shows. */
  return index === 0 ? null : (WEEKDAYS[index - 1] ?? null);
}

/** One class on one date: the template, plus whatever that date did to it. */
export interface EffectiveClass {
  readonly classId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly subjectCode: string | null;
  readonly activity: string | null;
  readonly room: string | null;
  readonly faculty: string | null;
  readonly kind: SlotKind;
  /** The SCHEDULE axis. Never says anything about what the student did. */
  readonly status: OccurrenceStatus;
  /** True only for a class that exists on this date alone. */
  readonly oneOff: boolean;
  readonly markable: boolean;
  readonly degenerate: boolean;
}

function fromOneOff(
  classId: string,
  date: string,
  addition: OneOffClass,
  status: OccurrenceStatus,
): EffectiveClass {
  return {
    classId,
    date,
    startTime: addition.startTime,
    endTime: addition.endTime,
    subjectCode: addition.subjectCode,
    activity: addition.activity,
    room: addition.room,
    faculty: addition.faculty,
    kind: addition.kind,
    status,
    oneOff: true,
    markable: status === 'scheduled' && markable(addition),
    degenerate: degenerate(addition),
  };
}

export function overrideId(date: string, classId: string): string {
  return `${date}:${classId}`;
}

/**
 * What is on, on one date.
 *
 * Sorted by start time, cancelled and replaced hours INCLUDED: a student needs
 * to see that the 9 o'clock was cancelled, and a row that simply vanished would
 * leave them wondering whether they had recorded it. Only the counting treats
 * them as nothing (domain/attendance).
 */
export function effectiveDay(
  date: string,
  slots: readonly TimetableSlot[],
  overrides: readonly DayOverride[],
): readonly EffectiveClass[] {
  const weekday = weekdayOf(date);
  const forDate = overrides.filter((override) => override.date === date);
  const byClass = new Map(forDate.map((override) => [override.classId, override]));

  const recurring = slots
    .filter((slot) => slot.day === weekday)
    .map((slot): EffectiveClass => {
      const classId = slotClassId(slot);
      const override = byClass.get(classId);
      const status = override?.status ?? 'scheduled';
      return {
        classId,
        date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectCode: slot.subjectCode,
        activity: slot.activity,
        room: slot.room,
        faculty: slot.faculty,
        kind: slotKind(slot),
        status,
        oneOff: false,
        markable: status === 'scheduled' && markable(slot),
        degenerate: degenerate(slot),
      };
    });

  /* Classes that exist on this date only: one-offs, and replacements. */
  const onTemplate = new Set(recurring.map((entry) => entry.classId));
  const added = forDate
    .filter((override) => override.addition !== null && !onTemplate.has(override.classId))
    .map((override) =>
      fromOneOff(override.classId, date, override.addition as OneOffClass, override.status),
    );

  return [...recurring, ...added].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.classId.localeCompare(b.classId),
  );
}

/** Whether two hours of the same day collide. Warned about, never auto-fixed. */
export function overlaps(
  a: { readonly startTime: string; readonly endTime: string },
  b: { readonly startTime: string; readonly endTime: string },
): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}
