/**
 * What is on for one date, and what can be marked.
 *
 * The rule under test is the HARD ONE: a break is never an attendance class,
 * and neither is an activity, an explicitly unscheduled hour, or a corrupt row.
 * If any of them could be marked, the denominator would grow for hours no
 * lecturer ever taught, and every percentage in the product would be wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  degenerate,
  effectiveDay,
  markable,
  overlaps,
  slotKind,
  weekdayOf,
} from '../src/domain/day-schedule.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { DayOverride, TimetableSlot } from '../src/domain/types.js';

const profileId = asStudentProfileId('11111111-1111-1111-1111-111111111111');
/* 2026-09-16 is a Wednesday. */
const DATE = '2026-09-16';

function slot(overrides: Partial<TimetableSlot> & { id: string }): TimetableSlot {
  return {
    profileId,
    day: 'Wed',
    startTime: '09:00',
    endTime: '10:00',
    subjectCode: 'BCS301',
    activity: null,
    room: null,
    faculty: null,
    ...overrides,
  };
}

function override(overrides: Partial<DayOverride> & { classId: string }): DayOverride {
  return {
    id: `${DATE}:${overrides.classId}`,
    profileId,
    date: DATE,
    status: 'cancelled',
    addition: null,
    replacedBy: null,
    createdAt: `${DATE}T08:00:00.000Z`,
    ...overrides,
  };
}

describe('what an hour is', () => {
  it('reads the stored kind where a row has one', () => {
    expect(slotKind(slot({ id: 'a', kind: 'unscheduled' }))).toBe('unscheduled');
    expect(slotKind(slot({ id: 'a', subjectCode: null, activity: 'Lunch', kind: 'course' }))).toBe(
      'course',
    );
  });

  it('reads rows written before the field existed', () => {
    expect(slotKind(slot({ id: 'a' }))).toBe('course');
    expect(slotKind(slot({ id: 'a', subjectCode: null, activity: 'Lunch Break' }))).toBe('break');
    expect(slotKind(slot({ id: 'a', subjectCode: null, activity: 'Short break' }))).toBe('break');
    expect(slotKind(slot({ id: 'a', subjectCode: null, activity: 'Recess' }))).toBe('break');
    expect(slotKind(slot({ id: 'a', subjectCode: null, activity: 'Placement Training' }))).toBe(
      'activity',
    );
  });
});

describe('what can be marked', () => {
  it('marks a real teaching hour', () => {
    expect(markable(slot({ id: 'a' }))).toBe(true);
  });

  it.each([
    ['a long break', { subjectCode: null, activity: 'Lunch break' }],
    ['a short break', { subjectCode: null, activity: 'Break' }],
    ['an activity', { subjectCode: null, activity: 'Placement & Training' }],
    ['an explicitly unscheduled hour', { kind: 'unscheduled' as const }],
    ['a corrupt row', { endTime: '09:00' }],
    ['a backwards row', { startTime: '11:00', endTime: '10:00' }],
  ])('never marks %s', (_label, fields) => {
    expect(markable(slot({ id: 'a', ...fields }))).toBe(false);
  });

  it('calls a row whose hour does not move forward corrupt, not meaningful', () => {
    // The importer and the manual form both refuse to write one of these, so a
    // stored one is damage — and damage is shown, not silently reinterpreted.
    expect(degenerate(slot({ id: 'a', endTime: '09:00' }))).toBe(true);
    expect(degenerate(slot({ id: 'a' }))).toBe(false);
  });
});

describe('the effective day', () => {
  const week = [
    slot({ id: 'a', classId: 'class-a' }),
    slot({ id: 'b', classId: 'class-b', startTime: '10:00', endTime: '11:00' }),
    slot({ id: 'c', classId: 'class-c', day: 'Thu' }),
    slot({
      id: 'd',
      classId: 'class-d',
      startTime: '11:00',
      endTime: '11:15',
      subjectCode: null,
      activity: 'Short break',
    }),
  ];

  it('shows only that weekday, in time order', () => {
    const day = effectiveDay(DATE, week, []);
    expect(day.map((entry) => entry.classId)).toEqual(['class-a', 'class-b', 'class-d']);
  });

  it('keeps a cancelled class visible, and unmarkable', () => {
    const day = effectiveDay(DATE, week, [override({ classId: 'class-a' })]);
    const cancelled = day.find((entry) => entry.classId === 'class-a');

    expect(cancelled?.status).toBe('cancelled');
    // Visible, because a class that simply vanished would leave the student
    // wondering whether they had recorded it.
    expect(cancelled).toBeDefined();
    expect(cancelled?.markable).toBe(false);
  });

  it('never offers a break or an activity an attendance control', () => {
    const day = effectiveDay(DATE, week, []);
    expect(day.find((entry) => entry.classId === 'class-d')?.markable).toBe(false);
    expect(day.filter((entry) => entry.markable).map((entry) => entry.classId)).toEqual([
      'class-a',
      'class-b',
    ]);
  });

  it('adds a class that exists on this date alone', () => {
    const day = effectiveDay(DATE, week, [
      override({
        classId: 'one-off',
        status: 'scheduled',
        addition: {
          startTime: '14:00',
          endTime: '15:00',
          subjectCode: 'BCS302',
          activity: null,
          room: null,
          faculty: null,
          kind: 'course',
        },
      }),
    ]);

    const added = day.find((entry) => entry.classId === 'one-off');
    expect(added?.oneOff).toBe(true);
    expect(added?.markable).toBe(true);
    expect(day.map((entry) => entry.classId)).toEqual(['class-a', 'class-b', 'class-d', 'one-off']);
  });

  it('leaves another date untouched', () => {
    const next = effectiveDay('2026-09-23', week, [override({ classId: 'class-a' })]);
    expect(next.find((entry) => entry.classId === 'class-a')?.status).toBe('scheduled');
  });

  it('has nothing at all on a Sunday', () => {
    expect(effectiveDay('2026-09-20', week, [])).toHaveLength(0);
  });

  it('reads the weekday from the date', () => {
    expect(weekdayOf('2026-09-16')).toBe('Wed');
    expect(weekdayOf('2026-09-19')).toBe('Sat');
    expect(weekdayOf('2026-09-20')).toBeNull();
  });
});

describe('overlapping hours', () => {
  it('sees a collision without resolving it', () => {
    expect(
      overlaps({ startTime: '09:00', endTime: '10:00' }, { startTime: '09:30', endTime: '10:30' }),
    ).toBe(true);
    expect(
      overlaps({ startTime: '09:00', endTime: '10:00' }, { startTime: '10:00', endTime: '11:00' }),
    ).toBe(false);
  });
});
