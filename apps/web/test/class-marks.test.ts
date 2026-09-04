/**
 * The arithmetic behind marking, correcting and un-marking one class.
 *
 * Authority: docs/22 §22.67 · M10A.11 §11, §12, §13, §14, §44
 *
 * These are the sums the daily loop rests on. Every one of them is reversible,
 * which is the whole reason undo does not have to keep a copy of the record it
 * replaced — and the reason a correction from attended to missed can move one
 * counter without touching the other.
 */

import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  countDelta,
  isCountable,
  markFor,
  markId,
  staleMarks,
} from '../src/domain/attendance.js';
import { asStudentProfileId } from '../src/domain/identity.js';
import type { AttendanceRecord, ClassMark } from '../src/domain/types.js';

const profileId = asStudentProfileId('p1');

function record(attended: number, conducted: number): AttendanceRecord {
  return {
    id: 'a1',
    profileId,
    semester: 5,
    subjectCode: 'BCS501',
    subjectTitle: 'Software Engineering',
    attended,
    conducted,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function mark(date: string, slotId: string, outcome: ClassMark['outcome'] = 'attended'): ClassMark {
  return {
    id: markId(date, slotId),
    profileId,
    date,
    slotId,
    subjectCode: 'BCS501',
    outcome,
    markedAt: `${date}T10:00:00.000Z`,
  };
}

describe('what one decision does to the counts', () => {
  it('counts a first attended class in both totals', () => {
    expect(countDelta(null, 'attended')).toEqual({ attended: 1, conducted: 1 });
  });

  it('counts a first missed class only as one held', () => {
    // THE CASE THAT DECIDES WHETHER THIS IS A RATIO OR A SCORE.
    expect(countDelta(null, 'missed')).toEqual({ attended: 0, conducted: 1 });
  });

  it('corrects attended to missed without inventing a second class', () => {
    // The class still happened. Only who was there changed.
    expect(countDelta('attended', 'missed')).toEqual({ attended: -1, conducted: 0 });
  });

  it('corrects missed to attended without inventing a second class', () => {
    expect(countDelta('missed', 'attended')).toEqual({ attended: 1, conducted: 0 });
  });

  it('undoes exactly what it applied, either way round', () => {
    expect(countDelta('attended', null)).toEqual({ attended: -1, conducted: -1 });
    expect(countDelta('missed', null)).toEqual({ attended: 0, conducted: -1 });
  });

  it('does nothing at all when the answer has not changed', () => {
    // A second tap on the button that is already pressed is a second tap, not
    // a second class (§13).
    expect(countDelta('attended', 'attended')).toEqual({ attended: 0, conducted: 0 });
    expect(countDelta(null, null)).toEqual({ attended: 0, conducted: 0 });
  });
});

describe('moving a record by a delta', () => {
  it('returns the record to exactly where it started after an undo', () => {
    const before = record(30, 40);
    const marked = applyDelta(before, countDelta(null, 'attended'));
    const undone = applyDelta(marked, countDelta('attended', null));
    expect([undone.attended, undone.conducted]).toEqual([30, 40]);
  });

  it('never produces a record that says more attended than held', () => {
    /*
     * The counts are also editable by hand. A student who marks a class, then
     * types the totals down to nothing, must not be able to undo their way to a
     * negative record — every result stays countable.
     */
    const edited = record(0, 0);
    const undone = applyDelta(edited, countDelta('attended', null));
    expect(isCountable(undone)).toBe(true);
    expect([undone.attended, undone.conducted]).toEqual([0, 0]);
  });
});

describe('which class a mark belongs to', () => {
  it('gives one scheduled class on one day exactly one id', () => {
    // The id is the duplicate guard: a repeated write REPLACES (§13).
    expect(markId('2026-09-07', 't-1')).toBe(markId('2026-09-07', 't-1'));
    expect(markId('2026-09-07', 't-1')).not.toBe(markId('2026-09-08', 't-1'));
  });

  it('does not confuse the same class on two days', () => {
    const marks = [mark('2026-09-07', 't-1'), mark('2026-09-08', 't-1', 'missed')];
    expect(markFor(marks, '2026-09-08', 't-1')?.outcome).toBe('missed');
    expect(markFor(marks, '2026-09-09', 't-1')).toBeNull();
  });
});

describe('marks do not become history', () => {
  it('keeps a fortnight and lets the rest go', () => {
    /*
     * A mark answers "have I already marked this?" for a class in front of the
     * student. Keeping them forever would turn a duplicate guard into per-class
     * history the product would then have to keep true (§11, §44).
     */
    const marks = [mark('2026-09-07', 'a'), mark('2026-08-20', 'b'), mark('2026-09-01', 'c')];
    expect(staleMarks(marks, '2026-09-07').map((stale) => stale.slotId)).toEqual(['b']);
  });

  it('keeps today', () => {
    expect(staleMarks([mark('2026-09-07', 'a')], '2026-09-07')).toEqual([]);
  });
});
