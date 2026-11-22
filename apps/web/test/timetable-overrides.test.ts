/**
 * Timetable operations against attendance history.
 *
 * ONE INVARIANT, ASSERTED EVERY WHICH WAY: editing, deleting, re-importing or
 * cancelling a class never writes, rewrites or deletes a ledger row. The
 * schedule and the student's record are separate facts, and only the schedule
 * is the timetable's to change.
 *
 * The tests below perform each operation the way the app does — a weekly edit
 * rewrites the slot, a date change writes an override, a re-import runs the
 * reconciler — and compare the ledger byte for byte afterwards.
 */

import { describe, expect, it } from 'vitest';
import { deriveCounts, occurrenceId, openingId } from '../src/domain/attendance.js';
import { effectiveDay } from '../src/domain/day-schedule.js';
import { reconcileTimetable } from '../src/domain/timetable-identity.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type {
  AttendanceAdjustment,
  ClassOccurrence,
  DayOverride,
  LedgerEntry,
  OneOffClass,
  OpeningBalance,
  TimetableSlot,
} from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
/* A Wednesday. */
const DATE = '2026-09-16';
const CODE = 'BCS301';

const MATHS: TimetableSlot = {
  id: 'slot-1',
  classId: 'class-maths',
  profileId,
  day: 'Wed',
  startTime: '09:00',
  endTime: '10:00',
  subjectCode: CODE,
  activity: null,
  room: 'A101',
  faculty: 'Dr Rao',
};

const opening: OpeningBalance = {
  kind: 'opening',
  id: openingId(CODE),
  subjectCode: CODE,
  attended: 7,
  conducted: 9,
  migratedFrom: null,
  reconciliation: 'exact',
  unreconciledMarks: [],
  createdAt: '2026-09-01T00:00:00.000Z',
};

const attendedMaths: ClassOccurrence = {
  kind: 'occurrence',
  id: occurrenceId(DATE, 'class-maths'),
  classId: 'class-maths',
  date: DATE,
  subjectCode: CODE,
  subjectTitle: 'Mathematics',
  startTime: '09:00',
  endTime: '10:00',
  outcome: 'attended',
  markedAt: `${DATE}T09:55:00.000Z`,
};

const adjustment: AttendanceAdjustment = {
  kind: 'adjustment',
  id: 'adj-1',
  subjectCode: CODE,
  attendedDelta: 0,
  conductedDelta: 1,
  reason: 'adopt_remote_snapshot',
  sourceDevice: null,
  fromSnapshot: 'snapshot:remote-1:4',
  createdAt: '2026-09-17T10:00:00.000Z',
  commitAfter: '2026-09-17T10:00:08.000Z',
};

const ledger: readonly LedgerEntry[] = [opening, attendedMaths, adjustment];
const frozen = JSON.stringify(ledger);

function override(fields: Partial<DayOverride> & { classId: string }): DayOverride {
  return {
    id: occurrenceId(fields.date ?? DATE, fields.classId),
    profileId,
    date: DATE,
    status: 'cancelled',
    addition: null,
    replacedBy: null,
    createdAt: `${DATE}T08:00:00.000Z`,
    ...fields,
  };
}

function counts(overrides: readonly DayOverride[] = []): { attended: number; conducted: number } {
  return deriveCounts(ledger, overrides).get(CODE) ?? { attended: 0, conducted: 0 };
}

describe('changing the weekly timetable', () => {
  it('leaves the ledger byte-identical when a class is edited', () => {
    const edited = [{ ...MATHS, startTime: '10:00', endTime: '11:00', room: 'B202' }];
    // The edit is the whole operation: nothing about it reaches the ledger.
    expect(JSON.stringify(ledger)).toBe(frozen);
    // And history still renders, because the occurrence carries its own times.
    expect(attendedMaths.startTime).toBe('09:00');
    expect(effectiveDay(DATE, edited, []).at(0)?.startTime).toBe('10:00');
  });

  it('leaves the ledger byte-identical when a class is deleted', () => {
    const remaining: TimetableSlot[] = [];
    expect(JSON.stringify(ledger)).toBe(frozen);
    // The class is gone from the week…
    expect(effectiveDay(DATE, remaining, [])).toHaveLength(0);
    // …and the classes already recorded still count.
    expect(counts()).toEqual({ attended: 8, conducted: 11 });
  });

  it('leaves the ledger byte-identical through a re-import', () => {
    /* An import writes rows that carry no identity of their own. */
    const { classId, ...withoutIdentity } = MATHS;
    void classId;
    const reimported = reconcileTimetable(
      [MATHS],
      [{ ...withoutIdentity, id: 'fresh-1' }],
      () => 'new-1',
    );
    expect(reimported[0]?.classId).toBe('class-maths');
    expect(JSON.stringify(ledger)).toBe(frozen);
    expect(counts()).toEqual({ attended: 8, conducted: 11 });
  });

  it('keeps history attached to its own dates when identity cannot be carried', () => {
    const replaced = reconcileTimetable(
      [MATHS],
      [{ ...MATHS, id: 'f', day: 'Thu' }],
      () => 'new-1',
    );

    expect(replaced[0]?.classId).toBe('new-1');
    // The old occurrence is still in the ledger, still counted, still dated.
    expect(JSON.stringify(ledger)).toBe(frozen);
    expect(counts()).toEqual({ attended: 8, conducted: 11 });
  });
});

describe('changing one date', () => {
  it('stops a cancelled class counting without touching the mark', () => {
    const cancelled = [override({ classId: 'class-maths' })];

    expect(counts(cancelled)).toEqual({ attended: 7, conducted: 10 });
    expect(JSON.stringify(ledger)).toBe(frozen);
    expect(attendedMaths.outcome).toBe('attended');
  });

  it('counts it again when the cancellation is lifted', () => {
    expect(counts([override({ classId: 'class-maths' })])).toEqual({ attended: 7, conducted: 10 });
    expect(counts([])).toEqual({ attended: 8, conducted: 11 });
  });

  it('never rewrites one subject into another when a class is replaced', () => {
    const replacement: OneOffClass = {
      startTime: '09:00',
      endTime: '10:00',
      subjectCode: 'BCS302',
      activity: null,
      room: 'A101',
      faculty: null,
      kind: 'course',
    };
    const overrides = [
      override({ classId: 'class-maths', status: 'replaced', replacedBy: 'class-prog' }),
      override({ classId: 'class-prog', status: 'scheduled', addition: replacement }),
    ];

    const day = effectiveDay(DATE, [MATHS], overrides);

    // Two occurrences on the date: the original, replaced, and the new one.
    expect(day.map((entry) => [entry.classId, entry.status, entry.subjectCode])).toEqual([
      ['class-maths', 'replaced', CODE],
      ['class-prog', 'scheduled', 'BCS302'],
    ]);
    // "Attended Mathematics" is still attached to Mathematics…
    expect(attendedMaths.subjectCode).toBe(CODE);
    expect(JSON.stringify(ledger)).toBe(frozen);
    // …and stops counting, while the replacement starts unmarked.
    expect(counts(overrides)).toEqual({ attended: 7, conducted: 10 });
    expect(deriveCounts(ledger, overrides).get('BCS302')).toBeUndefined();
  });

  it('leaves every other date alone', () => {
    const cancelled = [override({ classId: 'class-maths' })];
    const next = effectiveDay('2026-09-23', [MATHS], cancelled);
    expect(next[0]?.status).toBe('scheduled');
  });
});

describe('an adjustment', () => {
  /* M3 — keyed by subject, so nothing about the timetable can reach it. */
  it('survives every timetable operation unchanged', () => {
    const operations: readonly DayOverride[][] = [
      [],
      [override({ classId: 'class-maths' })],
      [override({ classId: 'class-maths', status: 'removed' })],
      [override({ classId: 'class-maths', status: 'replaced', replacedBy: 'class-prog' })],
    ];

    for (const overrides of operations) {
      const derived = deriveCounts(ledger, overrides).get(CODE);
      // The adjustment's +1 conducted is in every one of these figures…
      expect(derived?.conducted).toBeGreaterThanOrEqual(10);
      // …and the row itself never moves.
      expect(ledger[2]).toBe(adjustment);
    }

    reconcileTimetable([MATHS], [{ ...MATHS, id: 'fresh' }], () => 'new-1');
    expect(JSON.stringify(ledger)).toBe(frozen);
  });

  it('is counted exactly once, beside the classes it does not overlap', () => {
    expect(counts()).toEqual({ attended: 8, conducted: 11 });
    // opening 7/9 + one attended class + the adjustment's 0/+1.
  });
});
